import { HTTPException } from "hono/http-exception";
import { database } from "./database.mjs";
import { handleAuthEvent, isAuthMatching } from "../auth/custom.mjs";
import type { AuthContext } from "../auth/index.mjs";
import type {
  Metadata,
  OnConflictBehavior,
  RunnableConfig,
  ThreadStatus,
} from "./ops.mjs";
import { checkpointer } from "./checkpoint.mjs";
import { v4 as uuid4 } from "uuid";
import { getGraph } from "../graph/load.mjs";
import { store } from "./store.mjs";
import { getLangGraphCommand, type RunCommand } from "../command.mjs";
import { StateSnapshot } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

export const langchainValuesToStaticJson = (values: any): any => {
  // 处理null或undefined
  if (values == null) {
    return values;
  }

  // 处理BaseMessage实例
  if (values instanceof BaseMessage) {
    return { type: values.getType(), ...values._printableFields };
  }

  // 处理数组
  if (Array.isArray(values)) {
    return values.map((item) => langchainValuesToStaticJson(item));
  }

  // 处理对象
  if (typeof values === "object" && values.constructor === Object) {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(values)) {
      result[key] = langchainValuesToStaticJson(value);
    }
    return result;
  }

  // 基本类型直接返回
  return values;
};

interface CheckpointPayload {
  config?: RunnableConfig;
  metadata: Record<string, unknown>;
  values: Record<string, unknown>;
  next: string[];
  parent_config?: RunnableConfig;
  tasks: {
    id: string;
    name: string;
    error?: string;
    interrupts: Record<string, unknown>;
    state?: RunnableConfig;
  }[];
}

interface Thread {
  thread_id: string;
  created_at: Date;
  updated_at: Date;
  metadata?: Metadata;
  config?: RunnableConfig;
  status: ThreadStatus;
  values?: Record<string, unknown>;
  interrupts?: Record<string, unknown>;
}

export class Threads {
  static async *search(
    options: {
      metadata?: Metadata;
      status?: ThreadStatus;
      values?: Record<string, unknown>;
      limit: number;
      offset: number;
      sort_by?: "thread_id" | "status" | "created_at" | "updated_at";
      sort_order?: "asc" | "desc";
    },
    auth: AuthContext | undefined,
  ): AsyncGenerator<{ thread: Thread; total: number }> {
    const [filters] = await handleAuthEvent(auth, "threads:search", {
      metadata: options.metadata,
      status: options.status,
      values: options.values,
      limit: options.limit,
      offset: options.offset,
    });

    // 构建查询
    let query = `
      SELECT *, COUNT(*) OVER() as total_count 
      FROM public.thread 
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (options.metadata != null) {
      query += ` AND metadata @> $${paramIndex}`;
      params.push(options.metadata);
      paramIndex++;
    }

    if (options.values != null) {
      query += ` AND "values" @> $${paramIndex}`;
      params.push(options.values);
      paramIndex++;
    }

    if (options.status != null) {
      query += ` AND status = $${paramIndex}`;
      params.push(options.status);
      paramIndex++;
    }

    // 添加排序
    const sortBy = options.sort_by ?? "created_at";
    const sortOrder = options.sort_order ?? "desc";
    query += ` ORDER BY ${sortBy} ${sortOrder}`;

    // 添加分页
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(options.limit, options.offset);

    const { rows } = await database.pool.query(query, params);

    const total = rows.length > 0 ? parseInt(rows[0].total_count) : 0;

    for (const row of rows) {
      // 检查权限
      if (!isAuthMatching(row.metadata, filters)) {
        continue;
      }

      const thread: Thread = {
        thread_id: row.thread_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        metadata: row.metadata,
        config: row.config,
        status: row.status,
        values: row.values,
        interrupts: row.interrupts,
      };

      yield { thread, total };
    }
  }

  static async get(
    thread_id: string,
    auth: AuthContext | undefined,
  ): Promise<Thread> {
    const [filters] = await handleAuthEvent(auth, "threads:read", {
      thread_id,
    });

    const { rows } = await database.pool.query(
      `SELECT * FROM public.thread WHERE thread_id = $1`,
      [thread_id],
    );

    if (rows.length === 0) {
      throw new HTTPException(404, {
        message: `Thread with ID ${thread_id} not found`,
      });
    }

    const result = rows[0];

    if (!isAuthMatching(result.metadata, filters)) {
      throw new HTTPException(404, {
        message: `Thread with ID ${thread_id} not found`,
      });
    }

    return {
      thread_id: result.thread_id,
      created_at: result.created_at,
      updated_at: result.updated_at,
      metadata: result.metadata,
      config: result.config,
      status: result.status,
      values: result.values,
      interrupts: result.interrupts,
    };
  }

  static async put(
    thread_id: string,
    options: {
      metadata?: Metadata;
      if_exists: OnConflictBehavior;
    },
    auth: AuthContext | undefined,
  ): Promise<Thread> {
    const [filters, mutable] = await handleAuthEvent(auth, "threads:create", {
      thread_id,
      metadata: options.metadata,
      if_exists: options.if_exists,
    });

    // 首先检查线程是否存在
    const { rows: existingRows } = await database.pool.query(
      `SELECT * FROM public.thread WHERE thread_id = $1`,
      [thread_id],
    );

    if (existingRows.length > 0) {
      const existingThread = existingRows[0];

      if (!isAuthMatching(existingThread.metadata, filters)) {
        throw new HTTPException(409, { message: "Thread already exists" });
      }

      if (options?.if_exists === "raise") {
        throw new HTTPException(409, { message: "Thread already exists" });
      }

      return {
        thread_id: existingThread.thread_id,
        created_at: existingThread.created_at,
        updated_at: existingThread.updated_at,
        metadata: existingThread.metadata,
        config: existingThread.config,
        status: existingThread.status,
        values: existingThread.values,
        interrupts: existingThread.interrupts,
      };
    }

    const now = new Date();

    // 插入新线程
    const { rows } = await database.pool.query(
      `INSERT INTO public.thread
      (thread_id, created_at, updated_at, metadata, status, config)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [thread_id, now, now, mutable?.metadata ?? {}, "idle", {}],
    );

    const result = rows[0];

    return {
      thread_id: result.thread_id,
      created_at: result.created_at,
      updated_at: result.updated_at,
      metadata: result.metadata,
      config: result.config,
      status: result.status,
      values: result.values,
      interrupts: result.interrupts,
    };
  }

  static async patch(
    threadId: string,
    options: { metadata?: Metadata },
    auth: AuthContext | undefined,
  ): Promise<Thread> {
    const [filters, mutable] = await handleAuthEvent(auth, "threads:update", {
      thread_id: threadId,
      metadata: options.metadata,
    });

    const { rows: threadRows } = await database.pool.query(
      `SELECT * FROM public.thread WHERE thread_id = $1`,
      [threadId],
    );

    if (threadRows.length === 0) {
      throw new HTTPException(404, { message: "Thread not found" });
    }

    const thread = threadRows[0];

    if (!isAuthMatching(thread.metadata, filters)) {
      throw new HTTPException(404, { message: "Thread not found" });
    }

    const now = new Date();
    let updatedMetadata = thread.metadata;

    if (mutable.metadata != null) {
      updatedMetadata = {
        ...thread.metadata,
        ...mutable.metadata,
      };
    }

    const { rows } = await database.pool.query(
      `UPDATE public.thread
       SET metadata = $1, updated_at = $2
       WHERE thread_id = $3
       RETURNING *`,
      [updatedMetadata, now, threadId],
    );

    const result = rows[0];

    return {
      thread_id: result.thread_id,
      created_at: result.created_at,
      updated_at: result.updated_at,
      metadata: result.metadata,
      config: result.config,
      status: result.status,
      values: result.values,
      interrupts: result.interrupts,
    };
  }

  static async setStatus(
    threadId: string,
    options: {
      checkpoint?: CheckpointPayload;
      exception?: Error;
    },
  ) {
    const { rows: threadRows } = await database.pool.query(
      `SELECT * FROM public.thread WHERE thread_id = $1`,
      [threadId],
    );

    if (threadRows.length === 0) {
      throw new HTTPException(404, { message: "Thread not found" });
    }

    let hasNext = false;
    if (options.checkpoint != null) {
      hasNext = options.checkpoint.next.length > 0;
    }

    // 检查是否有待处理的运行
    const { rows: pendingRuns } = await database.pool.query(
      `SELECT COUNT(*) as count FROM public.run 
       WHERE thread_id = $1 AND status = 'pending'`,
      [threadId],
    );

    const hasPendingRuns = parseInt(pendingRuns[0].count) > 0;

    let status: ThreadStatus = "idle";

    if (options.exception != null) {
      status = "error";
    } else if (hasNext) {
      status = "interrupted";
    } else if (hasPendingRuns) {
      status = "busy";
    }

    const now = new Date();
    const values = langchainValuesToStaticJson(options.checkpoint?.values);
    let interrupts = {};
    if (options.checkpoint != null) {
      interrupts = options.checkpoint.tasks.reduce<Record<string, unknown>>(
        (acc, task) => {
          if (task.interrupts) acc[task.id] = task.interrupts;
          return acc;
        },
        {},
      );
    }
    await database.pool.query(
      `UPDATE public.thread
       SET updated_at = $1, status = $2, values = $3, interrupts = $4
       WHERE thread_id = $5`,
      [now, status, values, interrupts, threadId],
    );
  }

  static async delete(
    thread_id: string,
    auth: AuthContext | undefined,
  ): Promise<string[]> {
    const [filters] = await handleAuthEvent(auth, "threads:delete", {
      thread_id,
    });

    const { rows } = await database.pool.query(
      `SELECT * FROM public.thread WHERE thread_id = $1`,
      [thread_id],
    );

    if (rows.length === 0) {
      throw new HTTPException(404, {
        message: `Thread with ID ${thread_id} not found`,
      });
    }

    const thread = rows[0];

    if (!isAuthMatching(thread.metadata, filters)) {
      throw new HTTPException(404, {
        message: `Thread with ID ${thread_id} not found`,
      });
    }

    // 开启事务
    const client = await database.pool.connect();
    try {
      await client.query("BEGIN");

      // 删除相关的运行记录
      await client.query(`DELETE FROM public.run WHERE thread_id = $1`, [
        thread_id,
      ]);

      // 删除线程
      await client.query(`DELETE FROM public.thread WHERE thread_id = $1`, [
        thread_id,
      ]);

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    // 删除checkpoint
    checkpointer.delete(thread_id, null);

    return [thread_id];
  }

  static async copy(
    thread_id: string,
    auth: AuthContext | undefined,
  ): Promise<Thread> {
    const [filters] = await handleAuthEvent(auth, "threads:read", {
      thread_id,
    });

    const { rows } = await database.pool.query(
      `SELECT * FROM public.thread WHERE thread_id = $1`,
      [thread_id],
    );

    if (rows.length === 0) {
      throw new HTTPException(409, { message: "Thread not found" });
    }

    const thread = rows[0];

    if (!isAuthMatching(thread.metadata, filters)) {
      throw new HTTPException(409, { message: "Thread not found" });
    }

    const newThreadId = uuid4();
    const now = new Date();

    const newMetadata = { ...thread.metadata, thread_id: newThreadId };

    const { rows: newThreadRows } = await database.pool.query(
      `INSERT INTO public.thread
      (thread_id, created_at, updated_at, metadata, config, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [newThreadId, now, now, newMetadata, {}, "idle"],
    );

    checkpointer.copy(thread_id, newThreadId);

    const result = newThreadRows[0];

    return {
      thread_id: result.thread_id,
      created_at: result.created_at,
      updated_at: result.updated_at,
      metadata: result.metadata,
      config: result.config,
      status: result.status,
      values: result.values,
      interrupts: result.interrupts,
    };
  }

  static State = class {
    static async get(
      config: RunnableConfig,
      options: { subgraphs?: boolean },
      auth: AuthContext | undefined,
    ) {
      const subgraphs = options.subgraphs ?? false;
      const threadId = config.configurable?.thread_id;

      let thread;
      if (threadId) {
        try {
          thread = await Threads.get(threadId, auth);
        } catch (error) {
          thread = undefined;
        }
      }

      const metadata = thread?.metadata ?? {};
      const graphId = metadata?.graph_id as string | undefined | null;

      if (!thread || graphId == null) {
        return {
          values: {},
          next: [],
          config: {},
          metadata: undefined,
          createdAt: undefined,
          parentConfig: undefined,
          tasks: [],
        };
      }

      const graph = await getGraph(graphId, thread.config, {
        store,
      });

      const result = await graph.getState(config, { subgraphs });

      return result;
    }

    static async post(
      config: RunnableConfig,
      values:
        | Record<string, unknown>[]
        | Record<string, unknown>
        | null
        | undefined,
      asNode: string | undefined,
      auth: AuthContext | undefined,
    ) {
      const threadId = config.configurable?.thread_id;
      const [filters] = await handleAuthEvent(auth, "threads:update", {
        thread_id: threadId,
      });

      const thread = threadId ? await Threads.get(threadId, auth) : undefined;
      if (!thread)
        throw new HTTPException(404, {
          message: `Thread ${threadId} not found`,
        });

      if (!isAuthMatching(thread["metadata"], filters)) {
        throw new HTTPException(403);
      }

      const graphId = thread.metadata?.graph_id as string | undefined | null;

      if (graphId == null) {
        throw new HTTPException(400, {
          message: `Thread ${threadId} has no graph ID`,
        });
      }

      config.configurable ??= {};
      config.configurable.graph_id ??= graphId;

      const graph = await getGraph(graphId, thread.config, {
        store,
      });

      const updateConfig = structuredClone(config);
      updateConfig.configurable ??= {};
      updateConfig.configurable.checkpoint_ns ??= "";

      const nextConfig = await graph.updateState(updateConfig, values, asNode);
      const state = await Threads.State.get(config, { subgraphs: false }, auth);

      // 更新线程值
      await database.pool.query(
        `UPDATE public.thread SET values = $1 WHERE thread_id = $2`,
        [state.values, threadId],
      );

      return { checkpoint: nextConfig.configurable };
    }

    static async bulk(
      config: RunnableConfig,
      supersteps: Array<{
        updates: Array<{
          values?:
            | Record<string, unknown>[]
            | Record<string, unknown>
            | unknown
            | null
            | undefined;
          command?: RunCommand | undefined | null;
          as_node?: string | undefined;
        }>;
      }>,
      auth: AuthContext | undefined,
    ) {
      const threadId = config.configurable?.thread_id;
      if (!threadId) return [];

      const [filters] = await handleAuthEvent(auth, "threads:update", {
        thread_id: threadId,
      });

      const thread = await Threads.get(threadId, auth);

      if (!isAuthMatching(thread["metadata"], filters)) {
        throw new HTTPException(403);
      }

      const graphId = thread.metadata?.graph_id as string | undefined | null;
      if (graphId == null) {
        throw new HTTPException(400, {
          message: `Thread ${threadId} has no graph ID`,
        });
      }

      config.configurable ??= {};
      config.configurable.graph_id ??= graphId;

      const graph = await getGraph(graphId, thread.config, {
        store,
      });

      const updateConfig = structuredClone(config);
      updateConfig.configurable ??= {};
      updateConfig.configurable.checkpoint_ns ??= "";

      const nextConfig = await graph.bulkUpdateState(
        updateConfig,
        supersteps.map((i) => ({
          updates: i.updates.map((j) => ({
            values:
              j.command != null ? getLangGraphCommand(j.command) : j.values,
            asNode: j.as_node,
          })),
        })),
      );

      const state = await Threads.State.get(config, { subgraphs: false }, auth);

      // 更新线程值
      await database.pool.query(
        `UPDATE public.thread SET values = $1 WHERE thread_id = $2`,
        [state.values, threadId],
      );

      return { checkpoint: nextConfig.configurable };
    }

    static async getHistory(
      config: RunnableConfig,
      options: {
        before?: string | RunnableConfig;
        limit?: number;
        metadata?: Record<string, unknown>;
      },
      auth: AuthContext | undefined,
    ) {
      const threadId = config.configurable?.thread_id;
      if (!threadId) return [];

      const [filters] = await handleAuthEvent(auth, "threads:update", {
        thread_id: threadId,
      });

      const thread = await Threads.get(threadId, auth);

      if (!isAuthMatching(thread.metadata, filters)) {
        throw new HTTPException(403);
      }

      const graphId = thread.metadata?.graph_id as string | undefined | null;
      if (graphId == null) {
        throw new HTTPException(400, {
          message: `Thread ${threadId} has no graph ID`,
        });
      }

      config.configurable ??= {};
      config.configurable.graph_id ??= graphId;

      const before: RunnableConfig | undefined =
        typeof options?.before === "string"
          ? { configurable: { checkpoint_id: options.before } }
          : options?.before;

      const graph = await getGraph(graphId, thread.config, {
        store,
      });

      const states = [];
      for await (const state of graph.getStateHistory(config, {
        limit: options?.limit ?? 10,
        before,
        filter: options?.metadata,
      })) {
        states.push(state);
      }

      return states;
    }

    static async list(
      config: RunnableConfig,
      options: {
        limit?: number;
        before?: string | RunnableConfig;
        metadata?: Metadata;
      },
      auth: AuthContext | undefined,
    ) {
      const threadId = config.configurable?.thread_id;
      if (!threadId) return [];

      const [filters] = await handleAuthEvent(auth, "threads:read", {
        thread_id: threadId,
      });

      const thread = await Threads.get(threadId, auth);
      if (!isAuthMatching(thread["metadata"], filters)) return [];

      const graphId = thread.metadata?.graph_id as string | undefined | null;
      if (graphId == null) return [];

      const graph = await getGraph(graphId, thread.config, {
        checkpointer,
        store,
      });
      const before: RunnableConfig | undefined =
        typeof options?.before === "string"
          ? { configurable: { checkpoint_id: options.before } }
          : options?.before;

      const states: StateSnapshot[] = [];
      for await (const state of graph.getStateHistory(config, {
        limit: options?.limit ?? 10,
        before,
        filter: options?.metadata,
      })) {
        states.push(state);
      }

      return states;
    }
  };
}
