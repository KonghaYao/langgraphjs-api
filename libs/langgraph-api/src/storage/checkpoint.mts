import { logger } from "../logging.mjs";
import { PGCheckpointSaver } from "./checkpoint/postgres.js";
import { SqliteCheckpointSaver } from "./checkpoint/sqlite.js";

let checkpointer: PGCheckpointSaver | SqliteCheckpointSaver;
if (process.env.SQLITE_DATABASE_URL || !process.env.DATABASE_URL) {
  // #if [node-sqlite]
  logger.info("using sqlite checkpoint");
  checkpointer = await import("./checkpoint/sqlite.js").then(
    (module) => module.checkpointer,
  );
  // #endif
} else {
  // #if [node-postgres]
  logger.info("using postgres checkpoint");
  checkpointer = await import("./checkpoint/postgres.js").then(
    (module) => module.checkpointer,
  );
  // #endif
}

if (!checkpointer) {
  throw new Error("No checkpoint saver found");
}

export { checkpointer };
