#!/usr/bin/env node

import { buildLanggraph } from './build.js';
import path from 'path';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';

// 解析命令行参数
const args = process.argv.slice(2);
const options = {
  cwd: process.cwd(),
  help: false,
  version: false,
};

// 获取当前文件的目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取package.json获取版本号
const packagePath = path.resolve(__dirname, '../../package.json');
const packageJson = JSON.parse(await readFile(packagePath, 'utf-8'));
const { version } = packageJson;

// 解析命令行参数
for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === '--help' || arg === '-h') {
    options.help = true;
  } else if (arg === '--version' || arg === '-v') {
    options.version = true;
  } else if (arg === '--cwd' && i + 1 < args.length) {
    options.cwd = path.resolve(process.cwd(), args[++i]);
  }
}

// 显示帮助信息
if (options.help) {
  console.log(`
@langgraph-js/bundler v${version}

A build tool for LangGraph.js applications that packages graph configurations into deployable modules.

USAGE:
  npx @langgraph-js/bundler [OPTIONS]

OPTIONS:
  --help, -h     显示帮助信息
  --version, -v  显示版本信息
  --cwd <path>   指定工作目录 (默认: 当前目录)

EXAMPLES:
  npx @langgraph-js/bundler
  npx @langgraph-js/bundler --cwd ./my-project
  `);
  process.exit(0);
}

// 显示版本信息
if (options.version) {
  console.log(`@langgraph-js/bundler v${version}`);
  process.exit(0);
}

// 执行构建
buildLanggraph(options.cwd).catch((err) => {
  console.error('构建失败:', err);
  process.exit(1);
});
