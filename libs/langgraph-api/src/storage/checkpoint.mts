import { PGCheckpointSaver } from "./checkpoint/postgres.js";
import { SqliteCheckpointSaver } from "./checkpoint/sqlite.js";

let checkpointer: PGCheckpointSaver | SqliteCheckpointSaver;
if (process.env.SQLITE_DATABASE_URL || !process.env.DATABASE_URL) {
  // #if [node-sqlite]
  checkpointer = await import("./checkpoint/sqlite.js").then(
    (module) => module.checkpointer,
  );
  // #endif
} else {
  // #if [node-postgres]
  checkpointer = await import("./checkpoint/postgres.js").then(
    (module) => module.checkpointer,
  );
  // #endif
}

if (!checkpointer) {
  throw new Error("No checkpoint saver found");
}

export { checkpointer };
