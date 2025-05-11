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
    console.log(`Looking for package.json at: ${packageJsonPath}`);

    // 检查文件是否存在
    try {
      await fs.access(packageJsonPath);
    } catch (err) {
      console.error(`无法访问 ${packageJsonPath}: ${err.message}`);
      // 尝试向上一级目录寻找
      console.log('尝试在父目录中查找 package.json...');
      const parentDir = path.resolve(rootDir, '..');
      const parentPackageJsonPath = path.join(parentDir, 'package.json');

      try {
        await fs.access(parentPackageJsonPath);
        console.log(`找到父目录的 package.json: ${parentPackageJsonPath}`);
        // 使用父目录的package.json
        const parentPackageJsonContent = await fs.readFile(
          parentPackageJsonPath,
          'utf-8',
        );
        const parentPackageJson = JSON.parse(parentPackageJsonContent);

        // 在父目录的package.json中查找当前包的版本
        if (
          parentPackageJson.dependencies &&
          parentPackageJson.dependencies['@langgraph-js/bundler']
        ) {
          const version = parentPackageJson.dependencies[
            '@langgraph-js/bundler'
          ].replace(/^\^|~/, '');
          updateVersion(version);
          return;
        }
      } catch (parentErr) {
        console.error(`无法访问父目录的 package.json: ${parentErr.message}`);
      }

      // 如果仍然失败，使用硬编码的版本
      console.log('使用默认版本');
      updateVersion('1.0.0');
      return;
    }

    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    const { version } = JSON.parse(packageJsonContent);

    await updateVersion(version);
  } catch (error) {
    console.error('替换版本号时出错:', error);
    process.exit(1);
  }
}

async function updateVersion(version) {
  try {
    // 替换dist/index.js中的版本占位符
    const indexPath = path.join(rootDir, 'dist', 'index.js');
    console.log(`更新文件: ${indexPath} 的版本到 ${version}`);

    let indexContent = await fs.readFile(indexPath, 'utf-8');
    indexContent = indexContent.replace('__VERSION__', version);
    await fs.writeFile(indexPath, indexContent, 'utf-8');

    console.log(`✅ 成功将版本号替换为 ${version}`);
  } catch (error) {
    console.error(`更新版本号失败: ${error.message}`);
    process.exit(1);
  }
}

replaceVersion();
