#!/usr/bin/env bun
import { $ } from "./utils.mjs";

await $`rm -rf dist`;
await $`yarn tsc --outDir dist`;

await $`cp src/graph/parser/schema/types.template.mts dist/src/graph/parser/schema`;
await $`rm -rf dist/src/graph/parser/schema/types.template.mjs`;

await $`mv dist/src/* dist`;
await $`rm -rf dist/src dist/tests`;
