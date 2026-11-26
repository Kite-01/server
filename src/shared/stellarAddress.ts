import { createHmac, pbkdf2Sync } from "node:crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";

export const isStellarAccount = (value: string) => {
  return StrKey.isValidEd25519PublicKey(value);
};

export const isStellarContract = (value: string) => {
  return StrKey.isValidContract(value);
};

export const isStellarMuxed = (value: string) => {
  return StrKey.isValidMed25519PublicKey(value);
};

export const isStellarAddress = (value: string) => {
  return (
    isStellarAccount(value) || isStellarContract(value) || isStellarMuxed(value)
  );
};

export const stellarKeypair = (mnemonic: string, index: number) => {
  const seed = pbkdf2Sync(
    mnemonic.normalize("NFKD"),
    "mnemonic",
    2048,
    64,
    "sha512",
  );

  let node = createHmac("sha512", "ed25519 seed").update(seed).digest();
  for (const segment of [44, 148, index]) {
    const hardened = Buffer.alloc(4);
    hardened.writeUInt32BE(segment + 0x80000000);
    node = createHmac("sha512", node.subarray(32))
      .update(Buffer.concat([Buffer.alloc(1), node.subarray(0, 32), hardened]))
      .digest();
  }

  return Keypair.fromRawEd25519Seed(node.subarray(0, 32));
};
