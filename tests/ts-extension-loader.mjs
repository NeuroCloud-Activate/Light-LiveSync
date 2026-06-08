import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

if (typeof globalThis.window === "undefined") {
  globalThis.window = globalThis;
}
if (typeof globalThis.self === "undefined") {
  globalThis.self = globalThis;
}

const STUBS = {
  "octagonal-wheels/encryption/encryption": "./tests/stubs/octagonal-encryption.mjs",
  "octagonal-wheels/encryption/hkdf": "./tests/stubs/octagonal-hkdf.mjs",
  "octagonal-wheels/object": "./tests/stubs/octagonal-object.mjs",
  "obsidian": "./tests/stubs/obsidian.mjs"
};

export async function resolve(specifier, context, nextResolve) {
  if (specifier in STUBS) {
    return nextResolve(new URL(STUBS[specifier], pathToFileURL(`${process.cwd()}/`)).href, context);
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]s$/.test(specifier)) {
    const parentPath = fileURLToPath(context.parentURL);
    const candidate = new URL(`${specifier}.ts`, pathToFileURL(parentPath));
    if (existsSync(fileURLToPath(candidate))) {
      return nextResolve(candidate.href, context);
    }
  }
  return nextResolve(specifier, context);
}
