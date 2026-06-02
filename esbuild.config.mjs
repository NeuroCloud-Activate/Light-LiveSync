import esbuild from "esbuild";
import { builtinModules } from "node:module";
import process from "node:process";

const production = process.argv[2] === "production";
const builtins = [
  ...new Set([
    ...builtinModules,
    ...builtinModules.map((moduleName) => moduleName.replace(/^node:/, "")),
    ...builtinModules.map((moduleName) => `node:${moduleName.replace(/^node:/, "")}`)
  ])
];
const commonOptions = {
  banner: {
    js: "/* Light-LiveSync */"
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
