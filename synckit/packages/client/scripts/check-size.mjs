// Guards the SDK size budget: the bundle a customer ships (client + inlined
// core, zod external, minified) must stay under 15 kB gzip.
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { build } from "esbuild";

const LIMIT_BYTES = 15 * 1024;

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const result = await build({
  entryPoints: [entry],
  bundle: true,
  minify: true,
  format: "esm",
  external: ["zod"],
  write: false,
});

const output = result.outputFiles[0];
const gzipped = gzipSync(output.contents).length;
const kb = (gzipped / 1024).toFixed(2);

if (gzipped > LIMIT_BYTES) {
  console.error(`@synckit/client bundle is ${kb} kB gzip — over the 15 kB budget`);
  process.exit(1);
}
console.log(`@synckit/client bundle size: ${kb} kB gzip (budget 15 kB) ✓`);
