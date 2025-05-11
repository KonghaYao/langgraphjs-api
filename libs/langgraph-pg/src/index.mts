import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import {
  BaseCheckpointSaver,
  SerializerProtocol,
} from '@langchain/langgraph-checkpoint';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
export * from '@langchain/langgraph-checkpoint-postgres';
export abstract class LangGraphBase {
  abstract checkpointSaver: BaseCheckpointSaver;
  abstract setup(): Promise<void>;
}

export class PGLangGraphBase extends LangGraphBase {
  checkpointSaver: PostgresSaver;
  pool: pg.Pool;
  constructor(urlOrSaver?: string | PostgresSaver) {
    super();
    this.checkpointSaver =
      urlOrSaver instanceof PostgresSaver
        ? urlOrSaver
        : typeof urlOrSaver === 'string'
        ? PostgresSaver.fromConnString(urlOrSaver)
        : PostgresSaver.fromConnString(process.env.DATABASE_URL!);
    /** @ts-ignore */
    this.pool = this.checkpointSaver.pool;
  }

  async setup() {
    await this.createDatabase(process.env.DATABASE_NAME!);
    // 执行 postgres.build.sql
    const sql = fs.readFileSync(
      path.join(
        path.dirname(new URL(import.meta.url).pathname),
        'postgres.build.sql',
      ),
      'utf8',
    );
    await this.pool.query(sql);
  }
  // 先创建数据库，然后再进行 setup
  private createDatabase(databaseName: string) {
    return this.pool.query(`CREATE DATABASE IF NOT EXISTS ${databaseName}`);
  }
}
