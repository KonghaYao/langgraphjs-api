import { build } from 'vite';
import fs from 'fs';
import path from 'path';
import { nodeExternals } from 'rollup-plugin-node-externals';
// import { visualizer } from "rollup-plugin-visualizer";
import condition from './condition.js';

// 类型定义
export interface LanggraphConfig {
  node_version?: string;
  dependencies?: string[];
  graphs: Record<string, string>;
  env?: string;
  auth?: {
    path: string;
  };
  dist?: string;
  callbacks?: {
    path: string;
  };
}

interface BuildEntries {
  [key: string]: string;
}

interface HelperEntries {
  tempDir: string;
  entries: BuildEntries;
}

// 常量定义
const INVALID_AGENT_NAMES = ['auth', 'dev', 'start', 'entrypoint', 'callbacks'];
const DEFAULT_DIST_DIR = './dist';

/**
 * 读取并验证 Langgraph 配置
 */
function loadConfig(cwd: string): LanggraphConfig {
  const configPath = path.join(cwd, 'langgraph.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Cannot find langgraph.json in ${cwd}`);
  }

  const config: LanggraphConfig = JSON.parse(
    fs.readFileSync(configPath, 'utf-8'),
  );

  if (!config.graphs || Object.keys(config.graphs).length === 0) {
    throw new Error('No graphs defined in langgraph.json');
  }

  return config;
}

/**
 * 准备输出目录
 */
function prepareOutputDirectory(config: LanggraphConfig, cwd: string): string {
  const distDir = config.dist || DEFAULT_DIST_DIR;
  const absoluteDistDir = path.resolve(cwd, distDir);

  if (!fs.existsSync(absoluteDistDir)) {
    fs.mkdirSync(absoluteDistDir, { recursive: true });
  }

  return absoluteDistDir;
}

/**
 * 处理构建入口点
 */
function prepareEntries(config: LanggraphConfig, cwd: string): BuildEntries {
  const entries: BuildEntries = {};

  // 处理图形入口点
  for (const [name, graphPath] of Object.entries(config.graphs)) {
    const [filePath] = graphPath.split(':');
    entries[name] = path.resolve(cwd, filePath);
  }

  // 处理认证入口点
  if (config.auth?.path) {
    const [filePath] = config.auth.path.split(':');
    entries['auth'] = path.resolve(cwd, filePath);
  }
  if (config.callbacks?.path) {
    const filePath = config.callbacks.path;
    entries['callbacks'] = path.resolve(cwd, filePath);
  }

  return entries;
}

/**
 * 创建用于构建的调整后的配置
 */
function createBuildConfig(config: LanggraphConfig): LanggraphConfig {
  const buildConfig = { ...config };

  // 调整图形路径
  if (buildConfig.graphs) {
    const adjustedGraphs: Record<string, string> = {};
    for (const [name, graphPath] of Object.entries(buildConfig.graphs)) {
      const [_, exportName] = graphPath.split(':');
      if (INVALID_AGENT_NAMES.includes(name)) {
        throw new Error(`Invalid agent name: ${name} ${graphPath}`);
      } else {
        adjustedGraphs[name] = `./${name}.js:${exportName || name}`;
      }
    }
    buildConfig.graphs = adjustedGraphs;
  }

  // 调整认证路径
  if (buildConfig.auth?.path) {
    const [_, exportName] = buildConfig.auth.path.split(':');
    buildConfig.auth.path = `./auth.js:${exportName || 'auth'}`;
  }

  if (buildConfig.callbacks?.path) {
    buildConfig.callbacks.path = `./callbacks.js`;
  }

  return buildConfig;
}

/**
 * 生成开发服务器代码
 */
function generateDevCode(buildConfig: LanggraphConfig): string {
  return `import { startServer } from "@langgraph-js/api/server";

const config = ${JSON.stringify(buildConfig, null, 2)};
const result = await startServer({
    cwd: process.cwd(),
    ...config,
});
console.log("LangGraph is running on http://" + result.host);
console.log(process.cwd());
`;
}

/**
 * 生成Hono服务器入口点代码
 */
function generateEntrypointCode(buildConfig: LanggraphConfig): string {
  return `import { createHonoServer } from "@langgraph-js/api/server";
import fs from "node:fs";
import path from "node:path";

const config = ${JSON.stringify(buildConfig, null, 2)};
const schema = {
    cwd: process.cwd(),
    ...config,
};
const result = await createHonoServer(schema);

export default {
    fetch: result.app.fetch,
};
`;
}

/**
 * 准备辅助入口文件
 */
function prepareHelperEntries(
  buildConfig: LanggraphConfig,
  cwd: string,
): HelperEntries {
  const tempDir = path.join(cwd, '.langgraph-temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const helperEntries: BuildEntries = {};

  // 创建开发服务器入口文件
  const startFilePath = path.join(tempDir, 'start.js');
  fs.writeFileSync(startFilePath, generateDevCode(buildConfig));
  helperEntries['start'] = startFilePath;

  // 创建Hono服务器入口文件
  const entrypointFilePath = path.join(tempDir, 'entrypoint.js');
  fs.writeFileSync(entrypointFilePath, generateEntrypointCode(buildConfig));
  helperEntries['entrypoint'] = entrypointFilePath;

  return { tempDir, entries: helperEntries };
}

/**
 * 构建 Langgraph 项目
 */
export async function buildLanggraph(
  cwd: string = process.cwd(),
): Promise<void> {
  console.log(`Building langgraph in ${cwd}...`);

  try {
    // 1. 加载配置
    const config = loadConfig(cwd);

    // 2. 准备输出目录
    const absoluteDistDir = prepareOutputDirectory(config, cwd);

    // 3. 准备主要入口点
    const mainEntries = prepareEntries(config, cwd);

    // 4. 创建构建配置
    const buildConfig = createBuildConfig(config);

    // 5. 准备辅助入口文件
    const { tempDir, entries: helperEntries } = prepareHelperEntries(
      buildConfig,
      cwd,
    );

    try {
      // 6. 构建主要图表和认证入口
      await build({
        configFile: false,
        plugins: [
          nodeExternals({
            deps: false,
            include: ['cloudflare:sockets', 'typescript'],
          }),
        ],
        define: {
          global: 'globalThis',
        },
        build: {
          target: 'esnext',
          lib: {
            entry: mainEntries,
            formats: ['es'],
          },
          outDir: absoluteDistDir,
          emptyOutDir: false,
          minify: true,
          commonjsOptions: {
            strictRequires: false,
          },
          rollupOptions: {
            output: {
              preserveModules: false,
              exports: 'named',
            },
          },
        },
      });

      // 7. 构建辅助入口文件
      await build({
        configFile: false,
        mode: 'production',
        plugins: [
          nodeExternals({
            deps: false,
            include: ['cloudflare:sockets', 'typescript'],
          }),
          condition({
            env: 'node',
          }),
        ],
        define: {
          global: 'globalThis',
        },
        build: {
          target: 'esnext',
          lib: {
            entry: helperEntries,
            formats: ['es'],
            fileName: (_, entryName) => `${entryName}.js`,
          },
          outDir: absoluteDistDir,
          emptyOutDir: false,
          minify: true,
        },
      });

      console.log(`构建完成。输出目录: ${absoluteDistDir}`);
    } finally {
      // 清理临时目录
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  } catch (error) {
    console.error('构建失败:', error);
    throw error;
  }
}
