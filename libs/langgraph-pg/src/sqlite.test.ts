import { SqliteLangGraphBase } from './sqlite.mjs';

async function main() {
  const uri = './langgraph.db';

  await SqliteLangGraphBase.setupDatabase(uri, 'langgraph');
  SqliteLangGraphBase.fromConnString(uri);
}

main();
