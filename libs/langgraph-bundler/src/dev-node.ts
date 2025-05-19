import { startServer } from '@langgraph-js/api/server';
import fs from 'node:fs';
import path from 'node:path';
import { filterGraphs } from './utils.js';
const config = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'langgraph.json'), 'utf8'),
);
const schema = {
  port: 8123,
  nWorkers: 1,
  host: '0.0.0.0',
  cwd: process.cwd(),
  ...config,
};
// 解析 --agent=
const agentString = process.argv
  .find((arg) => arg.startsWith('--agent='))
  ?.split('=')[1];
console.log(agentString);
const result = await startServer(filterGraphs(schema, agentString));
console.log('LangGraph is running on http://' + result.host);
console.log(process.cwd());
