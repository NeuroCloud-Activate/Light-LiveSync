#!/usr/bin/env node

import { spawn } from "node:child_process";

const node = process.execPath;
const loaderArgs = ["--loader", "./tests/ts-extension-loader.mjs"];
const tsHarnesses = [
  "connection-verifier-harness.mjs",
  "couchdb-transport-harness.mjs",
  "direct-setup-harness.mjs",
  "document-reconstructor-harness.mjs",
  "local-document-store-harness.mjs",
  "live-vault-applier-harness.mjs",
  "obsidian-config-refresh-harness.mjs",
  "recovery-backups-harness.mjs",
  "runtime-capabilities-harness.mjs",
  "runtime-evidence-report-harness.mjs",
  "runtime-smoke-check-harness.mjs",
  "scheduler-harness.mjs",
  "session-credential-cache-harness.mjs",
  "settings-tab-harness.mjs",
  "setup-helper-script-harness.mjs",
  "setup-qr-harness.mjs",
  "setup-uri-export-harness.mjs",
  "status-presenter-harness.mjs",
  "sync-engine-harness.mjs",
  "sync-engine-stress-harness.mjs",
  "sync-worker-client-harness.mjs",
  "text-merge-harness.mjs",
  "vault-scan-harness.mjs",
  "version-history-harness.mjs"
];
const plainHarnesses = ["mobile-safety-harness.mjs", "sync-worker-bundle-harness.mjs"];

async function runHarness(script, args) {
  const commandArgs = [...args, `./tests/${script}`];
  const child = spawn(node, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve) => {
    child.on("close", resolve);
  });
  if (code !== 0) {
    process.stderr.write(`\n${script} failed with exit code ${code}.\n`);
    process.stderr.write(stderr);
    process.stderr.write(stdout);
    process.exit(code ?? 1);
  }
  const trimmed = stdout.trim();
  if (trimmed) {
    process.stdout.write(`${script}: ${trimmed}\n`);
  } else {
    process.stdout.write(`${script}: ok\n`);
  }
}

for (const script of tsHarnesses) {
  await runHarness(script, loaderArgs);
}
for (const script of plainHarnesses) {
  await runHarness(script, []);
}

console.log(JSON.stringify({
  ok: true,
  harnesses: tsHarnesses.length + plainHarnesses.length
}, null, 2));
