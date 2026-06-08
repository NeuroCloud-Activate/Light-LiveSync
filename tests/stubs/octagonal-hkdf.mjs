export const HKDF_SALTED_ENCRYPTED_PREFIX = "%$";

const STUB_PREFIX = "%$stub:";

function encodePayload(value, passphrase = "") {
  return `${STUB_PREFIX}${Buffer.from(JSON.stringify({ passphrase, value }), "utf8").toString("base64url")}`;
}

function decodePayload(input, passphrase = "") {
  if (typeof input === "string" && input.startsWith(STUB_PREFIX)) {
    const decoded = JSON.parse(Buffer.from(input.slice(STUB_PREFIX.length), "base64url").toString("utf8"));
    if (decoded.passphrase !== passphrase) {
      throw new Error("Wrong setup URI passphrase.");
    }
    return decoded.value;
  }
  return input;
}

export async function decryptWithEphemeralSalt(input, passphrase = "") {
  return decodePayload(input, passphrase);
}

export async function encryptWithEphemeralSalt(input, passphrase = "") {
  return encodePayload(input, passphrase);
}

export async function decrypt(input) {
  return input;
}

export async function encrypt(input) {
  return input;
}
