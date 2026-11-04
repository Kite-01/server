import {
  createFacilitatorNearSigner,
  type FacilitatorNearSigner,
} from "@x402/near";
import { getNearChain } from "../shared/chains";
import { type NearActor } from "./NearActor";

// Submissions go through the operator's per-chain queue: its other transactions use the same
// access key.
export const x402NearFacilitatorSigner = (
  caip2Id: Caip2Id,
  actor: NearActor,
  rpcUrls: string[] = [],
): FacilitatorNearSigner => {
  const rpcUrl = rpcUrls[0] ?? getNearChain(caip2Id).publicRpcUrls[0];
  const reference = createFacilitatorNearSigner({
    relayers: [
      {
        accountId: actor.getAddress(),
        secretKey: actor.getSecretKey() as `ed25519:${string}`,
      },
    ],
    rpcUrls: { [caip2Id]: rpcUrl },
  });

  return {
    getRelayerIds: () => reference.getRelayerIds(),
    getCurrentBlockHeight: (network) =>
      reference.getCurrentBlockHeight(network),
    viewAccount: (input) => reference.viewAccount(input),
    viewAccessKey: (input) => reference.viewAccessKey(input),
    ftBalanceOf: (input) => reference.ftBalanceOf(input),
    storageBalanceOf: (input) => reference.storageBalanceOf(input),
    submitSignedDelegateAction: (input) =>
      actor.serialize(caip2Id, () =>
        reference.submitSignedDelegateAction(input),
      ),
  };
};
