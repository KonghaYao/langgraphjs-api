import { SqliteLangGraphBase } from "@langgraph-js/langgraph-pg/dist/sqlite.mjs";
import { logger } from "../../logging.mjs";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

export class SqliteCheckpointSaver extends SqliteLangGraphBase {
  //   constructor(connString: string) {
  //     super(connString);
  //   }
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

  // TODO checkpoint 的拷贝有问题
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
        ...thread.config,
        configurable: {
          ...thread.config.configurable,
          thread_id: newThreadId,
          checkpoint_id: thread.parentConfig?.configurable?.checkpoint_id,
        },
      },
      thread.checkpoint,
      thread.metadata!,
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
  static fromConnString(connStringOrLocalPath: string) {
    return new SqliteCheckpointSaver(
      SqliteSaver.fromConnString(connStringOrLocalPath).db,
    );
  }

  toJSON() {
    // Prevent serialization of internal state
    return "[PGCheckpointSaver]";
  }
}

let checkpointer: SqliteCheckpointSaver;
const url = process.env.SQLITE_DATABASE_URL!;

try {
  await SqliteCheckpointSaver.setupDatabase(url);
} catch (error) {
  // 忽略建表错误
  // console.error(error);
}
checkpointer = SqliteCheckpointSaver.fromConnString(url);

export { checkpointer };
