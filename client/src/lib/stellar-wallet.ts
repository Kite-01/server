export type StellarWallet = {
  kind: "stellar";
  name: string;
  address: string;
  networkPassphrase: string;
};

const Passphrases: Record<string, string> = {
  "stellar:testnet": "Test SDF Network ; September 2015",
  "stellar:pubnet": "Public Global Stellar Network ; September 2015",
};

export const stellarPassphraseOf = (caip2Id: string) => Passphrases[caip2Id];

// G… and C… are 56 characters, M… (muxed) 69; the server checks the checksum
export const isStellarAddress = (value: string) =>
  /^[GC][A-Z2-7]{55}$|^M[A-Z2-7]{68}$/.test(value);

let kit: Promise<
  typeof import("@creit.tech/stellar-wallets-kit/sdk").StellarWalletsKit
> | null = null;

// Loaded only when a payer picks Stellar, so other checkouts don't download it. The default modules
// need no keys; WalletConnect, which needs a project id, is left out.
const loadKit = (networkPassphrase: string) => {
  kit ??= (async () => {
    const [{ StellarWalletsKit }, { defaultModules }] = await Promise.all([
      import("@creit.tech/stellar-wallets-kit/sdk"),
      import("@creit.tech/stellar-wallets-kit/modules/utils"),
    ]);
    StellarWalletsKit.init({ modules: defaultModules() });
    return StellarWalletsKit;
  })();

  return kit.then((loaded) => {
    loaded.setNetwork(networkPassphrase as never);
    return loaded;
  });
};

export const connectStellarWallet = async (
  caip2Id: string,
): Promise<StellarWallet | null> => {
  const networkPassphrase = stellarPassphraseOf(caip2Id);
  const wallets = await loadKit(networkPassphrase);

  let address: string;
  try {
    ({ address } = await wallets.authModal());
  } catch (e) {
    if ((e as { code?: number }).code === -1) return null;
    throw new Error((e as { message?: string }).message ?? String(e));
  }

  // not every wallet reports its network
  const network = await wallets.getNetwork().catch(() => null);
  if (network && network.networkPassphrase !== networkPassphrase) {
    throw new Error(
      `Switch your wallet to ${caip2Id === "stellar:testnet" ? "Testnet" : "Mainnet"} and try again`,
    );
  }

  return {
    kind: "stellar",
    name: wallets.selectedModule.productName,
    address,
    networkPassphrase,
  };
};

// A SEP-41 `transfer` to the pay-in contract: classic payments can't reach a C… address.
export const sendStellarPayment = async (
  wallet: StellarWallet,
  rpcUrl: string,
  token: string,
  to: string,
  amount: string,
): Promise<string> => {
  const [
    wallets,
    { Address, Contract, rpc, TransactionBuilder, nativeToScVal },
  ] = await Promise.all([
    loadKit(wallet.networkPassphrase),
    import("@stellar/stellar-sdk"),
  ]);

  const server = new rpc.Server(rpcUrl);
  const account = await server.getAccount(wallet.address);
  const tx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: wallet.networkPassphrase,
  })
    .addOperation(
      new Contract(token).call(
        "transfer",
        Address.fromString(wallet.address).toScVal(),
        Address.fromString(to).toScVal(),
        nativeToScVal(BigInt(amount), { type: "i128" }),
      ),
    )
    .setTimeout(300)
    .build();

  const prepared = await server.prepareTransaction(tx);
  const signed = await wallets.signTransaction(prepared.toXDR(), {
    networkPassphrase: wallet.networkPassphrase,
    address: wallet.address,
  });

  const sent = await server.sendTransaction(
    TransactionBuilder.fromXDR(signed.signedTxXdr, wallet.networkPassphrase),
  );
  if (sent.status === "ERROR") {
    throw new Error("Stellar refused the payment");
  }

  return sent.hash;
};
