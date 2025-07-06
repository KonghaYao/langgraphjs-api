/**
 * Redis 适配器实现
 *
 * 提供基于 Redis 的分布式队列和锁机制，解决 StreamManager 的分布式问题
 */
import { type Redis as RedisType } from "ioredis";
import {
  StreamAdapter,
  type QueueInterface,
  type ControlInterface,
  type Message,
} from "./interface.js";
import { SerializerProtocol } from "@langchain/langgraph-checkpoint";
import { JsonPlusSerializer } from "./json-plus.js";
import { logger } from "../../logging.mjs";

// Redis 配置接口
export interface RedisConfig {
  url: string;
  keyPrefix?: string;
  lockTtl?: number; // 锁的生存时间（毫秒）
  queueTtl?: number; // 队列的生存时间（秒）
  streamTtl?: number; // Stream 的生存时间（秒）
  consumerGroupName?: string; // 消费者组名称
  maxRetries?: number; // 最大重试次数
  enableTtlRefresh?: boolean; // 是否启用 TTL 刷新
}

// 错误类
class RedisError extends Error {
  constructor(
    message: string,
    public cause?: Error,
  ) {
    super(message);
    this.name = "RedisError";
  }
}

class RedisTimeoutError extends Error {
  constructor(message: string = "Redis operation timeout") {
    super(message);
    this.name = "RedisTimeoutError";
  }
}

class RedisAbortError extends Error {
  constructor(message: string = "Redis operation aborted") {
    super(message);
    this.name = "RedisAbortError";
  }
}

// Redis 队列实现 - 基于 Redis Streams 的订阅机制
class RedisQueue implements QueueInterface {
  private readonly client: RedisType;
  private readonly resumable: boolean;
  private readonly queueTtl: number;
  private readonly streamTtl: number;
  private readonly enableTtlRefresh: boolean;
  private readonly consumerGroupName: string;
  private readonly consumerName: string;
  private consumerGroupCreated: boolean = false;

  // 队列相关的 Redis 键 - 使用 Streams
  private readonly streamKey: string;
  private readonly fallbackKey: string; // 非可恢复模式的备用键
  private readonly serializer: SerializerProtocol = new JsonPlusSerializer();

  constructor(
    client: RedisType,
    runId: string,
    keyPrefix: string,
    options?: {
      resumable?: boolean;
      queueTtl?: number;
      streamTtl?: number;
      enableTtlRefresh?: boolean;
      consumerGroupName?: string;
      maxRetries?: number;
    },
  ) {
    this.client = client;
    this.resumable = options?.resumable ?? false;
    this.queueTtl = options?.queueTtl ?? 3600; // 默认1小时
    this.streamTtl = options?.streamTtl ?? 3600; // 默认1小时
    this.enableTtlRefresh = options?.enableTtlRefresh ?? true;
    this.consumerGroupName = options?.consumerGroupName ?? "default-group";
    this.consumerName = `consumer-${process.pid}-${Date.now()}`;

    // 构建 Redis 键名 - 使用 Streams
    this.streamKey = `${keyPrefix}stream:${runId}`;
    this.fallbackKey = `${keyPrefix}queue:${runId}`;
  }

  async push(item: Message): Promise<void> {
    const [, serializedItemData] = this.serializer.dumpsTyped(item);
    const serializedItem = new TextDecoder().decode(serializedItemData);

    if (this.resumable) {
      // 可恢复模式：使用 Redis Streams，自动生成唯一 ID
      await this.client.xadd(this.streamKey, "*", "data", serializedItem);

      // 确保消费者组存在（只在第一次时创建）
      await this.ensureConsumerGroup();

      // 根据配置决定是否刷新 TTL
      if (this.enableTtlRefresh) {
        await this.client.expire(this.streamKey, this.streamTtl);
      }
    } else {
      // 非可恢复模式：使用传统 LIST
      await this.client.lpush(this.fallbackKey, serializedItem);
      // 始终设置过期时间
      await this.client.expire(this.fallbackKey, this.queueTtl);
    }
  }

  private async ensureConsumerGroup(): Promise<void> {
    if (this.consumerGroupCreated) return;

    try {
      await this.client.xgroup(
        "CREATE",
        this.streamKey,
        this.consumerGroupName,
        "0",
        "MKSTREAM",
      );
      this.consumerGroupCreated = true;

      // 设置 Stream 的初始过期时间
      await this.client.expire(this.streamKey, this.streamTtl);
    } catch (error) {
      // 忽略组已存在的错误
      if (error instanceof Error && error.message.includes("BUSYGROUP")) {
        this.consumerGroupCreated = true;
        // 即使组已存在，也要刷新过期时间
        if (this.enableTtlRefresh) {
          await this.client.expire(this.streamKey, this.streamTtl);
        }
      } else {
        throw error;
      }
    }
  }

  async get(options: {
    timeout: number;
    signal?: AbortSignal;
    lastEventId?: string;
  }): Promise<[string, Message]> {
    if (options.signal?.aborted) {
      throw new RedisAbortError();
    }
    if (this.resumable) {
      return await this.getResumableWithStreams(options);
    } else {
      return await this.getNonResumableWithList(options);
    }
  }

  // 可恢复模式：使用 Redis Streams 消费者组机制
  private async getResumableWithStreams(options: {
    timeout: number;
    signal?: AbortSignal;
    lastEventId?: string;
  }): Promise<[string, Message]> {
    // 确保消费者组存在
    try {
      await this.client.xgroup(
        "CREATE",
        this.streamKey,
        this.consumerGroupName,
        "0",
        "MKSTREAM",
      );
    } catch (error) {
      // 忽略组已存在的错误
      if (error instanceof Error && !error.message.includes("BUSYGROUP")) {
        throw error;
      }
    }

    if (options.signal?.aborted) {
      throw new RedisAbortError();
    }

    // 验证 lastEventId 是否为有效的 Redis Stream ID
    const isValidStreamId = (id: string): boolean => {
      // Redis Stream ID 格式：timestamp-sequence 或特殊值 ">" "0" 等
      return id === ">" || id === "0" || id === "0-0" || /^\d+-\d+$/.test(id);
    };

    // 如果有有效的 lastEventId，先处理待确认的消息
    if (options.lastEventId && isValidStreamId(options.lastEventId)) {
      try {
        const pendingResult = (await this.client.xreadgroup(
          "GROUP",
          this.consumerGroupName,
          this.consumerName,
          "COUNT",
          "1",
          "STREAMS",
          this.streamKey,
          options.lastEventId,
        )) as any[][];

        if (pendingResult && pendingResult.length > 0) {
          const [, messages] = pendingResult[0];
          if (messages && messages.length > 0) {
            const [messageId, fields] = messages[0];
            const message = await this.parseStreamMessage(fields as string[]);

            // 确认消息处理完成
            await this.client.xack(
              this.streamKey,
              this.consumerGroupName,
              messageId,
            );

            return [messageId, message];
          }
        }
      } catch (error) {
        // 处理待确认消息失败，继续读取新消息
        console.warn("Failed to process pending message:", error);
      }
    } else if (options.lastEventId && !isValidStreamId(options.lastEventId)) {
      // 记录无效的 lastEventId 但继续执行
      console.warn("Invalid Redis Stream ID format:", options.lastEventId);
    }

    // 使用 Promise.race 处理中断信号和超时
    const xreadPromise = this.client.xreadgroup(
      "GROUP",
      this.consumerGroupName,
      this.consumerName,
      "COUNT",
      "1",
      "BLOCK",
      options.timeout,
      "STREAMS",
      this.streamKey,
      ">",
    ) as Promise<any[][]>;

    const abortPromise = new Promise<never>((_, reject) => {
      options.signal?.addEventListener("abort", () =>
        reject(new RedisAbortError()),
      );
    });

    const result = await Promise.race([xreadPromise, abortPromise]);

    if (!result || result.length === 0) {
      throw new RedisTimeoutError();
    }

    // 解析 Stream 结果
    const [, messages] = result[0];
    if (!messages || messages.length === 0) {
      throw new RedisTimeoutError();
    }

    const [messageId, fields] = messages[0];
    const message = await this.parseStreamMessage(fields as string[]);

    // 确认消息处理完成
    await this.client.xack(this.streamKey, this.consumerGroupName, messageId);

    return [messageId, message];
  }

  // 解析 Stream 消息
  private async parseStreamMessage(fields: string[]): Promise<Message> {
    const dataIndex = fields.indexOf("data");
    if (dataIndex === -1 || dataIndex + 1 >= fields.length) {
      throw new RedisError("Invalid stream message format");
    }

    const serializedMessage = fields[dataIndex + 1];
    const message = (await this.serializer.loadsTyped(
      "json",
      serializedMessage,
    )) as Message;

    return message;
  }

  // 非可恢复模式：使用传统 LIST + BRPOP，修复无限递归问题
  private async getNonResumableWithList(options: {
    timeout: number;
    signal?: AbortSignal;
  }): Promise<[string, Message]> {
    if (options.signal?.aborted) {
      throw new RedisAbortError();
    }
    const result = await this.client.rpop(this.fallbackKey, 1);

    if (!result) {
      const len = await this.client.llen(this.fallbackKey);
      // console.log("len", len);
      if (len === 0) {
        throw new RedisTimeoutError();
      }
      return this.getNonResumableWithList(options);
    }

    const message = (await this.serializer.loadsTyped(
      "json",
      result[0],
    )) as Message;
    return [String(Date.now()), message];
  }
}

// Redis 控制器实现
class RedisCancellationAbortController
  extends AbortController
  implements ControlInterface
{
  private readonly client: RedisType;
  private readonly lockKey: string;
  private readonly lockTtl: number;
  private readonly lockValue: string;
  private cleanupInterval?: NodeJS.Timeout;
  private isLocked: boolean = false;

  constructor(
    client: RedisType,
    lockKey: string,
    lockTtl: number,
    lockValue: string,
  ) {
    super();
    this.client = client;
    this.lockKey = lockKey;
    this.lockTtl = lockTtl;
    this.lockValue = lockValue;
    this.isLocked = true;

    // 定期刷新锁的过期时间，防止长任务，key 过期被重复抢占
    this.cleanupInterval = setInterval(
      () => {
        this.refreshLock().catch(() => {
          // 如果刷新失败，可能是锁已经过期或被删除，触发中断
          this.abort("rollback");
        });
      },
      Math.max(5000, this.lockTtl / 2),
    );
  }

  private async refreshLock(): Promise<void> {
    if (!this.isLocked) return;

    const ttlSeconds = Math.ceil(this.lockTtl / 1000);

    // 使用 Lua 脚本确保只有锁的持有者才能刷新锁
    const luaScript = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("EXPIRE", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;

    const result = await this.client.eval(
      luaScript,
      1,
      this.lockKey,
      this.lockValue,
      ttlSeconds,
    );

    if (result === 0) {
      // 锁已经被其他进程获取，标记为未锁定状态
      this.isLocked = false;
      throw new Error("Lock expired or stolen");
    }
  }

  abort(reason: "rollback" | "interrupt"): void {
    super.abort(reason);

    // 清理定时器
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // 使用 Lua 脚本安全删除锁，确保只有锁的持有者才能删除
    if (this.isLocked) {
      const luaScript = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        else
          return 0
        end
      `;

      this.client
        .eval(luaScript, 1, this.lockKey, this.lockValue)
        .catch((error) => {
          // 忽略删除锁时的错误
          logger.warn("Failed to delete lock", {
            lock_key: this.lockKey,
            lock_value: this.lockValue,
            error: error,
          });
        })
        .finally(() => {
          this.isLocked = false;
        });
    }
  }
}

// Redis 适配器实现
export class RedisStreamAdapter extends StreamAdapter {
  private readonly client: RedisType;
  private readonly config: Required<RedisConfig>;

  constructor(client: RedisType, config?: RedisConfig) {
    super();
    this.client = client;
    if (!config?.url) {
      throw new Error("Redis URL is required");
    }
    this.config = {
      url: config?.url,
      keyPrefix: config?.keyPrefix ?? "langgraph:stream:",
      lockTtl: config?.lockTtl ?? 30000, // 30秒
      queueTtl: config?.queueTtl ?? 3600, // 1小时
      streamTtl: config?.streamTtl ?? 3600, // 1小时
      consumerGroupName: config?.consumerGroupName ?? "langgraph-workers",
      maxRetries: config?.maxRetries ?? 3,
      enableTtlRefresh: config?.enableTtlRefresh ?? true,
    };
  }

  getQueue(
    runId: string,
    options: { ifNotFound: "create"; resumable?: boolean },
  ): QueueInterface;

  getQueue(
    runId: string,
    options: { ifNotFound: "ignore" },
  ): QueueInterface | undefined;

  getQueue(
    runId: string,
    options: { ifNotFound: "create" | "ignore"; resumable?: boolean },
  ): QueueInterface | undefined {
    if (options.ifNotFound === "ignore") {
      // Redis 中的队列是动态的，我们假设总是存在
      // 实际的存在性检查可以在使用时进行
      return new RedisQueue(this.client, runId, this.config.keyPrefix, {
        resumable: options.resumable,
        queueTtl: this.config.queueTtl,
        streamTtl: this.config.streamTtl,
        enableTtlRefresh: this.config.enableTtlRefresh,
        consumerGroupName: this.config.consumerGroupName,
        maxRetries: this.config.maxRetries,
      });
    }

    return new RedisQueue(this.client, runId, this.config.keyPrefix, {
      resumable: options.resumable,
      queueTtl: this.config.queueTtl,
      streamTtl: this.config.streamTtl,
      enableTtlRefresh: this.config.enableTtlRefresh,
      consumerGroupName: this.config.consumerGroupName,
      maxRetries: this.config.maxRetries,
    });
  }

  async getControl(runId: string): Promise<ControlInterface | undefined> {
    const lockKey = this.getLockKey(runId);
    const exists = await this.client.exists(lockKey);

    if (!exists) {
      return undefined;
    }

    // 为已存在的锁创建控制器，但无法获取原始锁值
    // 这种情况下控制器的功能可能有限
    const dummyLockValue = `existing-${Date.now()}`;
    return new RedisCancellationAbortController(
      this.client,
      lockKey,
      this.config.lockTtl,
      dummyLockValue,
    );
  }

  private getLockKey(runId: string): string {
    return `${this.config.keyPrefix}lock:${runId}`;
  }

  /**
   * 检查 run 是否被锁定
   *
   * @deprecated 警告：此方法存在竞态条件问题。
   * 在调用 isLocked() 和 lock() 之间，锁状态可能发生变化。
   * 建议直接使用 lock() 方法并处理异常。
   */
  async isLocked(runId: string): Promise<boolean> {
    const lockKey = this.getLockKey(runId);
    const exists = await this.client.exists(lockKey);
    return exists > 0;
  }

  async lock(runId: string): Promise<AbortSignal> {
    const lockKey = this.getLockKey(runId);
    const lockValue = `${process.pid}-${Date.now()}-${Math.random()}`;

    // 使用 SET key value [NX] [PX milliseconds] 原子操作获取锁
    const result = await this.client.set(
      lockKey,
      lockValue,
      "PX",
      this.config.lockTtl,
      "NX",
    );

    if (result !== "OK") {
      // console.warn("Run already locked", { run_id: runId });
      throw new Error("Run already locked");
    }

    // 创建控制器
    const controller = new RedisCancellationAbortController(
      this.client,
      lockKey,
      this.config.lockTtl,
      lockValue,
    );

    return controller.signal;
  }

  async unlock(runId: string): Promise<void> {
    const lockKey = this.getLockKey(runId);

    // 简单删除锁，不检查所有权（兼容现有代码）
    // 在生产环境中，建议使用 Lua 脚本确保只有锁的持有者才能删除锁
    await this.client.del(lockKey);
  }

  async cleanup(): Promise<void> {
    await this.client.quit();
  }

  // 健康检查方法
  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === "PONG";
    } catch (error) {
      return false;
    }
  }

  // 获取 Redis 客户端（用于高级操作）
  getClient(): RedisType {
    return this.client;
  }

  // 清理过期的 run 相关数据
  async cleanupExpiredRuns(): Promise<number> {
    try {
      const pattern = `${this.config.keyPrefix}*`;
      const keys = await this.client.keys(pattern);

      let cleanedCount = 0;
      for (const key of keys) {
        const ttl = await this.client.ttl(key);
        // TTL 为 -1 表示没有设置过期时间，为 -2 表示 key 不存在
        if (ttl === -1) {
          // 为没有设置过期时间的 key 设置默认 TTL
          if (key.includes("stream:")) {
            await this.client.expire(key, this.config.streamTtl);
          } else if (key.includes("queue:")) {
            await this.client.expire(key, this.config.queueTtl);
          } else if (key.includes("lock:")) {
            await this.client.expire(
              key,
              Math.ceil(this.config.lockTtl / 1000),
            );
          }
          cleanedCount++;
        }
      }

      return cleanedCount;
    } catch (error) {
      console.warn("Failed to cleanup expired runs:", error);
      return 0;
    }
  }

  // 批量设置 TTL（用于数据迁移或修复）
  async batchSetTtl(pattern?: string): Promise<number> {
    try {
      const searchPattern = pattern || `${this.config.keyPrefix}*`;
      const keys = await this.client.keys(searchPattern);

      let updatedCount = 0;
      for (const key of keys) {
        if (key.includes("stream:")) {
          await this.client.expire(key, this.config.streamTtl);
        } else if (key.includes("queue:")) {
          await this.client.expire(key, this.config.queueTtl);
        } else if (key.includes("lock:")) {
          await this.client.expire(key, Math.ceil(this.config.lockTtl / 1000));
        }
        updatedCount++;
      }

      return updatedCount;
    } catch (error) {
      console.warn("Failed to batch set TTL:", error);
      return 0;
    }
  }

  // 获取 TTL 统计信息
  async getTtlStats(): Promise<{
    totalKeys: number;
    keysWithTtl: number;
    keysWithoutTtl: number;
    expiredKeys: number;
  }> {
    try {
      const pattern = `${this.config.keyPrefix}*`;
      const keys = await this.client.keys(pattern);

      let keysWithTtl = 0;
      let keysWithoutTtl = 0;
      let expiredKeys = 0;

      for (const key of keys) {
        const ttl = await this.client.ttl(key);
        if (ttl === -2) {
          expiredKeys++;
        } else if (ttl === -1) {
          keysWithoutTtl++;
        } else {
          keysWithTtl++;
        }
      }

      return {
        totalKeys: keys.length,
        keysWithTtl,
        keysWithoutTtl,
        expiredKeys,
      };
    } catch (error) {
      console.warn("Failed to get TTL stats:", error);
      return {
        totalKeys: 0,
        keysWithTtl: 0,
        keysWithoutTtl: 0,
        expiredKeys: 0,
      };
    }
  }
}
