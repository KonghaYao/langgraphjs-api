import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import pg from 'pg';

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
        console.log('create database success', databaseName);
        const setupPool = new pg.Pool({
          connectionString: uri,
        });
        await this.setup(setupPool);
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
  static async setup(pool: pg.Pool) {
    // 执行 postgres.build.sql
    const { default: sql } = await import('../sql/postgres.build.sql?raw');
    await pool.query(sql);
    console.log('setup database success');
  }
}
