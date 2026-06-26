import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['cjs'],
  target: 'node18',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // 单文件打包,用户无需 node_modules 即可运行 dist/cli.js
  // (bin 指向 dist/cli.js;commander/picocolors 会被打进去)
  banner: {
    js: '#!/usr/bin/env node',
  },
});
