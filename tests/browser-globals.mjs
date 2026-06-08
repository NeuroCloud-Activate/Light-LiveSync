if (typeof globalThis.window === "undefined") {
  globalThis.window = globalThis;
}

if (typeof globalThis.self === "undefined") {
  globalThis.self = globalThis;
}

if (typeof globalThis.activeWindow === "undefined") {
  globalThis.activeWindow = globalThis.window;
}

if (typeof globalThis.activeDocument === "undefined") {
  globalThis.activeDocument = globalThis.document ?? {
    hidden: false,
    addEventListener() {},
    removeEventListener() {}
  };
}
