import type { LangGraphRunnableConfig } from "@langchain/langgraph";

import { type RunCommand } from "../command.mjs";
import { NAMESPACE_GRAPH } from "../graph/load.mjs";
import { checkpointer } from "./checkpoint.mjs";
import { FileSystemPersistence } from "./persist.mjs";
import { store } from "./store.mjs";
import { database } from "./database.mjs";
import { Assistant } from "../schemas.mjs";
import { Threads } from "./threads.mjs";
import { Runs, StreamManager } from "./runs.mjs";
import { Assistants } from "./assistants.mjs";
import { AssistantVersion, Thread } from "@langchain/langgraph-sdk";

export type Metadata = Record<string, unknown>;

export type ThreadStatus = "idle" | "busy" | "interrupted" | "error";

export type RunStatus =
  | "pending"
  | "running"
  | "error"
  | "success"
  | "timeout"
  | "interrupted";

export type StreamMode =
  | "values"
  | "messages"
  | "messages-tuple"
  | "custom"
  | "updates"
  | "events"
  | "debug";

export type MultitaskStrategy = "reject" | "rollback" | "interrupt" | "enqueue";

export type OnConflictBehavior = "raise" | "do_nothing";

export type IfNotExists = "create" | "reject";

export interface RunnableConfig {
  tags?: string[];

  recursion_limit?: number;

  configurable?: {
    thread_id?: string;
    thread_ts?: string;
    [key: string]: unknown;
  };

  metadata?: LangGraphRunnableConfig["metadata"];
}

export interface RunKwargs {
  input?: unknown;
  command?: RunCommand;

  stream_mode?: Array<StreamMode>;

  interrupt_before?: "*" | string[] | undefined;
  interrupt_after?: "*" | string[] | undefined;

  config?: RunnableConfig;

  subgraphs?: boolean;
  temporary?: boolean;

  // TODO: implement webhook
  webhook?: unknown;

  // TODO: implement feedback_keys
  feedback_keys?: string[] | undefined;

  [key: string]: unknown;
}

export interface Run {
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

interface Store {
  runs: Record<string, Run>;
  threads: Record<string, Thread>;
  assistants: Record<string, typeof Assistant>;
  assistant_versions: AssistantVersion[];
  retry_counter: Record<string, number>;
}

export const conn = new FileSystemPersistence<Store>(
  ".langgraphjs_ops.json",
  () => ({
    runs: {},
    threads: {},
    assistants: {},
    assistant_versions: [],
    retry_counter: {},
  }),
);

export const truncate = async (flags: {
  runs?: boolean;
  threads?: boolean;
  assistants?: boolean;
  checkpointer?: boolean;
  store?: boolean;
}) => {
  const client = await database.getPool().connect();
  try {
    await client.query("BEGIN");

    if (flags.runs) {
      await client.query("DELETE FROM public.run");
    }

    if (flags.threads) {
      await client.query("DELETE FROM public.thread");
    }

    if (flags.assistants) {
      // 只保留系统创建的助手
      await client.query(`
        DELETE FROM public.assistant 
        WHERE NOT (metadata->>'created_by' = 'system' AND 
                  assistant_id = uuid_generate_v5('${NAMESPACE_GRAPH}', graph_id))
      `);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (flags.checkpointer) checkpointer.clear();
  if (flags.store) store.clear();
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isJsonbContained = (
  superset: Record<string, unknown> | undefined,
  subset: Record<string, unknown> | undefined,
): boolean => {
  if (superset == null || subset == null) return true;
  for (const [key, value] of Object.entries(subset)) {
    if (superset[key] == null) return false;

    if (isObject(value) && isObject(superset[key])) {
      if (!isJsonbContained(superset[key], value)) return false;
    } else if (superset[key] !== value) {
      return false;
    }
  }

  return true;
};

export { Assistant, Assistants, Threads, Runs, StreamManager };

export interface Checkpoint {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string | null;
  checkpoint_map: Record<string, unknown> | null;
}

export interface ThreadState {
  values: Record<string, unknown>;
  next: string[];
  checkpoint: Checkpoint | null;
  metadata: Record<string, unknown> | undefined;
  created_at: Date | null;
  parent_checkpoint: Checkpoint | null;
  tasks: any[];
}

export class Crons {}
