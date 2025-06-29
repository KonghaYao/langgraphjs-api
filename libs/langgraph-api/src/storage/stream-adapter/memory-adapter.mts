import {
  StreamAdapter,
  type QueueInterface,
  type ControlInterface,
  type Message,
} from "./interface.js";
// 错误类
class TimeoutError extends Error {}
class AbortError extends Error {}

// 订阅者接口
interface Subscriber {
  id: string;
  resolve: (value: [string, Message]) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
  lastEventId?: string;
  resumable: boolean;
}

// 基于订阅机制的内存队列实现
class MemoryQueue implements QueueInterface {
  private log: Message[] = [];
  private subscribers = new Map<string, Subscriber>();
  private nextId = 0;
  private resumable: boolean;

  constructor(options?: { resumable?: boolean }) {
    this.resumable = options?.resumable ?? false;
  }

  push(item: Message) {
    this.log.push(item);
    const currentId = this.nextId;
    this.nextId += 1;

    // 通知所有订阅者有新消息可用
    this.notifySubscribers(currentId, item);
  }

  async get(options: {
    timeout: number;
    signal?: AbortSignal;
    lastEventId?: string;
  }): Promise<[string, Message]> {
    if (this.resumable) {
      return await this.getResumableMessage(options);
    } else {
      return await this.getNonResumableMessage(options);
    }
  }

  // 可恢复模式：支持从指定位置读取
  private async getResumableMessage(options: {
    timeout: number;
    signal?: AbortSignal;
    lastEventId?: string;
  }): Promise<[string, Message]> {
    const lastEventId = options.lastEventId;

    // 首先检查是否有历史消息可读
    let targetId = lastEventId != null ? +lastEventId + 1 : null;
    if (
      targetId == null ||
      isNaN(targetId) ||
      targetId < 0 ||
      targetId >= this.log.length
    ) {
      targetId = null;
    }

    if (targetId != null) {
      return [String(targetId), this.log[targetId]];
    }

    // 没有历史消息，订阅新消息
    return await this.subscribeToNewMessage(options);
  }

  // 非可恢复模式：从队列头部弹出消息
  private async getNonResumableMessage(options: {
    timeout: number;
    signal?: AbortSignal;
  }): Promise<[string, Message]> {
    // 检查是否有现有消息
    if (this.log.length > 0) {
      const nextId = this.nextId - this.log.length;
      const nextItem = this.log.shift()!;
      return [String(nextId), nextItem];
    }

    // 没有消息，订阅新消息
    return await this.subscribeToNewMessage(options);
  }

  // 订阅新消息的核心方法
  private async subscribeToNewMessage(options: {
    timeout: number;
    signal?: AbortSignal;
    lastEventId?: string;
  }): Promise<[string, Message]> {
    if (options.signal?.aborted) {
      throw new AbortError("Operation was aborted");
    }

    return new Promise<[string, Message]>((resolve, reject) => {
      // 生成唯一的订阅者 ID
      const subscriberId = `sub_${Date.now()}_${Math.random()}`;

      // 设置超时
      const timeoutId = setTimeout(() => {
        this.unsubscribe(subscriberId);
        reject(new TimeoutError("Get operation timed out"));
      }, options.timeout);

      // 设置中断监听
      const abortHandler = () => {
        this.unsubscribe(subscriberId);
        reject(new AbortError("Operation was aborted"));
      };

      options.signal?.addEventListener("abort", abortHandler);

      // 清理函数
      const cleanup = () => {
        clearTimeout(timeoutId);
        options.signal?.removeEventListener("abort", abortHandler);
      };

      // 创建订阅者
      const subscriber: Subscriber = {
        id: subscriberId,
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
        cleanup,
        lastEventId: options.lastEventId,
        resumable: this.resumable,
      };

      // 注册订阅者
      this.subscribers.set(subscriberId, subscriber);
    });
  }

  // 通知订阅者有新消息
  private notifySubscribers(messageId: number, message: Message) {
    for (const subscriber of [...this.subscribers.values()]) {
      try {
        if (subscriber.resumable) {
          // 可恢复模式：直接发送消息和ID
          this.unsubscribe(subscriber.id);
          subscriber.resolve([String(messageId), message]);
        } else {
          // 非可恢复模式：从队列中弹出消息
          if (this.log.length > 0) {
            const nextId = this.nextId - this.log.length;
            const nextItem = this.log.shift()!;
            this.unsubscribe(subscriber.id);
            subscriber.resolve([String(nextId), nextItem]);
          }
        }
      } catch (error) {
        // 如果通知失败，清理订阅者
        this.unsubscribe(subscriber.id);
        subscriber.reject(
          error instanceof Error ? error : new Error("Unknown error"),
        );
      }
    }
  }

  // 取消订阅
  private unsubscribe(subscriberId: string) {
    const subscriber = this.subscribers.get(subscriberId);
    if (subscriber) {
      subscriber.cleanup();
      this.subscribers.delete(subscriberId);
    }
  }

  // 清理所有订阅者（用于队列销毁时）
  cleanup() {
    for (const subscriber of this.subscribers.values()) {
      subscriber.reject(new Error("Queue is being destroyed"));
    }
    this.subscribers.clear();
    this.log = [];
  }
}

// 内存控制器实现
class MemoryCancellationAbortController
  extends AbortController
  implements ControlInterface
{
  abort(reason: "rollback" | "interrupt") {
    super.abort(reason);
  }
}

// 内存适配器实现 - 基于订阅机制
export class MemoryStreamAdapter extends StreamAdapter {
  private readers: Record<string, QueueInterface> = {};
  private control: Record<string, ControlInterface> = {};

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
    if (this.readers[runId] == null) {
      if (options?.ifNotFound === "create") {
        this.readers[runId] = new MemoryQueue({ resumable: options.resumable });
      } else {
        return undefined;
      }
    }

    return this.readers[runId];
  }

  getControl(runId: string): ControlInterface | undefined {
    if (this.control[runId] == null) return undefined;
    return this.control[runId];
  }

  /**
   * 检查 run 是否被锁定
   *
   * @deprecated 警告：此方法存在竞态条件问题。
   * 在调用 isLocked() 和 lock() 之间，锁状态可能发生变化。
   * 建议直接使用 lock() 方法并处理异常。
   */
  isLocked(runId: string): boolean {
    return this.control[runId] != null;
  }

  lock(runId: string): AbortSignal {
    if (this.control[runId] != null) {
      throw new Error("Run already locked");
    }
    this.control[runId] = new MemoryCancellationAbortController();
    return this.control[runId].signal;
  }

  unlock(runId: string): void {
    delete this.control[runId];
  }

  async cleanup(): Promise<void> {
    // 清理所有队列的订阅者
    for (const queue of Object.values(this.readers)) {
      await queue.cleanup?.();
    }

    // 清理所有队列和控制器
    this.readers = {};
    this.control = {};
  }
}
