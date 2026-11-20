import {
  createEd25519Signer,
  type FacilitatorStellarSigner,
} from "@x402/stellar";
import { TransactionBuilder } from "@stellar/stellar-sdk";
import { getX402Observer } from "../shared/context/x402";
import { type StellarActor } from "./StellarActor";

/** Soroban authorizations expire at a ledger, not a time; this is when it should pass. */
export const stellarAuthorizationValidBefore = (input: {
  expirationLedger: number;
  latestLedger: number;
  ledgerSeconds: number;
  now?: number;
}) => {
  const ledgersLeft = Math.max(input.expirationLedger - input.latestLedger, 0);
  const now = input.now ?? Date.now() / 1000;
  return String(Math.ceil(now + ledgersLeft * input.ledgerSeconds));
};

// Settlements are signed by their own account, m/44'/148'/1', so they never compete with the
// operator's sequence number; the operator only fee-bumps them, and pays.
export const x402StellarFacilitatorSigner = (
  caip2Id: Caip2Id,
  actor: StellarActor,
): {
  signer: FacilitatorStellarSigner;
  feeBumpSigner: FacilitatorStellarSigner;
} => {
  const network = caip2Id as `${string}:${string}`;
  const signer = createEd25519Signer(actor.keypair(1).secret(), network);
  const operator = createEd25519Signer(actor.keypair().secret(), network);

  return {
    signer,
    feeBumpSigner: {
      ...operator,
      // the fee bump is the transaction sent: its hash is recorded before `sendTransaction`
      signTransaction: async (xdr, options) => {
        const signed = await operator.signTransaction(xdr, options);
        if (!signed.error) {
          const transaction = TransactionBuilder.fromXDR(
            signed.signedTxXdr,
            actor.passphrase(caip2Id),
          );
          await getX402Observer()?.onBroadcast(
            transaction.hash().toString("hex"),
          );
        }
        return signed;
      },
    },
  };
};
