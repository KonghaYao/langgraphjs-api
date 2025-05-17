#!/usr/bin/env node

/**
 * LangGraph 开发服务器启动工具
 *
 * 此工具会自动检测当前运行环境（Bun、Deno或Node.js），
 * 并启动相应的开发服务器配置。
 *
 * - Bun: 使用 bun run --watch dev-node.js
 * - Deno: 使用 deno serve -A --unstable-sloppy-imports --env-file --port 8123 --watch dev-edge.js
 * - Node.js: 使用 node --watch dev-node.js
 *
 * 使用方法: npx langgraph-dev
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 获取当前文件的目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// 主函数
async function main(): Promise<void> {
  const runtime = detectRuntime();
  console.log(`检测到运行环境: ${runtime}`);

  switch (runtime) {
    case 'bun':
      executeCommand('bun', [
        'run',
        '--watch',
        path.join(__dirname, 'dev-node.js'),
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
      ]);
      break;
    case 'node':
      // 对于 Node 环境，这里可以添加默认行为
      // 例如使用 node 的 --watch 参数（Node.js v18.11.0+ 支持）
      executeCommand('tsx', [
        'watch',
        '--env-file=.env',
        path.join(__dirname, 'dev-node.js'),
      ]);
      break;
    default:
      console.error('未知的运行环境');
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('运行失败:', error);
  process.exit(1);
});
