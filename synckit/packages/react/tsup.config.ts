import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: { resolve: true },
  sourcemap: true,
  clean: true,
  // Rollup treeshake strips module-level directives — esbuild treeshaking
  // still applies, and the "use client" banner must survive for RSC safety.
  treeshake: false,
  external: ["react", "react-dom", "react/jsx-runtime", "@synckit/client"],
  banner: { js: '"use client";' },
});
