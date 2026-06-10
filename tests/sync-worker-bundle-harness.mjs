import { readFileSync } from "node:fs";
import vm from "node:vm";

const workerSource = readFileSync(new URL("../sync-worker.js", import.meta.url), "utf8");
const messages = [];
const saltBytes = new Uint8Array(32);
globalThis.crypto.getRandomValues(saltBytes);
const syncParameterSalt = globalThis.btoa(String.fromCharCode(...saltBytes));
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
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    crypto: globalThis.crypto,
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

sandbox.self.onmessage({
  data: {
    id: 2,
    type: "build-push-bundle",
    snapshot: {
      path: "worker-encrypted.md",
      content: "Encrypted worker bundle compatibility check.\n",
      ctime: 3,
      mtime: 4,
      size: 45
    },
    options: {
      encrypt: true,
      passphrase: "worker-test-passphrase",
      syncParameterSalt,
      usePathObfuscation: true,
      hashAlgorithm: "xxhash64"
    }
  }
});

for (let attempts = 0; messages.length < 2 && attempts < 50; attempts += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

const encryptedResponse = messages[1];
if (!encryptedResponse?.ok) {
  throw new Error(encryptedResponse?.error || "Worker bundle did not return a successful encrypted response.");
}

console.log(JSON.stringify({
  ok: true,
  fileId: fileDocument._id,
  type: fileDocument.type,
  chunks: chunkDocuments.length,
  reconstructedMatches: reconstructed === "Worker bundle compatibility check.\n",
  encryptedWorkerRequest: encryptedResponse.result.fileDocument._id.startsWith("f:"),
  noWindowBase64: !/window\.(?:atob|btoa)/.test(workerSource),
  noCommonJsRequire: !/require\(/.test(workerSource),
  noCommonJsExports: !/module\.exports|exports\./.test(workerSource)
}, null, 2));
