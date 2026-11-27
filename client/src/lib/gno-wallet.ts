export type GnoWallet = {
  kind: "gno";
  name: string;
  address: string;
};

type AdenaResponse<T = Record<string, unknown>> = {
  status: "success" | "failure";
  type: string;
  message: string;
  data: T;
};

type Adena = {
  AddEstablish: (name: string) => Promise<AdenaResponse>;
  GetAccount: () => Promise<
    AdenaResponse<{ address: string; chainId: string }>
  >;
  AddNetwork: (network: {
    chainId: string;
    chainName: string;
    rpcUrl: string;
  }) => Promise<AdenaResponse>;
  SwitchNetwork: (chainId: string) => Promise<AdenaResponse>;
  DoContract: (tx: {
    messages: Array<{ type: string; value: Record<string, unknown> }>;
    gasFee: number;
    gasWanted: number;
    memo?: string;
  }) => Promise<AdenaResponse<{ hash: string }>>;
};

const adena = () => (window as { adena?: Adena }).adena;

export const isGnoAddress = (value: string) =>
  /^g1[02-9ac-hj-np-z]{38}$/.test(value);

const ok = <T>(response: AdenaResponse<T>) => {
  if (response.status !== "success") throw new Error(response.message);
  return response.data;
};

export const connectGnoWallet = async (chain: {
  caip2Id: string;
  name: string;
  rpcUrls: string[];
}): Promise<GnoWallet | null> => {
  const wallet = adena();
  if (!wallet) {
    window.open("https://www.adena.app", "_blank", "noopener");
    throw new Error("Install Adena to pay from a Gno.land wallet");
  }

  const established = await wallet.AddEstablish("Kite");
  if (
    established.status !== "success" &&
    established.type !== "ALREADY_CONNECTED"
  ) {
    return null;
  }

  const chainId = chain.caip2Id.replace(/^gno:/, "");
  let account = ok(await wallet.GetAccount());
  if (account.chainId !== chainId) {
    const switched = await wallet.SwitchNetwork(chainId);
    if (switched.status !== "success") {
      ok(
        await wallet.AddNetwork({
          chainId,
          chainName: chain.name,
          rpcUrl: chain.rpcUrls[0],
        }),
      );
      ok(await wallet.SwitchNetwork(chainId));
    }
    account = ok(await wallet.GetAccount());
  }

  return { kind: "gno", name: "Adena", address: account.address };
};

// GNOT is a bank send; a GRC20 is its realm's Transfer
export const sendGnoPayment = async (
  wallet: GnoWallet,
  token: string,
  to: string,
  amount: string,
): Promise<string> => {
  const message =
    token === "ugnot"
      ? {
          type: "/bank.MsgSend",
          value: {
            from_address: wallet.address,
            to_address: to,
            amount: `${amount}ugnot`,
          },
        }
      : {
          type: "/vm.m_call",
          value: {
            caller: wallet.address,
            send: "",
            pkg_path: token.slice(0, token.lastIndexOf(".")),
            func: "Transfer",
            args: [to, amount],
          },
        };

  const sent = ok(
    await adena()!.DoContract({
      messages: [message],
      gasFee: 100_000,
      gasWanted: 10_000_000,
    }),
  );
  return sent.hash;
};
