import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  bundle: true,
  minify: false,
  clean: true,
  sourcemap: false,
  dts: false,
  // Bundle runtime deps into the single output file for fast `npx` cold start.
  noExternal: [/.*/],
  // Some deps (commander) are CJS and `require()` node built-ins; provide a real
  // `require` in the ESM output so esbuild's shim uses it instead of throwing.
  banner: {
    js: "import { createRequire as __cjsCreateRequire } from 'node:module'; const require = __cjsCreateRequire(import.meta.url);",
  },
});
