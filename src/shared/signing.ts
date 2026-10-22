import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  verify,
  type KeyObject,
} from "node:crypto";

export type SignedRequest = {
  timestamp: string;
  nonce: string;
  method: string;
  target: string;
  body: string | Uint8Array;
};

class Signing {
  toPublicKey = (value: string) => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
      return null;
    }

    try {
      return createPublicKey({
        format: "jwk",
        key: {
          kty: "OKP",
          crv: "Ed25519",
          x: value,
        },
      });
    } catch {
      return null;
    }
  };

  isPublicKey = (value: string) => this.toPublicKey(value) !== null;

  signingString = (request: SignedRequest) => {
    const bodyHash = createHash("sha256").update(request.body).digest("hex");

    return [
      request.timestamp,
      request.nonce,
      request.method.toUpperCase(),
      request.target,
      bodyHash,
    ].join("\n");
  };

  verify = (
    publicKey: KeyObject,
    request: SignedRequest,
    signature: string,
  ) => {
    const bytes = Buffer.from(signature, "base64url");
    if (bytes.length !== 64) {
      return false;
    }

    return verify(
      null,
      Buffer.from(this.signingString(request)),
      publicKey,
      bytes,
    );
  };

  generateKeyPair = () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");

    return {
      publicKey: publicKey.export({ format: "jwk" }).x as string,
      privateKey: privateKey
        .export({ format: "der", type: "pkcs8" })
        .toString("base64url"),
    };
  };
}

export const signing = new Signing();
