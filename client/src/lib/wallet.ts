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

export const toViemChain = (chain: CheckoutChain) =>
  defineChain({
    id: chain.chainId!,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: { default: { http: chain.rpcUrls } },
    ...(chain.blockExplorer
      ? { blockExplorers: { default: chain.blockExplorer } }
      : {}),
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
  if (chain.chainId === null)
    throw new Error(`${chain.name} isn't an EVM chain`);
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
          blockExplorerUrls: chain.blockExplorer
            ? [chain.blockExplorer.url]
            : undefined,
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
