import esbuild from "esbuild";
import process from "node:process";
import builtins from "builtin-modules";

const production = process.argv[2] === "production";
const commonOptions = {
  banner: {
    js: "/* Lightweight LiveSync */"
  },
  bundle: true,
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  minify: production
};

const mainOptions = {
  ...commonOptions,
  entryPoints: {
    main: "src/main.ts"
  },
  external: ["obsidian", "electron", "@codemirror/*", ...builtins],
  format: "cjs",
  outdir: ".",
  entryNames: "[name]"
};

const workerOptions = {
  ...commonOptions,
  entryPoints: {
    "sync-worker": "src/sync-worker.ts"
  },
  format: "iife",
  platform: "browser",
  outdir: ".",
  entryNames: "[name]"
};

if (production) {
  await Promise.all([
    esbuild.build(mainOptions),
    esbuild.build(workerOptions)
  ]);
} else {
  const contexts = await Promise.all([
    esbuild.context(mainOptions),
    esbuild.context(workerOptions)
  ]);
  await Promise.all(contexts.map((context) => context.watch()));
}
