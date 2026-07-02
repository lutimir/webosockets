import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: { resolve: true },
  sourcemap: true,
  clean: true,
  treeshake: true,
  // @synckit/core is a private workspace package — inline it into the bundle.
  noExternal: ["@synckit/core"],
  external: ["zod"],
});
