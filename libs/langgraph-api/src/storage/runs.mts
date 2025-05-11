import { HTTPException } from "hono/http-exception";
import { database } from "./database.mjs";
import { handleAuthEvent, isAuthMatching } from "../auth/custom.mjs";
import type { AuthContext } from "../auth/index.mjs";
import type {
  Metadata,
  MultitaskStrategy,
  RunKwargs,
  RunStatus,
  RunnableConfig,
  IfNotExists,
} from "./ops.mjs";
import { checkpointer } from "./checkpoint.mjs";
import { v4 as uuid4 } from "uuid";
import { serializeError } from "../utils/serde.mjs";
import { Threads } from "./threads.mjs";

class TimeoutError extends Error {}
class AbortError extends Error {}

interface Run {
  run_id: string;
  thread_id: string;
  assistant_id: string;
  created_at: Date;
  updated_at: Date;
  status: RunStatus;
  metadata: Metadata;
  kwargs: RunKwargs;
  multitask_strategy: MultitaskStrategy;
}

interface Message {
  topic: `run:${string}:stream:${string}`;
  data: unknown;
}

class Queue {
  private buffer: Message[] = [];
  private listeners: (() => void)[] = [];

  push(item: Message) {
    this.buffer.push(item);
    for (const listener of this.listeners) {
      listener();
    }
  }

  async get(options: { timeout: number; signal?: AbortSignal }) {
    if (this.buffer.length > 0) {
      return this.buffer.shift()!;
    }

    let timeout: NodeJS.Timeout | undefined = undefined;
    let resolver: (() => void) | undefined = undefined;

    const clean = new AbortController();

    return await new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => reject(new TimeoutError()), options.timeout);
      resolver = resolve;

      options.signal?.addEventListener(
        "abort",
        () => reject(new AbortError()),
        { signal: clean.signal },
      );

      this.listeners.push(resolver);
    })
      .then(() => this.buffer.shift()!)
      .finally(() => {
        this.listeners = this.listeners.filter((l) => l !== resolver);
        clearTimeout(timeout);
        clean.abort();
      });
  }
}

class CancellationAbortController extends AbortController {
  abort(reason: "rollback" | "interrupt") {
    super.abort(reason);
  }
}

class StreamManagerImpl {
  readers: Record<string, Queue> = {};
  control: Record<string, CancellationAbortController> = {};

  getQueue(runId: string, options: { ifNotFound: "create" }): Queue;

  getQueue(runId: string, options: { ifNotFound: "ignore" }): Queue | undefined;

  getQueue(runId: string, options: { ifNotFound: "create" | "ignore" }) {
    if (this.readers[runId] == null) {
      if (options?.ifNotFound === "create") {
        this.readers[runId] = new Queue();
      } else {
        return undefined;
      }
    }

    return this.readers[runId];
  }

  getControl(runId: string) {
    if (this.control[runId] == null) return undefined;
    return this.control[runId];
  }

  isLocked(runId: string): boolean {
    return this.control[runId] != null;
  }

  lock(runId: string): AbortSignal {
    if (this.control[runId] != null) {
      console.warn("Run already locked", { run_id: runId });
    }
    this.control[runId] = new CancellationAbortController();
    return this.control[runId].signal;
  }

  unlock(runId: string) {
    delete this.control[runId];
  }
}

export const StreamManager = new StreamManagerImpl();

export class Runs {
  static async *next(): AsyncGenerator<{
    run: Run;
    attempt: number;
    signal: AbortSignal;
  }> {
    // 获取待处理的运行列表
    const now = new Date();
    const { rows: pendingRuns } = await database.pool.query(
      `SELECT * FROM public.run
       WHERE status = 'pending' AND created_at < $1
       ORDER BY created_at ASC`,
      [now],
    );

    if (!pendingRuns.length) {
      return;
    }

    // 使用独立的计数表来跟踪尝试次数
    // 由于我们不再使用内存存储，使用临时表或其他方式维护重试计数
    for (const run of pendingRuns) {
      const runId = run.run_id;
      const threadId = run.thread_id;

      // 验证线程存在
      const { rows: threadRows } = await database.pool.query(
        `SELECT * FROM public.thread WHERE thread_id = $1`,
        [threadId],
      );

      if (threadRows.length === 0) {
        console.warn(`Unexpected missing thread in Runs.next: ${threadId}`);
        continue;
      }

      if (StreamManager.isLocked(runId)) continue;

      try {
        const signal = StreamManager.lock(runId);

        // 模拟重试计数器，实际项目中可能需要在数据库中维护
        // 这里仅将尝试次数设为1，因为没有持久化的方式跟踪
        const attempt = 1;

        yield {
          run: {
            run_id: run.run_id,
            thread_id: run.thread_id,
            assistant_id: run.assistant_id,
            created_at: run.created_at,
            updated_at: run.updated_at,
            status: run.status,
            metadata: run.metadata,
            kwargs: run.kwargs,
            multitask_strategy: run.multitask_strategy,
          },
          attempt,
          signal,
        };
      } finally {
        StreamManager.unlock(runId);
      }
    }
  }

  static async put(
    runId: string,
    assistantId: string,
    kwargs: RunKwargs,
    options: {
      threadId?: string;
      userId?: string;
      status?: RunStatus;
      metadata?: Metadata;
      preventInsertInInflight?: boolean;
      multitaskStrategy?: MultitaskStrategy;
      ifNotExists?: IfNotExists;
      afterSeconds?: number;
    },
    auth: AuthContext | undefined,
  ): Promise<Run[]> {
    // 首先检查assistant是否存在
    const { rows: assistantRows } = await database.pool.query(
      `SELECT * FROM public.assistant WHERE assistant_id = $1`,
      [assistantId],
    );

    if (assistantRows.length === 0) {
      throw new HTTPException(404, {
        message: `No assistant found for "${assistantId}". Make sure the assistant ID is for a valid assistant or a valid graph ID.`,
      });
    }

    const assistant = assistantRows[0];
    const ifNotExists = options?.ifNotExists ?? "reject";
    const multitaskStrategy = options?.multitaskStrategy ?? "reject";
    const afterSeconds = options?.afterSeconds ?? 0;
    const status = options?.status ?? "pending";

    let threadId = options?.threadId;

    const [filters, mutable] = await handleAuthEvent(
      auth,
      "threads:create_run",
      {
        thread_id: threadId,
        assistant_id: assistantId,
        run_id: runId,
        status: status,
        metadata: options?.metadata ?? {},
        prevent_insert_if_inflight: options?.preventInsertInInflight,
        multitask_strategy: multitaskStrategy,
        if_not_exists: ifNotExists,
        after_seconds: afterSeconds,
        kwargs,
      },
    );

    const metadata = mutable.metadata ?? {};
    const config: RunnableConfig = kwargs.config ?? {};

    // 检查线程是否存在
    let existingThread = null;
    if (threadId) {
      const { rows } = await database.pool.query(
        `SELECT * FROM public.thread WHERE thread_id = $1`,
        [threadId],
      );

      if (rows.length > 0) {
        existingThread = rows[0];

        if (!isAuthMatching(existingThread.metadata, filters)) {
          throw new HTTPException(404);
        }
      }
    }

    const now = new Date();
    const client = await database.pool.connect();

    try {
      await client.query("BEGIN");

      // 如果线程不存在，创建新线程
      if (!existingThread && (threadId == null || ifNotExists === "create")) {
        threadId ??= uuid4();

        const threadMetadata = {
          graph_id: assistant.graph_id,
          assistant_id: assistantId,
          ...metadata,
        };

        const threadConfig = {
          ...assistant.config,
          ...config,
          configurable: {
            ...assistant.config?.configurable,
            ...config?.configurable,
          },
        };

        // 创建新线程
        const { rows } = await client.query(
          `INSERT INTO public.thread
           (thread_id, status, metadata, config, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [threadId, "busy", threadMetadata, threadConfig, now, now],
        );

        existingThread = rows[0];
      } else if (existingThread) {
        // 更新现有线程
        if (existingThread.status !== "busy") {
          const updatedMetadata = {
            ...existingThread.metadata,
            graph_id: assistant.graph_id,
            assistant_id: assistantId,
          };

          const updatedConfig = {
            ...assistant.config,
            ...existingThread.config,
            ...config,
            configurable: {
              ...assistant.config?.configurable,
              ...existingThread?.config?.configurable,
              ...config?.configurable,
            },
          };

          await client.query(
            `UPDATE public.thread
             SET status = $1, metadata = $2, config = $3, updated_at = $4
             WHERE thread_id = $5`,
            ["busy", updatedMetadata, updatedConfig, now, threadId],
          );

          const { rows } = await client.query(
            `SELECT * FROM public.thread WHERE thread_id = $1`,
            [threadId],
          );
          existingThread = rows[0];
        }
      } else {
        await client.query("ROLLBACK");
        return [];
      }

      // 检查待处理的运行
      let inflightRuns: Run[] = [];
      if (options?.preventInsertInInflight) {
        const { rows: pendingRunRows } = await client.query(
          `SELECT * FROM public.run 
           WHERE thread_id = $1 AND status = 'pending'`,
          [threadId],
        );

        if (pendingRunRows.length > 0) {
          inflightRuns = pendingRunRows.map((row) => ({
            run_id: row.run_id,
            thread_id: row.thread_id,
            assistant_id: row.assistant_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            status: row.status,
            metadata: row.metadata,
            kwargs: row.kwargs,
            multitask_strategy: row.multitask_strategy,
          }));

          await client.query("COMMIT");
          return inflightRuns;
        }
      }

      // 配置
      const configurable = {
        ...assistant.config?.configurable,
        ...existingThread?.config?.configurable,
        ...config?.configurable,
        run_id: runId,
        thread_id: threadId,
        graph_id: assistant.graph_id,
        assistant_id: assistantId,
        user_id:
          config.configurable?.user_id ??
          existingThread?.config?.configurable?.user_id ??
          assistant.config?.configurable?.user_id ??
          options?.userId,
      };

      const mergedMetadata = {
        ...assistant.metadata,
        ...existingThread?.metadata,
        ...metadata,
      };

      const mergedConfig = {
        ...assistant.config,
        ...config,
        configurable,
        metadata: mergedMetadata,
      };

      const mergedKwargs = {
        ...kwargs,
        config: mergedConfig,
      };

      // 创建运行记录
      const createdAt = new Date(now.valueOf() + afterSeconds * 1000);
      const { rows: newRunRows } = await client.query(
        `INSERT INTO public.run
         (run_id, thread_id, assistant_id, metadata, status, kwargs, multitask_strategy, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          runId,
          threadId,
          assistantId,
          mergedMetadata,
          status,
          mergedKwargs,
          multitaskStrategy,
          createdAt,
          now,
        ],
      );

      await client.query("COMMIT");

      const newRun = newRunRows[0];
      const result: Run = {
        run_id: newRun.run_id,
        thread_id: newRun.thread_id,
        assistant_id: newRun.assistant_id,
        created_at: newRun.created_at,
        updated_at: newRun.updated_at,
        status: newRun.status,
        metadata: newRun.metadata,
        kwargs: newRun.kwargs,
        multitask_strategy: newRun.multitask_strategy,
      };

      return [result, ...inflightRuns];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  static async get(
    runId: string,
    thread_id: string | undefined,
    auth: AuthContext | undefined,
  ): Promise<Run | null> {
    const [filters] = await handleAuthEvent(auth, "threads:read", {
      thread_id,
    });

    // 获取运行记录
    const { rows } = await database.pool.query(
      `SELECT * FROM public.run WHERE run_id = $1`,
      [runId],
    );

    if (
      rows.length === 0 ||
      (thread_id != null && rows[0].thread_id !== thread_id)
    ) {
      return null;
    }

    const run = rows[0];

    // 如果提供了thread_id，验证权限
    if (filters != null) {
      const { rows: threadRows } = await database.pool.query(
        `SELECT * FROM public.thread WHERE thread_id = $1`,
        [run.thread_id],
      );

      if (
        threadRows.length === 0 ||
        !isAuthMatching(threadRows[0].metadata, filters)
      ) {
        return null;
      }
    }

    return {
      run_id: run.run_id,
      thread_id: run.thread_id,
      assistant_id: run.assistant_id,
      created_at: run.created_at,
      updated_at: run.updated_at,
      status: run.status,
      metadata: run.metadata,
      kwargs: run.kwargs,
      multitask_strategy: run.multitask_strategy,
    };
  }

  static async delete(
    run_id: string,
    thread_id: string | undefined,
    auth: AuthContext | undefined,
  ): Promise<string | null> {
    const [filters] = await handleAuthEvent(auth, "threads:delete", {
      run_id,
      thread_id,
    });

    // 获取运行记录
    const { rows } = await database.pool.query(
      `SELECT * FROM public.run WHERE run_id = $1`,
      [run_id],
    );

    if (
      rows.length === 0 ||
      (thread_id != null && rows[0].thread_id !== thread_id)
    ) {
      throw new HTTPException(404, { message: "Run not found" });
    }

    const run = rows[0];

    // 如果提供了thread_id，验证权限
    if (filters != null) {
      const { rows: threadRows } = await database.pool.query(
        `SELECT * FROM public.thread WHERE thread_id = $1`,
        [run.thread_id],
      );

      if (
        threadRows.length === 0 ||
        !isAuthMatching(threadRows[0].metadata, filters)
      ) {
        throw new HTTPException(404, { message: "Run not found" });
      }
    }

    // 删除运行记录
    await database.pool.query(`DELETE FROM public.run WHERE run_id = $1`, [
      run_id,
    ]);

    // 如果指定了线程ID，删除相关的检查点
    if (thread_id != null) {
      checkpointer.delete(thread_id, run_id);
    }

    return run.run_id;
  }

  static async wait(
    runId: string,
    threadId: string | undefined,
    auth: AuthContext | undefined,
  ) {
    const runStream = Runs.Stream.join(
      runId,
      threadId,
      { ignore404: threadId == null },
      auth,
    );

    const lastChunk = new Promise(async (resolve, reject) => {
      try {
        let lastChunk: unknown = null;
        for await (const { event, data } of runStream) {
          if (event === "values") {
            lastChunk = data as Record<string, unknown>;
          } else if (event === "error") {
            lastChunk = { __error__: serializeError(data) };
          }
        }

        resolve(lastChunk);
      } catch (error) {
        reject(error);
      }
    });

    return lastChunk;
  }

  static async join(
    runId: string,
    threadId: string,
    auth: AuthContext | undefined,
  ) {
    // 检查线程是否存在
    await Threads.get(threadId, auth);

    const lastChunk = await Runs.wait(runId, threadId, auth);
    if (lastChunk != null) return lastChunk;

    const thread = await Threads.get(threadId, auth);
    return thread.values;
  }

  static async cancel(
    threadId: string | undefined,
    runIds: string[],
    options: {
      action?: "interrupt" | "rollback";
    },
    auth: AuthContext | undefined,
  ) {
    const action = options.action ?? "interrupt";

    const [filters] = await handleAuthEvent(auth, "threads:update", {
      thread_id: threadId,
      action,
      metadata: { run_ids: runIds, status: "pending" },
    });

    let foundRunsCount = 0;
    const promises: Promise<unknown>[] = [];
    const client = await database.pool.connect();

    try {
      await client.query("BEGIN");

      for (const runId of runIds) {
        // 获取运行记录
        const { rows } = await client.query(
          `SELECT * FROM public.run WHERE run_id = $1`,
          [runId],
        );

        if (
          rows.length === 0 ||
          (threadId != null && rows[0].thread_id !== threadId)
        ) {
          continue;
        }

        const run = rows[0];

        // 如果提供了thread_id，验证权限
        if (filters != null) {
          const { rows: threadRows } = await client.query(
            `SELECT * FROM public.thread WHERE thread_id = $1`,
            [run.thread_id],
          );

          if (
            threadRows.length === 0 ||
            !isAuthMatching(threadRows[0].metadata, filters)
          ) {
            continue;
          }
        }

        foundRunsCount += 1;

        // 发送取消消息
        const control = StreamManager.getControl(runId);
        control?.abort(options.action ?? "interrupt");

        if (run.status === "pending") {
          if (control || action !== "rollback") {
            // 更新状态为interrupted
            await client.query(
              `UPDATE public.run 
               SET status = 'interrupted', updated_at = $1
               WHERE run_id = $2`,
              [new Date(), runId],
            );
          } else {
            console.info(
              "Eagerly deleting unscheduled run with rollback action",
              {
                run_id: runId,
                thread_id: threadId,
              },
            );

            // 异步删除运行记录
            promises.push(Runs.delete(runId, threadId, auth));
          }
        } else {
          console.warn("Attempted to cancel non-pending run.", {
            run_id: runId,
            status: run.status,
          });
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await Promise.all(promises);

    if (foundRunsCount === runIds.length) {
      console.info("Cancelled runs", {
        run_ids: runIds,
        thread_id: threadId,
        action,
      });
    } else {
      throw new HTTPException(404, { message: "Run not found" });
    }
  }

  static async search(
    threadId: string,
    options: {
      limit?: number | null;
      offset?: number | null;
      status?: string | null;
      metadata?: Metadata | null;
    },
    auth: AuthContext | undefined,
  ) {
    const [filters] = await handleAuthEvent(auth, "threads:search", {
      thread_id: threadId,
      metadata: options.metadata,
      status: options.status,
    });

    // 构建查询
    let query = `
      SELECT * FROM public.run 
      WHERE thread_id = $1
    `;
    const params: any[] = [threadId];
    let paramIndex = 2;

    if (options?.status != null) {
      query += ` AND status = $${paramIndex}`;
      params.push(options.status);
      paramIndex++;
    }

    if (options?.metadata != null) {
      query += ` AND metadata @> $${paramIndex}`;
      params.push(options.metadata);
      paramIndex++;
    }

    // 验证线程权限
    if (filters != null) {
      const { rows: threadRows } = await database.pool.query(
        `SELECT * FROM public.thread WHERE thread_id = $1`,
        [threadId],
      );

      if (
        threadRows.length === 0 ||
        !isAuthMatching(threadRows[0].metadata, filters)
      ) {
        return [];
      }
    }

    // 添加排序和分页
    query += ` ORDER BY created_at DESC`;

    const limit = options?.limit ?? 10;
    const offset = options?.offset ?? 0;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const { rows } = await database.pool.query(query, params);

    return rows.map((row) => ({
      run_id: row.run_id,
      thread_id: row.thread_id,
      assistant_id: row.assistant_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      status: row.status,
      metadata: row.metadata,
      kwargs: row.kwargs,
      multitask_strategy: row.multitask_strategy,
    }));
  }

  static async setStatus(runId: string, status: RunStatus) {
    const { rows } = await database.pool.query(
      `SELECT * FROM public.run WHERE run_id = $1`,
      [runId],
    );

    if (rows.length === 0) {
      throw new Error(`Run ${runId} not found`);
    }

    await database.pool.query(
      `UPDATE public.run 
       SET status = $1, updated_at = $2
       WHERE run_id = $3`,
      [status, new Date(), runId],
    );
  }

  static Stream = class {
    static async *join(
      runId: string,
      threadId: string | undefined,
      options: {
        ignore404?: boolean;
        cancelOnDisconnect?: AbortSignal;
      },
      auth: AuthContext | undefined,
    ): AsyncGenerator<{ event: string; data: unknown }> {
      const signal = options?.cancelOnDisconnect;
      const queue = StreamManager.getQueue(runId, { ifNotFound: "create" });

      const [filters] = await handleAuthEvent(auth, "threads:read", {
        thread_id: threadId,
      });

      // 验证线程权限
      if (filters != null && threadId != null) {
        const { rows: threadRows } = await database.pool.query(
          `SELECT * FROM public.thread WHERE thread_id = $1`,
          [threadId],
        );

        if (
          threadRows.length === 0 ||
          !isAuthMatching(threadRows[0].metadata, filters)
        ) {
          yield {
            event: "error",
            data: { error: "Error", message: "404: Thread not found" },
          };
          return;
        }
      }

      while (!signal?.aborted) {
        try {
          const message = await queue.get({ timeout: 500, signal });
          if (message.topic === `run:${runId}:control`) {
            if (message.data === "done") break;
          } else {
            const streamTopic = message.topic.substring(
              `run:${runId}:stream:`.length,
            );

            yield { event: streamTopic, data: message.data };
          }
        } catch (error) {
          if (error instanceof AbortError) break;

          const run = await Runs.get(runId, threadId, auth);
          if (run == null) {
            if (!options?.ignore404)
              yield { event: "error", data: "Run not found" };
            break;
          } else if (run.status !== "pending") {
            break;
          }
        }
      }

      if (signal?.aborted && threadId != null) {
        await Runs.cancel(threadId, [runId], { action: "interrupt" }, auth);
      }
    }

    static async publish(runId: string, topic: string, data: unknown) {
      const queue = StreamManager.getQueue(runId, { ifNotFound: "create" });
      queue.push({ topic: `run:${runId}:stream:${topic}`, data });
    }
  };
}
