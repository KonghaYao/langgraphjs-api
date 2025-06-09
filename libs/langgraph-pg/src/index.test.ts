import { PGLangGraphBase } from './index.mjs';

async function main() {
  const url = new URL(
    'postgres://postgres:postgres@localhost:5432/langgraph_test_2?sslmode=disable',
  );
  await PGLangGraphBase.setupDatabase(url.toString(), 'langgraph');
  PGLangGraphBase.fromConnString(url.toString());
}

main();
