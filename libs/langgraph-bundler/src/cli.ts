#!/usr/bin/env node

/**
 * LangGraph.js CLI工具
 *
 * 支持两个主要功能：
 * - dev: 启动开发服务器
 * - build: 构建应用
 */

import { buildLanggraph } from './build.js';
import { spawn } from 'node:child_process';
import path from 'path';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';

// 获取当前文件的目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取package.json获取版本号
const packagePath = path.resolve(__dirname, '../package.json');
const packageJson = JSON.parse(await readFile(packagePath, 'utf-8'));
const { version } = packageJson;

/**
 * 检测当前运行环境
 * @returns {"bun" | "deno" | "node"}
 */
function detectRuntime(): 'bun' | 'deno' | 'node' {
  // 检测是否为 Bun 环境
  if (
    typeof process !== 'undefined' &&
    'isBun' in process &&
    process.isBun === true
  ) {
    return 'bun';
  }

  // 检测是否为 Deno 环境
  // @ts-ignore - Deno 变量在 Deno 环境中存在
  if (typeof Deno !== 'undefined') {
    return 'deno';
  }

  // 默认为 Node 环境
  return 'node';
}

/**
 * 执行命令
 * @param {string} command 命令
 * @param {string[]} args 参数
 */
function executeCommand(command: string, args: string[]): void {
  console.log(`执行命令: ${command} ${args.join(' ')}`);

  const childProcess = spawn(command, args, {
    stdio: 'inherit',
    shell: true,
  });

  childProcess.on('error', (error) => {
    console.error(`命令执行失败: ${error.message}`);
    process.exit(1);
  });

  childProcess.on('exit', (code) => {
    if (code !== 0) {
      console.error(`命令执行失败，退出码: ${code}`);
      process.exit(code || 1);
    }
  });
}

/**
 * 启动开发服务器
 */
async function runDev(args: string[]): Promise<void> {
  const runtime = detectRuntime();
  console.log(`检测到运行环境: ${runtime}`);

  switch (runtime) {
    case 'bun':
      executeCommand('bun', [
        'run',
        '--watch',
        path.join(__dirname, 'dev-node.js'),
        ...args,
      ]);
      break;
    case 'deno':
      executeCommand('deno', [
        'serve',
        '-A',
        '--unstable-sloppy-imports',
        '--env-file',
        '--port',
        '8123',
        '--watch',
        path.join(__dirname, 'dev-edge.js'),
        ...args,
      ]);
      break;
    case 'node':
      executeCommand('tsx', [
        'watch',
        '--env-file=.env',
        path.join(__dirname, 'dev-node.js'),
        ...args,
      ]);
      break;
    default:
      console.error('未知的运行环境');
      process.exit(1);
  }
}

/**
 * 执行构建
 */
async function runBuild(options: {
  cwd: string;
  db: 'sqlite' | 'postgres';
}): Promise<void> {
  await buildLanggraph(options.cwd, options.db);
}

/**
 * 显示帮助信息
 */
function showHelp(): void {
  console.log(`
@langgraph-js/bundler v${version}

A build tool for LangGraph.js applications that packages graph configurations into deployable modules.

USAGE:
  npx langgraph-js <command> [OPTIONS]

COMMANDS:
  build          构建LangGraph应用 (默认命令)
  dev            启动开发服务器

OPTIONS:
  --help, -h     显示帮助信息
  --version, -v  显示版本信息
  --cwd <path>   指定工作目录 (默认: 当前目录)
  --db=<type>    指定数据库类型，可选值: sqlite, postgres (默认: postgres) [仅build命令]

EXAMPLES:
  npx langgraph-js build
  npx langgraph-js build --cwd ./my-project --db=postgres
  npx langgraph-js dev
  npx langgraph-js dev --port 3000
  `);
}

// 解析命令行参数
const args = process.argv.slice(2);
let command = 'build'; // 默认命令
const options = {
  cwd: process.cwd(),
  help: false,
  version: false,
  db: 'postgres' as 'sqlite' | 'postgres',
};

// 提取子命令
if (args.length > 0 && !args[0].startsWith('-')) {
  const firstArg = args[0];
  if (firstArg === 'dev' || firstArg === 'build') {
    command = firstArg;
    args.shift(); // 移除子命令
  }
}

// 解析参数
const remainingArgs: string[] = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === '--help' || arg === '-h') {
    options.help = true;
  } else if (arg === '--version' || arg === '-v') {
    options.version = true;
  } else if (arg === '--cwd' && i + 1 < args.length) {
    options.cwd = path.resolve(process.cwd(), args[++i]);
  } else if (arg.startsWith('--db=')) {
    const dbType = arg.split('=')[1];
    if (dbType === 'sqlite' || dbType === 'postgres') {
      options.db = dbType;
    } else {
      console.warn(`不支持的数据库类型: ${dbType}，使用默认值 postgres`);
    }
  } else {
    // 其他参数传递给相应的命令
    remainingArgs.push(arg);
  }
}

// 显示帮助信息
if (options.help) {
  showHelp();
  process.exit(0);
}

// 显示版本信息
if (options.version) {
  console.log(`@langgraph-js/bundler v${version}`);
  process.exit(0);
}

// 执行相应的命令
try {
  if (command === 'dev') {
    await runDev(remainingArgs);
  } else if (command === 'build') {
    await runBuild({ cwd: options.cwd, db: options.db });
  } else {
    console.error(`未知的命令: ${command}`);
    showHelp();
    process.exit(1);
  }
} catch (error) {
  console.error(`执行${command}命令失败:`, error);
  process.exit(1);
}
