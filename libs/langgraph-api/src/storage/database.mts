import { PGLangGraphBase } from "@langgraph-js/langgraph-pg";
import { checkpointer } from "./checkpoint.mjs";
export const database = new PGLangGraphBase(checkpointer);
if (process.env.DATABASE_INIT) {
  await database.setup();
}
