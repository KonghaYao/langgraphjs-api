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
  ): AsyncGenerator<Assistant> {
    const [filters] = await handleAuthEvent(auth, "assistants:search", {
      graph_id: options.graph_id,
      metadata: options.metadata,
      limit: options.limit,
      offset: options.offset,
    });

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

    query += ` ORDER BY created_at DESC`;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(options.limit, options.offset);

    const { rows } = await database.pool.query(query, params);

    for (const row of rows) {
      if (!isAuthMatching(row.metadata, filters)) {
        continue;
      }

      const assistant: Assistant = {
        assistant_id: row.assistant_id,
        graph_id: row.graph_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        version: row.version,
        config: row.config,
        metadata: row.metadata,
        name: row.name,
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
      throw new HTTPException(404, {
        message: `Assistant with ID ${assistant_id} not found`,
      });
    }

    const result = rows[0];

    if (!isAuthMatching(result.metadata, filters)) {
      throw new HTTPException(404, {
        message: `Assistant with ID ${assistant_id} not found`,
      });
    }

    return {
      assistant_id: result.assistant_id,
      graph_id: result.graph_id,
      created_at: result.created_at,
      updated_at: result.updated_at,
      version: result.version,
      config: result.config,
      metadata: result.metadata,
      name: result.name,
      description: result.description,
    };
  }

  static async put(
    assistant_id: string,
    options: {
      graph_id: string;
      config?: RunnableConfig;
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
        graph_id: options.graph_id,
        metadata: options.metadata,
        if_exists: options.if_exists,
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

      if (options?.if_exists === "raise") {
        throw new HTTPException(409, { message: "Assistant already exists" });
      }

      return {
        assistant_id: existingAssistant.assistant_id,
        graph_id: existingAssistant.graph_id,
        created_at: existingAssistant.created_at,
        updated_at: existingAssistant.updated_at,
        version: existingAssistant.version,
        config: existingAssistant.config,
        metadata: existingAssistant.metadata,
        name: existingAssistant.name,
        description: existingAssistant.description,
      };
    }

    const now = new Date();
    const version = 1;

    // 开启事务
    const client = await database.pool.connect();
    try {
      await client.query("BEGIN");

      // 插入新助手
      const { rows } = await client.query(
        `INSERT INTO public.assistant
        (assistant_id, graph_id, created_at, updated_at, version, config, metadata, name, description)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          assistant_id,
          options.graph_id,
          now,
          now,
          version,
          options.config ?? {},
          mutable?.metadata ?? {},
          options.name,
          options.description,
        ],
      );

      // 添加版本记录
      await client.query(
        `INSERT INTO public.assistant_versions
        (assistant_id, version, graph_id, config, metadata, created_at, name)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          assistant_id,
          version,
          options.graph_id,
          options.config ?? {},
          mutable?.metadata ?? {},
          now,
          options.name,
        ],
      );

      await client.query("COMMIT");

      const result = rows[0];

      return {
        assistant_id: result.assistant_id,
        graph_id: result.graph_id,
        created_at: result.created_at,
        updated_at: result.updated_at,
        version: result.version,
        config: result.config,
        metadata: result.metadata,
        name: result.name,
        description: result.description,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  static async patch(
    assistant_id: string,
    options: {
      config?: RunnableConfig;
      metadata?: Metadata;
      name?: string;
      description?: string;
    },
    auth: AuthContext | undefined,
  ): Promise<Assistant> {
    const [filters, mutable] = await handleAuthEvent(
      auth,
      "assistants:update",
      {
        assistant_id,
        metadata: options.metadata,
      },
    );

    // 获取现有助手信息
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

    const now = new Date();
    const newVersion = assistant.version + 1;

    // 准备更新数据
    let updatedMetadata = assistant.metadata;
    if (mutable.metadata != null) {
      updatedMetadata = {
        ...assistant.metadata,
        ...mutable.metadata,
      };
    }

    const updatedConfig =
      options.config !== undefined
        ? { ...assistant.config, ...options.config }
        : assistant.config;

    const updatedName =
      options.name !== undefined ? options.name : assistant.name;

    const updatedDescription =
      options.description !== undefined
        ? options.description
        : assistant.description;

    // 开启事务
    const client = await database.pool.connect();
    try {
      await client.query("BEGIN");

      // 更新助手主记录
      const { rows } = await client.query(
        `UPDATE public.assistant 
         SET metadata = $1, config = $2, updated_at = $3, version = $4, name = $5, description = $6
         WHERE assistant_id = $7
         RETURNING *`,
        [
          updatedMetadata,
          updatedConfig,
          now,
          newVersion,
          updatedName,
          updatedDescription,
          assistant_id,
        ],
      );

      // 添加新版本记录
      await client.query(
        `INSERT INTO public.assistant_versions
        (assistant_id, version, graph_id, config, metadata, created_at, name)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          assistant_id,
          newVersion,
          assistant.graph_id,
          updatedConfig,
          updatedMetadata,
          now,
          updatedName,
        ],
      );

      await client.query("COMMIT");

      const result = rows[0];
      return {
        assistant_id: result.assistant_id,
        graph_id: result.graph_id,
        created_at: result.created_at,
        updated_at: result.updated_at,
        version: result.version,
        config: result.config,
        metadata: result.metadata,
        name: result.name,
        description: result.description,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  static async getVersions(
    assistant_id: string,
    options: {
      limit: number;
      offset: number;
      metadata?: Metadata;
    },
    auth: AuthContext | undefined,
  ): Promise<
    Array<{
      assistant_id: string;
      version: number;
      graph_id: string;
      config: RunnableConfig;
      metadata: Metadata;
      created_at: Date;
      name?: string;
    }>
  > {
    const [filters] = await handleAuthEvent(auth, "assistants:read", {
      assistant_id,
    });

    // 首先检查助手是否存在并验证权限
    const { rows: assistantRows } = await database.pool.query(
      `SELECT * FROM public.assistant WHERE assistant_id = $1`,
      [assistant_id],
    );

    if (assistantRows.length === 0) {
      throw new HTTPException(404, { message: "Assistant not found" });
    }

    if (!isAuthMatching(assistantRows[0].metadata, filters)) {
      throw new HTTPException(404, { message: "Assistant not found" });
    }

    // 构建查询
    let query = `
      SELECT * FROM public.assistant_versions 
      WHERE assistant_id = $1
    `;
    const params: any[] = [assistant_id];
    let paramIndex = 2;

    if (options.metadata != null) {
      query += ` AND metadata @> $${paramIndex}`;
      params.push(options.metadata);
      paramIndex++;
    }

    query += ` ORDER BY version DESC`;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(options.limit, options.offset);

    const { rows } = await database.pool.query(query, params);

    return rows.map((row) => ({
      assistant_id: row.assistant_id,
      version: row.version,
      graph_id: row.graph_id,
      config: row.config,
      metadata: row.metadata,
      created_at: row.created_at,
      name: row.name,
    }));
  }

  static async delete(
    assistant_id: string,
    auth: AuthContext | undefined,
  ): Promise<string[]> {
    const [filters] = await handleAuthEvent(auth, "assistants:delete", {
      assistant_id,
    });

    const { rows } = await database.pool.query(
      `SELECT * FROM public.assistant WHERE assistant_id = $1`,
      [assistant_id],
    );

    if (rows.length === 0) {
      throw new HTTPException(404, {
        message: `Assistant with ID ${assistant_id} not found`,
      });
    }

    const assistant = rows[0];

    if (!isAuthMatching(assistant.metadata, filters)) {
      throw new HTTPException(404, {
        message: `Assistant with ID ${assistant_id} not found`,
      });
    }

    await database.pool.query(
      `DELETE FROM public.assistant WHERE assistant_id = $1`,
      [assistant_id],
    );

    return [assistant_id];
  }

  static async setLatest(
    assistant_id: string,
    version: number,
    auth: AuthContext | undefined,
  ): Promise<Assistant> {
    const [filters] = await handleAuthEvent(auth, "assistants:update", {
      assistant_id,
    });

    // 首先检查助手是否存在
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

    // 检查请求的版本是否存在
    const { rows: versionRows } = await database.pool.query(
      `SELECT * FROM public.assistant_versions 
       WHERE assistant_id = $1 AND version = $2`,
      [assistant_id, version],
    );

    if (versionRows.length === 0) {
      throw new HTTPException(404, {
        message: `Version ${version} for assistant ${assistant_id} not found`,
      });
    }

    const versionData = versionRows[0];
    const now = new Date();

    // 更新助手为指定版本
    const { rows } = await database.pool.query(
      `UPDATE public.assistant 
       SET config = $1, metadata = $2, updated_at = $3, version = $4, graph_id = $5, name = $6
       WHERE assistant_id = $7
       RETURNING *`,
      [
        versionData.config,
        versionData.metadata,
        now,
        versionData.version,
        versionData.graph_id,
        versionData.name,
        assistant_id,
      ],
    );

    const result = rows[0];
    return {
      assistant_id: result.assistant_id,
      graph_id: result.graph_id,
      created_at: result.created_at,
      updated_at: result.updated_at,
      version: result.version,
      config: result.config,
      metadata: result.metadata,
      name: result.name,
      description: result.description,
    };
  }
}
