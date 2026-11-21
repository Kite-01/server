import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { createHmac, pbkdf2Sync } from "node:crypto";

export const isStellarAccount = (value: string) =>
  StrKey.isValidEd25519PublicKey(value);

export const isStellarContract = (value: string) =>
  StrKey.isValidContract(value);

export const isStellarMuxed = (value: string) =>
  StrKey.isValidMed25519PublicKey(value);

export const isStellarAddress = (value: string) =>
  isStellarAccount(value) || isStellarContract(value) || isStellarMuxed(value);

// SEP-5: SLIP-10 ed25519 on m/44'/148'/<index>'
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
