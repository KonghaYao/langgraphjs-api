import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';

import { Database } from 'better-sqlite3';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export interface LangGraphBase {}

export class SqliteLangGraphBase extends SqliteSaver implements LangGraphBase {
  static async setupDatabase(uri: string, _?: string) {
    try {
      console.log('setup database', uri);
      // 执行 setup SQL
      await this.setup(uri);

      // 创建 SqliteSaver 实例
      const saver = SqliteSaver.fromConnString(uri);
      console.log('SQLite database opened/created successfully:', uri);
      return saver;
    } catch (error) {
      console.error('Failed to setup SQLite database:', error);
      throw error;
    }
  }

  getPool(): {
    query: (sql: string, params: any[]) => Promise<any>;
    connect: () => Promise<void>;
    release: () => Promise<void>;
  } {
    // 通过父类访问数据库实例
    const db = this.db as Database;
    return {
      query: async (sql: string, params: any[]) => {
        return await db.prepare(sql).run(params);
      },
      // sqlite  不需要操作这个
      connect: async () => {
        return;
      },
      // sqlite  不需要操作这个
      release: async () => {
        return;
      },
    };
  }

  static async setup(uri: string) {
    // 执行 sqlite.build.sql
    const sqlPath = path.join(__dirname, '../sql/sqlite.build.sql');

    if (fs.existsSync(sqlPath)) {
      const sql = fs.readFileSync(sqlPath, 'utf8');

      // 创建临时 SqliteSaver 来执行 setup SQL
      const tempSaver = SqliteSaver.fromConnString(uri);
      const db = tempSaver.db;

      // 分离 triggers 部分和其他语句
      const triggerMarker = '-- Triggers';
      let [mainSql, triggerSql] = sql.split(triggerMarker);

      // 执行普通 SQL 语句（可以用分号分割）
      if (mainSql) {
        const statements = mainSql
          .split(';')
          .map((stmt) => stmt.trim())
          .filter((stmt) => stmt.length > 0 && !stmt.startsWith('--'));

        for (const statement of statements) {
          if (statement) {
            try {
              await db.prepare(statement + ';').run();
            } catch (error) {
              console.error(
                `Error executing SQL statement: ${statement.substring(0, 50)}...`,
                error,
              );
              throw error;
            }
          }
        }
      }

      // 执行 triggers（需要特殊处理 BEGIN...END 块）
      if (triggerSql) {
        try {
          // 对于 triggers，使用 exec 方法一次性执行所有语句
          await db.exec(triggerSql);
        } catch (error) {
          console.error('Error executing triggers:', error);
          throw error;
        }
      }

      console.log('SQLite database setup success');
    } else {
      console.warn('SQLite setup file not found:', sqlPath);
    }
  }
}
