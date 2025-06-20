import { defineConfig } from 'vite';
import { nodeExternals } from 'rollup-plugin-node-externals';

export default defineConfig({
  plugins: [nodeExternals()],
  build: {
    target: 'esnext',
    lib: {
      entry: {
        index: 'src/index.mts',
        sqlite: 'src/sqlite.mts',
      },
      formats: ['es'],
    },
  },
});
