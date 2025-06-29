import { StreamAdapter } from "./stream-adapter/interface.js";
import { MemoryStreamAdapter } from "./stream-adapter/memory-adapter.mjs";
import {
  RedisStreamAdapter,
  type RedisConfig,
} from "./stream-adapter/redis-adapter.mjs";
import { logger } from "../logging.mjs";

// 适配器类型枚举
export enum StreamAdapterType {
  MEMORY = "memory",
  REDIS = "redis", // 为未来的 Redis 实现预留
}

// 配置接口
export interface StreamConfig {
  adapter: StreamAdapterType;
  options?: {
    // Redis 配置选项
    redis?: {
      host?: string;
      port?: number;
      password?: string;
      db?: number;
      keyPrefix?: string;
      lockTtl?: number; // 锁的生存时间（毫秒）
      queueTtl?: number; // 队列的生存时间（秒）
      streamTtl?: number; // Stream 的生存时间（秒）
      enableTtlRefresh?: boolean; // 是否启用 TTL 刷新
    };
    // 内存适配器配置选项
    memory?: {
      // 目前暂无特殊配置
    };
  };
}

// 适配器工厂
export class StreamAdapterFactory {
  static async create(config: StreamConfig): Promise<StreamAdapter> {
    switch (config.adapter) {
      case StreamAdapterType.MEMORY:
        return new MemoryStreamAdapter();

      case StreamAdapterType.REDIS:
        return await StreamAdapterFactory.createRedisAdapter(
          config.options?.redis ?? {},
        );

      default:
        throw new Error(`Unsupported adapter type: ${config.adapter}`);
    }
  }

  // 创建 Redis 适配器
  private static async createRedisAdapter(
    redisConfig: RedisConfig,
  ): Promise<RedisStreamAdapter> {
    try {
      // 使用 ioredis
      const { Redis } = await import("ioredis");
      const redisClient = new Redis({
        host: redisConfig.host ?? "localhost",
        port: redisConfig.port ?? 6379,
        password: redisConfig.password,
        db: redisConfig.db ?? 0,
        // retryDelayOnFailover: 100,
        // maxRetriesPerRequest: 3,
        // lazyConnect: true, // 延迟连接
      });

      return new RedisStreamAdapter(redisClient, redisConfig);
    } catch (error) {
      throw new Error(
        `Failed to create Redis adapter: ${(error as Error).message}`,
      );
    }
  }

  // 便捷方法：创建内存适配器
  static createMemory(): StreamAdapter {
    return new MemoryStreamAdapter();
  }

  // 便捷方法：从环境变量创建适配器
  static async fromEnv(): Promise<StreamAdapter> {
    const redisUrl = process.env.LANGGRAPH_REDIS;

    // 如果没有 LANGGRAPH_REDIS 环境变量，使用内存适配器
    if (!redisUrl) {
      logger.info("Using Memory For Stream Management");
      return new MemoryStreamAdapter();
    }

    // 解析 Redis URL
    try {
      logger.info("Using Redis For Stream Management");
      const redisConfig = StreamAdapterFactory.parseRedisUrl(redisUrl);

      const config: StreamConfig = {
        adapter: StreamAdapterType.REDIS,
        options: {
          redis: redisConfig,
        },
      };

      return await StreamAdapterFactory.create(config);
    } catch (error) {
      console.warn(
        "Failed to parse LANGGRAPH_REDIS URL, falling back to memory adapter:",
        error,
      );
      return new MemoryStreamAdapter();
    }
  }

  // 解析 Redis URL
  private static parseRedisUrl(redisUrl: string): RedisConfig {
    try {
      const url = new URL(redisUrl);

      // 验证协议
      if (!["redis:", "rediss:"].includes(url.protocol)) {
        throw new Error(
          `Unsupported Redis protocol: ${url.protocol}. Expected 'redis:' or 'rediss:'`,
        );
      }

      // 解析主机和端口
      const host = url.hostname || "localhost";
      const port = url.port ? parseInt(url.port) : 6379;

      // 解析密码
      let password: string | undefined;
      if (url.password) {
        password = decodeURIComponent(url.password);
      }

      // 解析数据库编号
      let db = 0;
      if (url.pathname && url.pathname !== "/") {
        const dbMatch = url.pathname.match(/^\/(\d+)$/);
        if (dbMatch) {
          db = parseInt(dbMatch[1]);
        }
      }

      // 从环境变量获取其他配置，提供默认值
      const keyPrefix = process.env.REDIS_KEY_PREFIX || "langgraph:stream:";
      const lockTtl = parseInt(process.env.REDIS_LOCK_TTL || "30000"); // 30秒
      const queueTtl = parseInt(process.env.REDIS_QUEUE_TTL || "3600"); // 1小时
      const streamTtl = parseInt(process.env.REDIS_STREAM_TTL || "3600"); // 1小时
      const enableTtlRefresh = process.env.REDIS_ENABLE_TTL_REFRESH !== "false"; // 默认启用

      return {
        host,
        port,
        password,
        db,
        keyPrefix,
        lockTtl,
        queueTtl,
        streamTtl,
        enableTtlRefresh,
      };
    } catch (error) {
      throw new Error(
        `Invalid Redis URL format: ${redisUrl}. Expected format: redis://[username:password@]host[:port][/database]`,
      );
    }
  }
}

// 默认配置
export const DEFAULT_STREAM_CONFIG: StreamConfig = {
  adapter: StreamAdapterType.MEMORY,
};

// 导出便捷函数
export async function createStreamAdapter(
  config?: Partial<StreamConfig>,
): Promise<StreamAdapter> {
  const fullConfig = { ...DEFAULT_STREAM_CONFIG, ...config };
  return await StreamAdapterFactory.create(fullConfig);
}
