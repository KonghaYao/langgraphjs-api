// 使用全局的 AbortSignal 类型

// 队列消息接口
export interface Message {
  topic: `run:${string}:stream:${string}`;
  data: unknown;
}

// 队列接口
export interface QueueInterface {
  push(item: Message): void | Promise<void>;
  get(options: {
    timeout: number;
    signal?: AbortSignal;
    lastEventId?: string;
  }): Promise<[string, Message]>;
  // 可选的清理方法，用于取消所有订阅和释放资源
  cleanup?(): void | Promise<void>;
}

// 控制器接口
export interface ControlInterface {
  readonly signal: AbortSignal;
  abort(reason: "rollback" | "interrupt"): void;
}

// StreamManager 适配器抽象接口
export abstract class StreamAdapter {
  abstract getQueue(
    runId: string,
    options: { ifNotFound: "create"; resumable?: boolean },
  ): QueueInterface;

  abstract getQueue(
    runId: string,
    options: { ifNotFound: "ignore" },
  ): QueueInterface | undefined;

  abstract getQueue(
    runId: string,
    options: { ifNotFound: "create" | "ignore"; resumable?: boolean },
  ): QueueInterface | undefined;

  abstract getControl(runId: string): Promise<ControlInterface | undefined>;

  abstract isLocked(runId: string): boolean | Promise<boolean>;

  abstract lock(runId: string): Promise<AbortSignal>;

  abstract unlock(runId: string): void | Promise<void>;

  // 清理资源的方法，用于优雅关闭
  abstract cleanup?(): Promise<void>;
}
