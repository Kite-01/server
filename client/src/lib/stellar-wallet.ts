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

export const connectStellarWallet = async (
  caip2Id: string,
): Promise<StellarWallet | null> => {
  const freighter = await import("@stellar/freighter-api");
  const { isConnected } = await freighter.isConnected();
  if (!isConnected) {
    throw new Error("Install the Freighter extension to pay with Stellar");
  }

  const access = await freighter.requestAccess();
  if (access.error || !access.address) return null;

  const networkPassphrase = stellarPassphraseOf(caip2Id);
  const network = await freighter.getNetworkDetails();
  if (network.networkPassphrase !== networkPassphrase) {
    throw new Error(
      `Switch Freighter to ${caip2Id === "stellar:testnet" ? "Testnet" : "Mainnet"} and try again`,
    );
  }

  return {
    kind: "stellar",
    name: "Freighter",
    address: access.address,
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
    freighter,
    { Address, Contract, rpc, TransactionBuilder, nativeToScVal },
  ] = await Promise.all([
    import("@stellar/freighter-api"),
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
  const signed = await freighter.signTransaction(prepared.toXDR(), {
    networkPassphrase: wallet.networkPassphrase,
    address: wallet.address,
  });
  if (signed.error) throw new Error(signed.error.message);

  const sent = await server.sendTransaction(
    TransactionBuilder.fromXDR(signed.signedTxXdr, wallet.networkPassphrase),
  );
  if (sent.status === "ERROR") {
    throw new Error("Stellar refused the payment");
  }

  return sent.hash;
};
