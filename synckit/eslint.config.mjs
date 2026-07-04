import base from "@synckit/config/eslint";

export default [
  ...base,
  {
    // k6 scripts run inside the k6 runtime, which injects these globals.
    files: ["load/k6-*.js"],
    languageOptions: {
      globals: {
        __ENV: "readonly",
        __VU: "readonly",
        __ITER: "readonly",
      },
    },
  },
  {
    // The Node harnesses use runtime globals beyond the shared JS baseline.
    files: ["load/harness-*.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        WebSocket: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        performance: "readonly",
        crypto: "readonly",
      },
    },
  },
];
