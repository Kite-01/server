import "@rainbow-me/rainbowkit/styles.css";
import {
  RainbowKitProvider,
  connectorsForWallets,
  lightTheme,
  useConnectModal,
} from "@rainbow-me/rainbowkit";
import { coinbaseWallet, injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { Chain, EIP1193Provider } from "viem";
import { mainnet } from "viem/chains";
import {
  WagmiProvider,
  createConfig,
  http,
  useConfig,
  type Connector,
} from "wagmi";
import { getAccount, watchAccount } from "wagmi/actions";
import { toViemChain, type CheckoutChain, type Wallet } from "./wallet";

// Browser wallets (every installed extension, found through EIP-6963) and Coinbase Wallet,
// none of which needs an API key. WalletConnect, for phone wallets by QR code, needs a
// Reown project id, so it isn't offered.
const connectors = connectorsForWallets(
  [{ groupName: "Wallets", wallets: [injectedWallet, coinbaseWallet] }],
  { appName: "Kite", projectId: "" },
);

export const EvmWalletProvider = ({
  chains,
  children,
}: {
  chains: CheckoutChain[];
  children: ReactNode;
}) => {
  const ids = chains.map((chain) => chain.id).join();
  const config = useMemo(() => {
    // wagmi needs a chain; without EVM chains nothing connects, so any will do
    const evm = (chains.length
      ? chains.map(toViemChain)
      : [mainnet]) as unknown as [Chain, ...Chain[]];
    return createConfig({
      chains: evm,
      connectors,
      transports: Object.fromEntries(evm.map((chain) => [chain.id, http()])),
    });
    // the chains change only with the link
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  return (
    <WagmiProvider config={config}>
      <RainbowKitProvider
        modalSize="compact"
        theme={lightTheme({ accentColor: "#111111", borderRadius: "large" })}
      >
        {children}
      </RainbowKitProvider>
    </WagmiProvider>
  );
};

const toWallet = async (connector: Connector): Promise<Wallet> => ({
  id: connector.id,
  name: connector.name,
  icon: connector.icon,
  provider: (await connector.getProvider()) as EIP1193Provider,
});

/** Opens RainbowKit's modal; resolves to the connected wallet, or null when it's closed. */
export const useConnectEvmWallet = () => {
  const config = useConfig();
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const pending = useRef<((wallet: Wallet | null) => void) | null>(null);
  const opened = useRef(false);

  useEffect(
    () =>
      watchAccount(config, {
        onChange: (account) => {
          if (account.status !== "connected" || !pending.current) return;
          const resolve = pending.current;
          pending.current = null;
          toWallet(account.connector).then(resolve, () => resolve(null));
        },
      }),
    [config],
  );

  useEffect(() => {
    if (connectModalOpen) {
      opened.current = true;
      return;
    }
    if (!opened.current) return;
    opened.current = false;

    // closed: a wallet that connected resolves first, through watchAccount
    const resolve = pending.current;
    setTimeout(() => {
      if (resolve && pending.current === resolve) {
        pending.current = null;
        resolve(null);
      }
    }, 300);
  }, [connectModalOpen]);

  return useCallback(async (): Promise<Wallet | null> => {
    const current = getAccount(config);
    if (current.status === "connected") return toWallet(current.connector);

    return new Promise((resolve) => {
      pending.current = resolve;
      opened.current = false;
      openConnectModal?.();
    });
  }, [config, openConnectModal]);
};
