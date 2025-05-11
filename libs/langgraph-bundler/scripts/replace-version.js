#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function replaceVersion() {
  try {
    // 读取package.json获取版本号
    const packageJsonPath = path.join(rootDir, 'package.json');
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    const { version } = JSON.parse(packageJsonContent);

    // 替换dist/index.js中的版本占位符
    const indexPath = path.join(rootDir, 'dist', 'index.js');
    let indexContent = await fs.readFile(indexPath, 'utf-8');
    indexContent = indexContent.replace('__VERSION__', version);
    await fs.writeFile(indexPath, indexContent, 'utf-8');

    console.log(`✅ 成功将版本号替换为 ${version}`);
  } catch (error) {
    console.error('替换版本号时出错:', error);
    process.exit(1);
  }
}

replaceVersion();
