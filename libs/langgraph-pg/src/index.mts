import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export * from '@langchain/langgraph-checkpoint-postgres';
export interface LangGraphBase {}

export class PGLangGraphBase extends PostgresSaver implements LangGraphBase {
  static async setupDatabase(uri: string, databaseName: string) {
    const url = new URL(uri);
    const initURL = new URL(url);
    initURL.pathname = '';
    // 连接到默认数据库postgres
    const pool = new pg.Pool({
      connectionString: initURL.toString(),
      database: 'postgres', // 连接到默认数据库
    });

    try {
      // 检查数据库是否存在
      const result = await pool.query(
        `SELECT 1 FROM pg_database WHERE datname = $1`,
        [databaseName],
      );

      // 如果数据库不存在，则创建
      if (result.rows.length === 0) {
        await pool.query(`CREATE DATABASE ${databaseName}`);
      }
    } finally {
      // 关闭连接池
      await pool.end();
    }
  }

  getPool(): pg.Pool {
    /** @ts-ignore */
    return this.pool;
  }
  async setup() {
    // 执行 postgres.build.sql
    const sql = fs.readFileSync(
      path.join(__dirname, '../sql/postgres.build.sql'),
      'utf8',
    );
    await this.getPool().query(sql);
  }
}
