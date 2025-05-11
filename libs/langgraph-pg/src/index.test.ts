import { PGLangGraphBase } from './index.mjs';

async function main() {
  const url = new URL(
    'postgres://postgres:postgres@localhost:5434/langgraph_test_2?sslmode=disable',
  );
  await PGLangGraphBase.setupDatabase(url.toString(), 'langgraph_test_2');
  const base = PGLangGraphBase.fromConnString(url.toString());

  await base.setup();
}

main();
