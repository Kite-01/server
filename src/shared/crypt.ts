import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "./errors";
import { env } from "./env";

class Crypt {
  readonly prefix = "cipher";
  readonly algo = "aes-256-gcm";

  private encryptionKeyBytes = (): Buffer => {
    const key = Buffer.from(env.KITE_ENCRYPTION_KEY, "base64");
    if (key.length !== 32) {
      throw new Error("KITE_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    }

    return key;
  };

  encrypt = (plaintext: string, aad?: string) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv(this.algo, this.encryptionKeyBytes(), iv);

    if (aad) {
      cipher.setAAD(Buffer.from(aad));
    }

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();
    return [this.prefix, iv, authTag, ciphertext]
      .map((p) => p.toString("base64"))
      .join(".");
  };

  decrypt = (ciphertext: string, aad?: string) => {
    const [prefix, iv, tag, ct] = ciphertext.split(":");
    if (prefix !== this.prefix || !iv || !tag || !ct) {
      throw new AppError("Invalid or unsupported encrypted payload");
    }
    const decipher = createDecipheriv(
      this.algo,
      this.encryptionKeyBytes(),
      Buffer.from(iv, "base64"),
    );

    if (aad) decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tag, "base64"));

    const buffer = Buffer.concat([
      decipher.update(Buffer.from(ct, "base64")),
      decipher.final(),
    ]);

    return buffer.toString("utf8");
  };
}

export const crypt = new Crypt();
