import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Asset, Keypair, Networks, StrKey, xdr } from "@stellar/stellar-sdk";
import { simulationError, StellarActor } from "../StellarActor";
import { env } from "../../shared/env";

const FACTORY = "CA7OSTMOZ5LSMQYSKXONCDKCPHVCNEF6E2IK7GUX2IX4C65RLUDCFLMK";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

const errorEvent = (contract: string, error: xdr.ScError) =>
  new xdr.DiagnosticEvent({
    inSuccessfulContractCall: false,
    event: new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      contractId: StrKey.decodeContract(contract) as never,
      type: xdr.ContractEventType.diagnostic(),
      body: new xdr.ContractEventBody(
        0,
        new xdr.ContractEventV0({
          topics: [xdr.ScVal.scvSymbol("error"), xdr.ScVal.scvError(error)],
          data: xdr.ScVal.scvVoid(),
        }),
      ),
    }),
  });

describe("simulationError", () => {
  it("blames the contract that raised the final error, past one a try_ call recovered", () => {
    const error = simulationError({
      error: "HostError: Error(Contract, #13)",
      events: [
        // the factory's try_get_status on a deposit not deployed yet
        errorEvent(
          FACTORY,
          xdr.ScError.sceStorage(xdr.ScErrorCode.scecMissingValue()),
        ),
        errorEvent(USDC, xdr.ScError.sceContract(13)),
        errorEvent(FACTORY, xdr.ScError.sceContract(13)),
      ],
    } as never);

    expect(error.contract).toBe(USDC);
    expect(error.code).toBe(13);
  });
});

describe("StellarActor.receivable", () => {
  const CAIP2 = "stellar:testnet" as Caip2Id;
  const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
  const HOLDER = Keypair.random().publicKey();
  const usdc = new Asset("USDC", ISSUER).contractId(Networks.TESTNET);
  const xlm = Asset.native().contractId(Networks.TESTNET);

  // a ledger holding `held` entry types for every account
  const actorWith = (held: string[], names: Record<string, string>) => {
    const actor = new StellarActor();
    const view = vi.fn(async (...args: unknown[]) => names[args[1] as string]);
    const getLedgerEntries = vi.fn(async (...keys: xdr.LedgerKey[]) => ({
      entries: keys
        .filter((key) => held.includes(key.switch().name))
        .map((key) => ({ key })),
    }));
    Object.assign(actor, {
      view,
      rpc: () => ({ getLedgerEntries }),
    });
    return { actor, view, getLedgerEntries };
  };

  const names = { [usdc]: `USDC:${ISSUER}`, [xlm]: "native" };

  beforeAll(() => {
    env.KITE_IS_TESTNET = true;
  });
  afterAll(() => {
    env.KITE_IS_TESTNET = false;
  });

  it("asks for the account and its trustline in one read", async () => {
    const { actor, getLedgerEntries } = actorWith(
      ["account", "trustline"],
      names,
    );

    expect(await actor.receivable(CAIP2, usdc, HOLDER)).toBe("ok");
    expect(getLedgerEntries).toHaveBeenCalledTimes(1);
    expect(
      getLedgerEntries.mock.calls[0].map((key) => key.switch().name),
    ).toEqual(["account", "trustline"]);
  });

  it("tells an unfunded account from one without a trustline", async () => {
    expect(
      await actorWith([], names).actor.receivable(CAIP2, usdc, HOLDER),
    ).toBe("unfunded");
    expect(
      await actorWith(["account"], names).actor.receivable(CAIP2, usdc, HOLDER),
    ).toBe("untrusted");
  });

  it("needs only a funded account for XLM, and nothing for the issuer's own asset", async () => {
    const { actor, getLedgerEntries } = actorWith(["account"], names);

    expect(await actor.receivable(CAIP2, xlm, HOLDER)).toBe("ok");
    expect(await actor.receivable(CAIP2, usdc, ISSUER)).toBe("ok");
    expect(getLedgerEntries.mock.calls.map((keys) => keys.length)).toEqual([
      1, 1,
    ]);
  });

  it("asks nothing of C… addresses or tokens that aren't Stellar Asset Contracts", async () => {
    const { actor, getLedgerEntries } = actorWith([], {
      [FACTORY]: "Kite Token",
    });

    expect(await actor.receivable(CAIP2, usdc, FACTORY)).toBe("ok");
    expect(await actor.receivable(CAIP2, FACTORY, HOLDER)).toBe("ok");
    expect(getLedgerEntries).not.toHaveBeenCalled();
  });

  it("looks up which asset a token wraps only once", async () => {
    const { actor, view } = actorWith(["account", "trustline"], names);

    await actor.receivable(CAIP2, usdc, HOLDER);
    await actor.receivable(CAIP2, usdc, HOLDER);
    expect(await actor.isSac(CAIP2, usdc)).toBe(true);
    expect(view).toHaveBeenCalledTimes(1);
  });
});
