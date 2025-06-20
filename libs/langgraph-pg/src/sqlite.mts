import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';

import { Database } from 'better-sqlite3';
export * from '@langchain/langgraph-checkpoint-sqlite';
export interface LangGraphBase {}

interface Client {
  query: (sql: string, params?: any[]) => Promise<any>;
  connect: () => Promise<Client>;
  release: () => Promise<Client>;
}

export class SqliteLangGraphBase extends SqliteSaver implements LangGraphBase {
  private connectionQueue: Array<{
    resolve: (client: Client) => void;
    reject: (error: Error) => void;
  }> = [];
  private isConnected = false;
  private connectedClient: Client | null = null;

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

  getPool(): Client {
    // this.isSetup = true;
    // 通过父类访问数据库实例
    const db = this.db as Database;
    const client: Client = {
      query: async (originalSql, params = []) => {
        const jsonEncode = (param: any) => {
          if (param instanceof Date) {
            return param.toISOString();
          } else if (typeof param === 'object' && param !== null) {
            return JSON.stringify(param);
          }
          return param;
        };

        const jsonDecode = (param: string | any) => {
          if (typeof param === 'string') {
            // ISO 日期格式的正则表达式，完整匹配整个字符串
            if (
              /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(param)
            ) {
              // 检测 ISO 日期字符串格式，兼容毫秒可选
              return new Date(param);
            } else if (
              param.length >= 2 &&
              param[0] === '{' &&
              param[param.length - 1] === '}'
            ) {
              // 检测 JSON 对象格式
              try {
                return JSON.parse(param);
              } catch (e) {
                return param;
              }
            } else if (
              param.length >= 2 &&
              param[0] === '[' &&
              param[param.length - 1] === ']'
            ) {
              // 检测 JSON 数组格式
              try {
                return JSON.parse(param);
              } catch (e) {
                return param;
              }
            }
            return param;
          }
          return param;
        };
        const decodeRow = (row: any) => {
          return Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              jsonDecode(value as any),
            ]),
          );
        };
        const sql = originalSql
          .replace(/public./g, '')
          .replace(/\$\d+/g, '?')
          .replace('RETURNING *', '')
          .replaceAll(/@\>/g, 'LIKE')
          .replace('values', '"values"');
        try {
          params = params.map((param) => {
            if (typeof param === 'undefined') {
              return null;
            } else if (
              param instanceof Date ||
              (typeof param === 'object' && param !== null)
            ) {
              return jsonEncode(param);
            }
            return param;
          });

          if (sql.includes('SELECT')) {
            const data = await db.prepare(sql).all(...params);

            return { rows: data.map(decodeRow) };
          }
          if (sql.includes('INSERT')) {
            const stmt = db.prepare(sql);
            const data = await stmt.run(...params);
            const sheetName = sql.split('INSERT INTO ')[1].split(' ')[0];
            const querySQL = `SELECT * FROM ${sheetName} WHERE rowid = ?`;
            const row = await db
              .prepare(querySQL) // 获取插入的行
              .all(data.lastInsertRowid);
            return { rows: row.map(decodeRow) };
          }
          if (sql.includes('UPDATE')) {
            const stmt = db.prepare(sql);
            await stmt.run(...params);
            const sheetName = originalSql.split('UPDATE ')[1].split(' ')[0];

            // 从 originalSql 中获取 where 后面的条件
            const where = originalSql.split('WHERE ')[1].split('\n')[0];
            // 判断是 $几，然后取值
            const queryParams: any[] = [];
            const whereParams = where.replace(/\$(\d+)/g, (_, index) => {
              queryParams.push(params[index - 1]);
              return '?';
            });
            const querySQL = `SELECT * FROM ${sheetName.replace(
              'public.',
              '',
            )} WHERE ${whereParams}`;
            const row = await db
              .prepare(querySQL) // 获取插入的行
              .all(...queryParams);
            return { rows: row.map(decodeRow) };
          }

          return await db.prepare(sql).run(...params);
        } catch (error) {
          console.error(sql);
          throw error;
        }
      },
      connect: async () => {
        return this.acquireConnection(client);
      },
      release: async () => {
        return this.releaseConnection(client);
      },
    };
    return client;
  }

  private async acquireConnection(client: Client): Promise<Client> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        // 如果没有连接占用，直接分配
        this.isConnected = true;
        this.connectedClient = client;
        resolve(client);
      } else {
        // 如果已有连接占用，加入队列等待
        this.connectionQueue.push({ resolve, reject });
      }
    });
  }

  private async releaseConnection(client: Client): Promise<Client> {
    if (this.connectedClient === client) {
      this.isConnected = false;
      this.connectedClient = null;

      // 处理等待队列中的下一个请求
      if (this.connectionQueue.length > 0) {
        const { resolve } = this.connectionQueue.shift()!;
        this.isConnected = true;
        this.connectedClient = client;
        resolve(client);
      }
    }
    return client;
  }

  static async setup(uri: string) {
    // 执行 sqlite.build.sql

    const { default: sql } = await import('../sql/sqlite.build.sql?raw');

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
  }
}
