import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { actionCreators } from "@near-js/transactions";

// The token address Kite uses for native NEAR, as the zero address is native ETH on EVM.
export const NearNativeToken = "near";

export type NearNetwork = "mainnet" | "testnet";

export type NearWallet = {
  kind: "near";
  id: string;
  name: string;
  icon?: string;
  accountId: string;
  network: NearNetwork;
};

export const isNearAccountId = (value: string) =>
  value.length >= 2 &&
  value.length <= 64 &&
  /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(value);

export const nearNetworkOf = (caip2Id: string): NearNetwork =>
  caip2Id === "near:testnet" ? "testnet" : "mainnet";

const selectors = new Map<
  NearNetwork,
  Promise<{ selector: WalletSelector; modal: WalletSelectorModal }>
>();

// Loaded only when a payer picks NEAR, so EVM checkouts don't download it.
const load = (network: NearNetwork) => {
  let found = selectors.get(network);
  if (!found) {
    found = (async () => {
      const [core, modalUi, meteor, intear, here, myNear] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/modal-ui"),
        import("@near-wallet-selector/meteor-wallet"),
        import("@near-wallet-selector/intear-wallet"),
        import("@near-wallet-selector/here-wallet"),
        import("@near-wallet-selector/my-near-wallet"),
        import("@near-wallet-selector/modal-ui/styles.css"),
      ]);

      const selector = await core.setupWalletSelector({
        network,
        modules: [
          meteor.setupMeteorWallet(),
          intear.setupIntearWallet(),
          here.setupHereWallet(),
          myNear.setupMyNearWallet(),
        ],
      });

      const modal = modalUi.setupModal(selector, {
        description: "Pick the NEAR wallet to pay from",
      });

      return { selector, modal };
    })();
    selectors.set(network, found);
  }

  return found;
};

const current = async (
  selector: WalletSelector,
  network: NearNetwork,
): Promise<NearWallet | null> => {
  const accountId = selector.store
    .getState()
    .accounts.find((account) => account.active)?.accountId;
  if (!accountId) return null;

  const wallet = await selector.wallet();
  return {
    kind: "near",
    id: wallet.id,
    name: wallet.metadata.name,
    icon: wallet.metadata.iconUrl,
    accountId,
    network,
  };
};

export const connectNearWallet = async (
  network: NearNetwork,
): Promise<NearWallet> => {
  const { selector, modal } = await load(network);
  const signedIn = selector.isSignedIn()
    ? await current(selector, network)
    : null;
  if (signedIn) return signedIn;

  return new Promise((resolve, reject) => {
    const onSignedIn = selector.on("signedIn", async () => {
      onSignedIn.remove();
      onHide.remove();
      const wallet = await current(selector, network);
      if (wallet) resolve(wallet);
      else reject(new Error("Your wallet didn't share an account"));
    });

    const onHide = modal.on("onHide", ({ hideReason }) => {
      if (hideReason !== "user-triggered") return;
      onSignedIn.remove();
      onHide.remove();
      reject(new Error("You closed the wallet picker"));
    });

    modal.show();
  });
};

// Sends native NEAR, or a NEP-141 token with ft_transfer, to the transfer's deposit account.
// Kite registers that account on the token when it opens the transfer.
export const sendNearPayment = async (
  wallet: NearWallet,
  token: string,
  to: string,
  amount: string,
): Promise<string | undefined> => {
  const { selector } = await load(wallet.network);
  const active = await selector.wallet();

  const outcome = await active.signAndSendTransaction(
    token === NearNativeToken
      ? {
          signerId: wallet.accountId,
          receiverId: to,
          actions: [actionCreators.transfer(BigInt(amount))],
        }
      : {
          signerId: wallet.accountId,
          receiverId: token,
          actions: [
            actionCreators.functionCall(
              "ft_transfer",
              { receiver_id: to, amount },
              30_000_000_000_000n,
              1n,
            ),
          ],
        },
  );

  return outcome?.transaction_outcome?.id;
};
