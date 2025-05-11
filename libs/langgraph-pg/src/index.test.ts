import { PGLangGraphBase } from './index.mjs';

async function main() {
  const base = new PGLangGraphBase(
    'postgres://postgres:postgres@localhost:5434/langgraph_test?sslmode=disable',
  );

  await base.setup();
}

main();
