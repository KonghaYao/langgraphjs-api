import { createHonoServer } from '@langgraph-js/api/server';
import fs from 'node:fs';
import path from 'node:path';
import { filterGraphs } from './utils.js';
const config = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'langgraph.json'), 'utf8'),
);

const schema = {
  cwd: process.cwd(),
  ...config,
};

// 解析 --agent=
const agentString = process.argv
  .find((arg) => arg.startsWith('--agent='))
  ?.split('=')[1];

const result = await createHonoServer(filterGraphs(schema, agentString));
export default {
  fetch: result.app.fetch as any,
};
