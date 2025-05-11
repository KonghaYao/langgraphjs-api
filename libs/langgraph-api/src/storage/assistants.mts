import { HTTPException } from "hono/http-exception";
import { database } from "./database.mjs";
import { handleAuthEvent, isAuthMatching } from "../auth/custom.mjs";
import type { AuthContext } from "../auth/index.mjs";
import type { Metadata, OnConflictBehavior, RunnableConfig } from "./ops.mjs";

export interface Assistant {
  name: string | undefined;
  assistant_id: string;
  graph_id: string;
  created_at: Date;
  updated_at: Date;
  version: number;
  config: RunnableConfig;
  metadata: Metadata;
  description?: string;
}

export class Assistants {
  static async *search(
    options: {
      graph_id?: string;
      metadata?: Metadata;
      limit: number;
      offset: number;
    },
    auth: AuthContext | undefined,
  ) {
    const [filters] = await handleAuthEvent(auth, "assistants:search", {
      graph_id: options.graph_id,
      metadata: options.metadata,
      limit: options.limit,
      offset: options.offset,
    });

    // 构建查询
    let query = `
      SELECT * FROM public.assistant 
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (options.graph_id != null) {
      query += ` AND graph_id = $${paramIndex}`;
      params.push(options.graph_id);
      paramIndex++;
    }

    if (options.metadata != null) {
      query += ` AND metadata @> $${paramIndex}`;
      params.push(options.metadata);
      paramIndex++;
    }

    // 添加排序和分页
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(options.limit, options.offset);

    const { rows } = await database.pool.query(query, params);

    for (const row of rows) {
      // 检查权限
      if (!isAuthMatching(row.metadata, filters)) {
        continue;
      }

      const assistant: Assistant = {
        assistant_id: row.assistant_id,
        graph_id: row.graph_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        config: row.config,
        metadata: row.metadata,
        version: row.version,
        name: row.name ?? row.graph_id,
        description: row.description,
      };

      yield assistant;
    }
  }

  static async get(
    assistant_id: string,
    auth: AuthContext | undefined,
  ): Promise<Assistant> {
    const [filters] = await handleAuthEvent(auth, "assistants:read", {
      assistant_id,
    });

    const { rows } = await database.pool.query(
      `SELECT * FROM public.assistant WHERE assistant_id = $1`,
      [assistant_id],
    );

    if (rows.length === 0) {
      throw new HTTPException(404, { message: "Assistant not found" });
    }

    const result = rows[0];

    if (!isAuthMatching(result.metadata, filters)) {
      throw new HTTPException(404, { message: "Assistant not found" });
    }

    return {
      assistant_id: result.assistant_id,
      graph_id: result.graph_id,
      created_at: result.created_at,
      updated_at: result.updated_at,
      config: result.config,
      metadata: result.metadata,
      version: result.version,
      name: result.name ?? result.graph_id,
      description: result.description,
    };
  }

  static async put(
    assistant_id: string,
    options: {
      config: RunnableConfig;
      graph_id: string;
      metadata?: Metadata;
      if_exists: OnConflictBehavior;
      name?: string;
      description?: string;
    },
    auth: AuthContext | undefined,
  ): Promise<Assistant> {
    const [filters, mutable] = await handleAuthEvent(
      auth,
      "assistants:create",
      {
        assistant_id,
        config: options.config,
        graph_id: options.graph_id,
        metadata: options.metadata,
        if_exists: options.if_exists,
        name: options.name,
      },
    );

    // 首先检查助手是否存在
    const { rows: existingRows } = await database.pool.query(
      `SELECT * FROM public.assistant WHERE assistant_id = $1`,
      [assistant_id],
    );

    if (existingRows.length > 0) {
      const existingAssistant = existingRows[0];

      if (!isAuthMatching(existingAssistant.metadata, filters)) {
        throw new HTTPException(409, { message: "Assistant already exists" });
      }

      if (options.if_exists === "raise") {
        throw new HTTPException(409, { message: "Assistant already exists" });
      }

      return {
        assistant_id: existingAssistant.assistant_id,
        graph_id: existingAssistant.graph_id,
        created_at: existingAssistant.created_at,
        updated_at: existingAssistant.updated_at,
        config: existingAssistant.config,
        metadata: existingAssistant.metadata,
        version: existingAssistant.version,
        name: existingAssistant.name ?? existingAssistant.graph_id,
        description: existingAssistant.description,
      };
    }

    const now = new Date();
    const metadata = mutable.metadata ?? ({} as Metadata);
    const name = options.name || options.graph_id;

    // 插入新助手
    const { rows } = await database.pool.query(
      `INSERT INTO public.assistant
      (assistant_id, graph_id, created_at, updated_at, config, metadata, version, name, description)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        assistant_id,
        options.graph_id,
        now,
        now,
        options.config ?? {},
        metadata,
        1,
        name,
        options.description,
      ],
    );

    // 插入版本记录
    await database.pool.query(
      `INSERT INTO public.assistant_versions
      (assistant_id, version, graph_id, config, metadata, created_at, name)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        assistant_id,
        1,
        options.graph_id,
        options.config ?? {},
        metadata,
        now,
        name,
      ],
    );

    const result = rows[0];
    return {
      assistant_id: result.assistant_id,
      graph_id: result.graph_id,
      created_at: result.created_at,
      updated_at: result.updated_at,
      config: result.config,
      metadata: result.metadata,
      version: result.version,
      name: result.name ?? result.graph_id,
      description: result.description,
    };
  }

  static async delete(
    assistant_id: string,
    auth: AuthContext | undefined,
  ): Promise<string[]> {
    const [filters] = await handleAuthEvent(auth, "assistants:delete", {
      assistant_id,
    });

    // 获取助手信息
    const { rows } = await database.pool.query(
      `SELECT * FROM public.assistant WHERE assistant_id = $1`,
      [assistant_id],
    );

    if (rows.length === 0) {
      throw new HTTPException(404, { message: "Assistant not found" });
    }

    const assistant = rows[0];

    if (!isAuthMatching(assistant.metadata, filters)) {
      throw new HTTPException(404, { message: "Assistant not found" });
    }

    // 开启事务
    const client = await database.pool.connect();
    try {
      await client.query("BEGIN");

      // 删除相关的运行记录
      await client.query(`DELETE FROM public.run WHERE assistant_id = $1`, [
        assistant_id,
      ]);

      // 删除助手版本
      await client.query(
        `DELETE FROM public.assistant_versions WHERE assistant_id = $1`,
        [assistant_id],
      );

      // 删除助手
      await client.query(
        `DELETE FROM public.assistant WHERE assistant_id = $1`,
        [assistant_id],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return [assistant_id];
  }

  static async setLatest(
    assistant_id: string,
    version: number,
    auth: AuthContext | undefined,
  ): Promise<Assistant> {
    const [filters] = await handleAuthEvent(auth, "assistants:update", {
      assistant_id,
      version,
    });

    // 获取助手信息
    const { rows: assistantRows } = await database.pool.query(
      `SELECT * FROM public.assistant WHERE assistant_id = $1`,
      [assistant_id],
    );

    if (assistantRows.length === 0) {
      throw new HTTPException(404, { message: "Assistant not found" });
    }

    const assistant = assistantRows[0];

    if (!isAuthMatching(assistant.metadata, filters)) {
      throw new HTTPException(404, { message: "Assistant not found" });
    }

    // 获取指定版本信息
    const { rows: versionRows } = await database.pool.query(
      `SELECT * FROM public.assistant_versions 
       WHERE assistant_id = $1 AND version = $2`,
      [assistant_id, version],
    );

    if (versionRows.length === 0) {
      throw new HTTPException(404, { message: "Assistant version not found" });
    }

    const assistantVersion = versionRows[0];
    const now = new Date();

    // 更新助手到指定版本
    const { rows } = await database.pool.query(
      `UPDATE public.assistant
       SET config = $1, metadata = $2, version = $3, name = $4, updated_at = $5
       WHERE assistant_id = $6
       RETURNING *`,
      [
        assistantVersion.config,
        assistantVersion.metadata,
        assistantVersion.version,
        assistantVersion.name,
        now,
        assistant_id,
      ],
    );

    const result = rows[0];
    return {
      assistant_id: result.assistant_id,
      graph_id: result.graph_id,
      created_at: result.created_at,
      updated_at: result.updated_at,
      config: result.config,
      metadata: result.metadata,
      version: result.version,
      name: result.name ?? result.graph_id,
      description: result.description,
    };
  }
}
