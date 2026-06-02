export const ENCRYPT_V1_PREFIX_PROBABLY = "%";
export const ENCRYPT_V2_PREFIX = "%";
export const ENCRYPT_V3_PREFIX = "%";

const STUB_PREFIX = "%stub:";

export async function decrypt(input, passphrase = "") {
  if (typeof input === "string" && input.startsWith(STUB_PREFIX)) {
    const decoded = JSON.parse(Buffer.from(input.slice(STUB_PREFIX.length), "base64url").toString("utf8"));
    if (decoded.passphrase !== passphrase) {
      throw new Error("Wrong setup URI passphrase.");
    }
    return decoded.value;
  }
  return input;
}

export async function encrypt(input, passphrase = "") {
  return `${STUB_PREFIX}${Buffer.from(JSON.stringify({ passphrase, value: input }), "utf8").toString("base64url")}`;
}
