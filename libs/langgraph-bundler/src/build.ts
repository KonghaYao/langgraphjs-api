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
}

interface BuildEntries {
  [key: string]: string;
}

// 常量定义
const INVALID_AGENT_NAMES = ['auth', 'dev'];
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
 * 构建主要入口文件
 */
async function buildMainEntries(
  entries: BuildEntries,
  outDir: string,
): Promise<void> {
  await build({
    configFile: false,
    plugins: [
      nodeExternals({
        deps: false,
      }),
    ],
    build: {
      lib: {
        entry: entries,
        formats: ['es'],
      },
      outDir,
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
}

/**
 * 构建开发服务器文件
 */
async function buildDevFile(
  devCode: string,
  outDir: string,
  cwd: string,
): Promise<void> {
  const tempDevFilePath = path.join(cwd, 'temp-dev.js');
  fs.writeFileSync(tempDevFilePath, devCode);

  try {
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
        // visualizer(),
      ],
      build: {
        target: 'esnext',
        lib: {
          entry: tempDevFilePath,
          formats: ['es'],
          fileName: () => 'dev.js',
        },
        outDir,
        emptyOutDir: false,
        minify: true,
      },
    });
  } finally {
    // 清理临时文件
    fs.unlinkSync(tempDevFilePath);
  }
}

/**
 * 构建 Langgraph 项目
 */
export async function buildLanggraph(
  cwd: string = process.cwd(),
): Promise<void> {
  console.log(`Building langgraph in ${cwd}...`);

  // 1. 加载配置
  const config = loadConfig(cwd);

  // 2. 准备输出目录
  const absoluteDistDir = prepareOutputDirectory(config, cwd);

  // 3. 准备入口点
  const entries = prepareEntries(config, cwd);

  // 4. 创建构建配置
  const buildConfig = createBuildConfig(config);

  // 5. 生成开发服务器代码
  const devCode = generateDevCode(buildConfig);

  // 6. 构建主要入口文件
  await buildMainEntries(entries, absoluteDistDir);

  // 7. 构建开发服务器文件
  await buildDevFile(devCode, absoluteDistDir, cwd);

  console.log(`构建完成。输出目录: ${absoluteDistDir}`);
}
