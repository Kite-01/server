import {
  createHmac,
  createPrivateKey,
  createPublicKey,
  pbkdf2Sync,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import { NearActor } from "../NearActor";
import { testMnemonic } from "../../test/mocks";

// SLIP-10 ed25519, written out here so the test doesn't trust the library it checks
const deriveEd25519 = (mnemonic: string, path: number[]) => {
  const seed = pbkdf2Sync(
    mnemonic.normalize("NFKD"),
    "mnemonic",
    2048,
    64,
    "sha512",
  );
  let node = createHmac("sha512", "ed25519 seed").update(seed).digest();

  for (const index of path) {
    const data = Buffer.alloc(37);
    node.subarray(0, 32).copy(data, 1);
    data.writeUInt32BE((index | 0x80000000) >>> 0, 33);
    node = createHmac("sha512", node.subarray(32)).update(data).digest();
  }

  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      node.subarray(0, 32),
    ]),
    format: "der",
    type: "pkcs8",
  });

  return createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .subarray(-32);
};

describe("NearActor", () => {
  it("is the implicit account of the mnemonic's key on m/44'/397'/0'", () => {
    const publicKey = deriveEd25519(testMnemonic, [44, 397, 0]);

    expect(new NearActor().getAddress()).toBe(publicKey.toString("hex"));
    expect(new NearActor().getAddress()).toMatch(/^[0-9a-f]{64}$/);
  });
});
