import {
  createWalletClient,
  custom,
  defineChain,
  erc20Abi,
  getAddress,
  isAddressEqual,
  toHex,
  zeroAddress,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import type { Checkout } from "@/api/types.gen";

export type CheckoutChain = Checkout["chains"][number];

export type Wallet = {
  id: string;
  name: string;
  icon?: string;
  provider: EIP1193Provider;
};

type Announcement = CustomEvent<{
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
}>;

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

// EIP-6963: every installed wallet announces itself; older wallets only
// inject window.ethereum, which is used when nothing announces.
export const discoverWallets = () =>
  new Promise<Wallet[]>((resolve) => {
    const wallets = new Map<string, Wallet>();
    const onAnnounce = (event: Event) => {
      const { info, provider } = (event as Announcement).detail;
      wallets.set(info.rdns || info.uuid, {
        id: info.uuid,
        name: info.name,
        icon: info.icon,
        provider,
      });
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);

      if (!wallets.size && window.ethereum) {
        wallets.set("injected", {
          id: "injected",
          name: "Browser wallet",
          provider: window.ethereum,
        });
      }

      resolve([...wallets.values()]);
    }, 400);
  });

const toViemChain = (chain: CheckoutChain) =>
  defineChain({
    id: chain.chainId,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: { default: { http: chain.rpcUrls } },
    blockExplorers: { default: chain.blockExplorer },
  });

export const walletMessage = (error: unknown) => {
  const e = error as { code?: number; shortMessage?: string; message?: string };
  if (e?.code === 4001) return "You rejected the request in your wallet";
  return e?.shortMessage ?? e?.message ?? "Your wallet returned an error";
};

export const connectWallet = async (wallet: Wallet) => {
  const accounts = (await wallet.provider.request({
    method: "eth_requestAccounts",
  })) as string[];

  if (!accounts[0]) throw new Error("Your wallet didn't share an account");
  return getAddress(accounts[0]);
};

export const switchChain = async (wallet: Wallet, chain: CheckoutChain) => {
  const chainId = toHex(chain.chainId);
  const current = await wallet.provider.request({ method: "eth_chainId" });
  if (Number(current) === chain.chainId) return;

  try {
    await wallet.provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (error) {
    // 4902: the wallet doesn't know this chain yet.
    if ((error as { code?: number }).code !== 4902) throw error;

    await wallet.provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: chain.rpcUrls,
          blockExplorerUrls: [chain.blockExplorer.url],
        },
      ],
    });
  }
};

const client = (wallet: Wallet, account: Address, chain: CheckoutChain) =>
  createWalletClient({
    account,
    chain: toViemChain(chain),
    transport: custom(wallet.provider),
  });

// The zero address stands for the chain's native currency.
export const sendToken = (
  wallet: Wallet,
  account: Address,
  chain: CheckoutChain,
  token: string,
  to: string,
  amount: string,
): Promise<Hex> => {
  const sender = client(wallet, account, chain);

  if (isAddressEqual(getAddress(token), zeroAddress)) {
    return sender.sendTransaction({
      to: getAddress(to),
      value: BigInt(amount),
    });
  }

  return sender.writeContract({
    address: getAddress(token),
    abi: erc20Abi,
    functionName: "transfer",
    args: [getAddress(to), BigInt(amount)],
  });
};
