import { PostgresSaver } from "langgraph-pg";
import { logger } from "../logging.mjs";
import { Pool } from "pg";

class PGCheckpointSaver extends PostgresSaver {
  constructor(connString: string, options?: { schema?: string }) {
    const pool = new Pool({ connectionString: connString });
    super(pool, undefined, options);
  }
  /** @ts-ignore */
  async initialize(cwd: string) {
    // await conn.initialize(cwd);
    // await conn.with(({ storage, writes }) => {
    //   this.storage = storage;
    //   this.writes = writes;
    // });
    // return conn;
  }

  clear() {
    logger.info("cancel clear checkpoint storage");
  }

  async copy(threadId: string, newThreadId: string) {
    const thread = await this.getTuple({
      configurable: {
        thread_id: threadId,
      },
    });
    if (!thread) {
      logger.error(`copy error: thread not found: ${threadId}`);
      return;
    }

    this.put(
      {
        configurable: {
          thread_id: newThreadId,
        },
      },
      thread.checkpoint,
      thread.metadata!,
      {},
    );
    return;
  }
  /**
   * TODO: implement delete checkpoint
   */
  delete(threadId: string, run_id?: string | null) {
    logger.warn(`unimplemented delete checkpoint: ${threadId} ${run_id}`);
    return;
  }

  toJSON() {
    // Prevent serialization of internal state
    return "[PGCheckpointSaver]";
  }
}
export const checkpointer = new PGCheckpointSaver(process.env.DATABASE_URL!);

// export const checkpointer = new InMemorySaver();
