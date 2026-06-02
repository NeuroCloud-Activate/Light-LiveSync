export class Base64DecodeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "Base64DecodeError";
  }
}

function normaliseBase64(value: string): string {
  const trimmed = value.trim();
  const payload = trimmed.includes(",") && /^data:/i.test(trimmed)
    ? trimmed.slice(trimmed.indexOf(",") + 1)
    : trimmed;
  const normalised = payload
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalised.length % 4;
  if (padding === 1) {
    throw new Base64DecodeError("Remote content is not valid base64.");
  }
  return padding === 0 ? normalised : normalised.padEnd(normalised.length + 4 - padding, "=");
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const batchSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += batchSize) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + batchSize));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  try {
    const binary = atob(normaliseBase64(value));
    const bytes = new Uint8Array(binary.length) as Uint8Array<ArrayBuffer>;
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch (error) {
    if (error instanceof Base64DecodeError) {
      throw error;
    }
    throw new Base64DecodeError("Remote content is not valid base64.", { cause: error });
  }
}

export function base64ToArrayBuffer(value: string): ArrayBuffer {
  const bytes = base64ToBytes(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
