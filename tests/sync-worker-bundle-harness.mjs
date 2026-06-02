import { readFileSync } from "node:fs";
import vm from "node:vm";

const workerSource = readFileSync(new URL("../sync-worker.js", import.meta.url), "utf8");
const messages = [];
const sandbox = {
  atob: globalThis.atob,
  btoa: globalThis.btoa,
  console,
  crypto: globalThis.crypto,
  TextDecoder,
  TextEncoder,
  Uint8Array,
  WebAssembly,
  self: {
    postMessage(message) {
      messages.push(message);
    }
  }
};
sandbox.globalThis = sandbox;

vm.runInNewContext(workerSource, sandbox, {
  filename: "sync-worker.js"
});

if (typeof sandbox.self.onmessage !== "function") {
  throw new Error("Bundled worker did not register self.onmessage.");
}

sandbox.self.onmessage({
  data: {
    id: 1,
    type: "build-push-bundle",
    snapshot: {
      path: "worker-check.md",
      content: "Worker bundle compatibility check.\n",
      ctime: 1,
      mtime: 2,
      size: 35
    },
    options: {
      encrypt: false,
      passphrase: "",
      syncParameterSalt: "",
      usePathObfuscation: false,
      hashAlgorithm: "xxhash64"
    }
  }
});

for (let attempts = 0; messages.length === 0 && attempts < 50; attempts += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

const response = messages[0];
if (!response?.ok) {
  throw new Error(response?.error || "Worker bundle did not return a successful response.");
}

const fileDocument = response.result.fileDocument;
const chunkDocuments = response.result.chunkDocuments;
const reconstructed = chunkDocuments.map((chunk) => chunk.data).join("");

console.log(JSON.stringify({
  ok: true,
  fileId: fileDocument._id,
  type: fileDocument.type,
  chunks: chunkDocuments.length,
  reconstructedMatches: reconstructed === "Worker bundle compatibility check.\n",
  noCommonJsRequire: !/require\(/.test(workerSource),
  noCommonJsExports: !/module\.exports|exports\./.test(workerSource)
}, null, 2));
