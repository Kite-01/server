import { Networks, StrKey, scValToNative, xdr } from "@stellar/stellar-sdk";
import { db } from "../db";
import { appChain, chain, chainConfig, quote, token } from "../db/schema";
import {
  kiteStellar,
  type StellarKiteTransfer,
} from "../shared/kiteStellarContract";
import { StellarSimulationError } from "../sdks/StellarActor";
import { createApp } from "./factories";
import { fakeStellarActor } from "./mocks";
import { env } from "../shared/env";

export const STELLAR_CAIP2 = "stellar:testnet" as Caip2Id;
export const STELLAR_FACTORY =
  "CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L";
export const STELLAR_USDC =
  "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const STELLAR_XLM =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
export const STELLAR_ROUTER =
  "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";
export const STELLAR_SHOP =
  "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";
export const STELLAR_PAYER =
  "GDWUSKGGFDI4FRXK5EBTRECZSVQSSWJHHJOGH6JWG3AUMFFMQ435DIAG";
export const STELLAR_IMPLEMENTATION = Buffer.alloc(32, 5);

export const notDeployed = () =>
  new StellarSimulationError(
    "HostError: Error(Storage, MissingValue)",
    null,
    null,
  );

export const kiteError = (contract: string, code: number) =>
  new StellarSimulationError(
    `HostError: Error(Contract, #${code})`,
    contract,
    code,
  );

export const setupStellarChain = async () => {
  env.KITE_IS_TESTNET = true;

  const appId = (await createApp()).id;
  const [row] = await db
    .insert(chain)
    .values({ caip2Id: STELLAR_CAIP2 })
    .returning();
  const chainId = row.id;

  const [usdc, xlm] = await db
    .insert(token)
    .values(
      [
        { address: STELLAR_USDC, symbol: "USDC", name: "USDC" },
        { address: STELLAR_XLM, symbol: "XLM", name: "Stellar Lumens" },
      ].map((item) => ({ ...item, chainId, decimals: 7, listed: true })),
    )
    .returning();

  await db.insert(chainConfig).values({
    chainId,
    slippageBps: 100,
    kiteFactoryAddress: STELLAR_FACTORY,
    usdPeggedTokenId: usdc.id,
    settlementTokenId: usdc.id,
    onchainNotifierProviders: [],
    gasSponsorProviders: [],
  });

  await db.insert(appChain).values({ appId, chainId, address: STELLAR_SHOP });

  fakeStellarActor.view.mockImplementation(async (...args: unknown[]) => {
    const [, contract, method, params] = args as [
      Caip2Id,
      string,
      string,
      xdr.ScVal[],
    ];
    if (contract === STELLAR_FACTORY && method === "implementation")
      return STELLAR_IMPLEMENTATION;
    if (contract === STELLAR_FACTORY && method === "predict_address")
      return kiteStellar.predictAddress(
        STELLAR_FACTORY,
        fromScVal(params[0]),
        Networks.TESTNET,
      );
    throw new Error(`unexpected view ${contract}.${method}`);
  });
  fakeStellarActor.simulate.mockRejectedValue(notDeployed());

  return { appId, chainId, usdcId: usdc.id, xlmId: xlm.id };
};

const fromScVal = (value: xdr.ScVal): StellarKiteTransfer => {
  const t = scValToNative(value) as Record<string, any>;
  const [variant, swap] = t.swap as [
    string,
    { router: string; path: string[] }?,
  ];
  return {
    id: Buffer.from(t.id).toString("hex"),
    pay_in: t.pay_in,
    amount_in: String(t.amount_in),
    settlement_token: t.settlement_token,
    settlement_recipient: t.settlement_recipient,
    min_amount_out: String(t.min_amount_out),
    fees: t.fees.map((fee: { recipient: string; amount: bigint }) => ({
      recipient: fee.recipient,
      amount: String(fee.amount),
    })),
    refund_address: t.refund_address,
    expires_at: String(t.expires_at),
    swap: variant === "Some" ? swap! : null,
    implementation: Buffer.from(t.implementation).toString("hex"),
  };
};

export const createStellarQuoteRow = async (input: {
  appId: string;
  chainId: string;
  sourceTokenId: string;
  targetTokenId: string;
  sourceAmount?: bigint;
  targetAmount?: bigint;
  swapPool?: string;
}) => {
  const [row] = await db
    .insert(quote)
    .values({
      appId: input.appId,
      chainId: input.chainId,
      sourceTokenId: input.sourceTokenId,
      targetTokenId: input.targetTokenId,
      sourceAmount: input.sourceAmount ?? 10_000_000n,
      targetAmount: input.targetAmount ?? input.sourceAmount ?? 10_000_000n,
      sourceUsdAmount: "1",
      targetUsdAmount: "1",
      rate: "1",
      swapPool: input.swapPool,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    .returning();

  return row;
};

export const stellarEvent = (
  contract: string,
  name: string,
  data: Record<string, xdr.ScVal>,
) =>
  new xdr.ContractEvent({
    ext: new xdr.ExtensionPoint(0),
    contractId: StrKey.decodeContract(contract) as any,
    type: xdr.ContractEventType.contract(),
    body: new xdr.ContractEventBody(
      0,
      new xdr.ContractEventV0({
        topics: [xdr.ScVal.scvSymbol("kite"), xdr.ScVal.scvSymbol(name)],
        data: xdr.ScVal.scvMap(
          Object.keys(data)
            .sort()
            .map(
              (key) =>
                new xdr.ScMapEntry({
                  key: xdr.ScVal.scvSymbol(key),
                  val: data[key],
                }),
            ),
        ),
      }),
    ),
  });

export const stellarResult = (events: xdr.ContractEvent[] = []) => ({
  transactionHash: "ab".repeat(32),
  status: "success",
  events,
});
