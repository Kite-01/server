import { describe, expect, it } from "vitest";
import { createPrivateKey } from "node:crypto";
import { signing } from "../signing";
import { sign } from "node:crypto";

const request = {
  timestamp: "1760000000",
  nonce: "nonce-1234",
  method: "post",
  target: "/api/quotes?page=1",
  body: JSON.stringify({ amount: "1" }),
};

const signWith = (privateKey: string, value: typeof request) => {
  const signer = createPrivateKey({
    key: Buffer.from(privateKey, "base64url"),
    format: "der",
    type: "pkcs8",
  });

  const signature = sign(
    null,
    Buffer.from(signing.signingString(value)),
    signer,
  );

  return signature.toString("base64url");
};

describe("signing", () => {
  const pair = signing.generateKeyPair();
  const publicKey = signing.toPublicKey(pair.publicKey)!;

  it("generates 43 char base64url public keys that parse back", () => {
    expect(pair.publicKey).toHaveLength(43);
    expect(signing.isPublicKey(pair.publicKey)).toBe(true);
  });

  it("rejects values that are not Ed25519 public keys", () => {
    expect(signing.isPublicKey("")).toBe(false);
    expect(signing.isPublicKey("short")).toBe(false);
    expect(signing.isPublicKey(`${pair.publicKey}A`)).toBe(false);
    expect(signing.isPublicKey("!".repeat(43))).toBe(false);
  });

  it("verifies a signature over the canonical string", () => {
    const signature = signWith(pair.privateKey, request);
    expect(signing.verify(publicKey, request, signature)).toBe(true);
  });

  it("binds the signature to every signed field", () => {
    const signature = signWith(pair.privateKey, request);

    for (const tampered of [
      { ...request, timestamp: "1760000001" },
      { ...request, nonce: "nonce-9999" },
      { ...request, method: "GET" },
      { ...request, target: "/api/quotes?page=2" },
      { ...request, body: JSON.stringify({ amount: "2" }) },
    ]) {
      expect(signing.verify(publicKey, tampered, signature)).toBe(false);
    }
  });

  it("normalises the method case", () => {
    const signature = signWith(pair.privateKey, request);
    const response = signing.verify(
      publicKey,
      { ...request, method: "POST" },
      signature,
    );

    expect(response).toBe(true);
  });

  it("rejects signatures from another key and malformed signatures", () => {
    expect(signing.verify(publicKey, request, "not-a-signature")).toBe(false);
    expect(signing.verify(publicKey, request, "")).toBe(false);

    const other = signing.generateKeyPair();

    expect(
      signing.verify(publicKey, request, signWith(other.privateKey, request)),
    ).toBe(false);
  });
});
