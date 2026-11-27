import { describe, expect, it } from "vitest";
import { GnoWallet } from "@gnolang/gno-js-client";
import { kiteGno, type GnoKiteTransfer } from "../kiteGnoContract";
import {
  gnoKey,
  gnoSubRealmAddress,
  isGnoAddress,
  isGnoToken,
} from "../gnoAddress";

// the dev namespace Kite-01/gno-contracts' tests use
const NS = "g1dd5hgetyv4m97h6lta047h6lta047h6lcxye47";
const REALM = `gno.land/r/${NS}/kite`;
const TUSD = `gno.land/r/${NS}/tusd.tUSD`;
const COIN = "gno.land/r/demo/defi/foo20.FOO";

const swapVector = (): GnoKiteTransfer => ({
  ...vector(),
  token: COIN,
  amount: "5000000",
  settle: TUSD,
  min_out: "990000",
  route: `${COIN}:${TUSD}:3000`,
  fees: vector().fees.slice(0, 1),
});

const vector = (): GnoKiteTransfer => ({
  id: "6f1c2a8e4b3d4f0a9e7c5b1d2f3a4e5b",
  token: "ugnot",
  amount: "1000000",
  settle: "ugnot",
  min_out: "1000000",
  route: "",
  recipient: "g1d4jhycmgv9h8gh6lta047h6lta047h6lsu9czk",
  fees: [
    { recipient: "g1dd5hgetxv4j47h6lta047h6lta047h6lssult0", amount: "2500" },
    { recipient: "g1v9c8qen9v4047h6lta047h6lta047h6lq7p8ns", amount: "7500" },
  ],
  refund: "g1vd6hxar0d4jhyh6lta047h6lta047h6lws58ht",
  expires_at: "1767225600",
});

describe("kiteGno", () => {
  it("pins the vectors of Kite-01/gno-contracts' p/kite", () => {
    const t = vector();
    expect(kiteGno.encode(t)).toBe(
      "kite1;id=6f1c2a8e4b3d4f0a9e7c5b1d2f3a4e5b;token=ugnot;amount=1000000;settle=ugnot;min_out=1000000;route=;recipient=g1d4jhycmgv9h8gh6lta047h6lta047h6lsu9czk;fees=g1dd5hgetxv4j47h6lta047h6lta047h6lssult0:2500,g1v9c8qen9v4047h6lta047h6lta047h6lq7p8ns:7500;refund=g1vd6hxar0d4jhyh6lta047h6lta047h6lws58ht;expires=1767225600",
    );
    expect(kiteGno.hash(t)).toBe(
      "31be054e43d5db8aed10893d5fc3b695e1147361057e6945c21069a14616306c",
    );
    expect(kiteGno.predictAddress(REALM, t)).toBe(
      "g1vlddy9d5qm9wt78tkk57xvxge8r767yklum3j4",
    );

    const tusd = {
      ...t,
      token: TUSD,
      settle: TUSD,
      fees: [],
    };
    expect(kiteGno.hash(tusd)).toBe(
      "a9bc035e2335a3e30cd783245de36702725d6927cd89e2c898659ec4ba78e40f",
    );
    expect(kiteGno.predictAddress(REALM, tusd)).toBe(
      "g1g5u0pcqxpqasj90qmatps0ltwkltp9lwtvlzd7",
    );

    expect(kiteGno.hash(swapVector())).toBe(
      "d57d8a1d319cc1483737659ee0927b0fd8592f385045762156786defbfcc7f0c",
    );
    expect(kiteGno.predictAddress(REALM, swapVector())).toBe(
      "g1yr5qn0fyzxtfmgjwjhhekhwxmc59pnxkezlsnr",
    );
  });

  it("derives sub-realm addresses as chain.DerivePkgSubAddr does", () => {
    expect(gnoSubRealmAddress("gno.land/r/kitespike", "t/3f9a0c2e")).toBe(
      "g1sm2jvz3xs467z9c0e5mdyq74g68awpe7m7dqny",
    );
  });

  it("builds a transfer from the server's ids, fees sorted by id", () => {
    const t = kiteGno.buildTransferInput({
      transferId: "6f1c2a8e-4b3d-4f0a-9e7c-5b1d2f3a4e5b",
      token: "ugnot",
      amount: 1_000_000n,
      settle: "ugnot",
      minAmountOut: 990_000n,
      route: "ignored",
      recipient: vector().recipient,
      fees: [
        { id: "b", recipient: vector().fees[1].recipient, amount: 7_500n },
        { id: "a", recipient: vector().fees[0].recipient, amount: 2_500n },
      ],
      refundAddress: vector().refund,
      expiresAt: new Date(1_767_225_600_000),
    });
    expect(t).toEqual(vector());

    const swap = kiteGno.buildTransferInput({
      transferId: "6f1c2a8e-4b3d-4f0a-9e7c-5b1d2f3a4e5b",
      token: COIN,
      amount: 5_000_000n,
      settle: TUSD,
      minAmountOut: 990_000n,
      route: `${COIN}:${TUSD}:3000`,
      recipient: vector().recipient,
      fees: [
        { id: "a", recipient: vector().fees[0].recipient, amount: 2_500n },
      ],
      refundAddress: vector().refund,
      expiresAt: new Date(1_767_225_600_000),
    });
    expect(swap).toEqual(swapVector());
  });

  it("rejects what the realm rejects", () => {
    const bad: Array<Partial<GnoKiteTransfer>> = [
      { id: "0".repeat(32) },
      { id: "6F1C2A8E4B3D4F0A9E7C5B1D2F3A4E5B" },
      { token: "uatom" },
      { amount: "0" },
      { amount: "01" },
      { amount: (2n ** 63n).toString() },
      { recipient: "g1d4jhycmgv9h8gh6lta047h6lta047h6lsu9czj" },
      { fees: [{ recipient: vector().recipient, amount: "1000001" }] },
      {
        fees: Array.from({ length: 11 }, () => ({
          recipient: vector().recipient,
          amount: "1",
        })),
      },
    ];
    for (const change of bad) {
      expect(
        kiteGno.validateTransferInput({ ...vector(), ...change }),
      ).not.toBeNull();
    }

    const GNS = "gno.land/r/gnoswap/gns.GNS";
    expect(kiteGno.validateTransferInput(swapVector())).toBeNull();
    expect(
      kiteGno.validateTransferInput({
        ...swapVector(),
        route: `${COIN}:${GNS}:500*POOL*${GNS}:${TUSD}:10000`,
      }),
    ).toBeNull();
    const badSwaps: Array<Partial<GnoKiteTransfer>> = [
      { route: "" },
      { route: `${COIN}:${TUSD}:42` },
      { route: `${GNS}:${TUSD}:3000` },
      { route: `${COIN}:${GNS}:3000` },
      { token: "ugnot", route: `ugnot:${TUSD}:3000` },
      { min_out: "0" },
      { fees: [{ recipient: vector().recipient, amount: "990001" }] },
    ];
    for (const change of badSwaps) {
      expect(
        kiteGno.validateTransferInput({ ...swapVector(), ...change }),
      ).not.toBeNull();
    }
    expect(
      kiteGno.validateTransferInput({ ...vector(), min_out: "999999" }),
    ).not.toBeNull();
  });

  it("reads the realm's errors", () => {
    expect(
      kiteGno.errorName("panic: kite: InsufficientPayment\n\ngno stacktrace"),
    ).toBe("InsufficientPayment");
    expect(kiteGno.errorName("out of gas")).toBeNull();
  });

  it("validates Gno addresses and tokens", () => {
    expect(isGnoAddress(vector().recipient)).toBe(true);
    expect(isGnoAddress(vector().recipient.toUpperCase())).toBe(false);
    expect(isGnoToken("ugnot")).toBe(true);
    expect(isGnoToken("gno.land/r/gnoland/wugnot.wugnot")).toBe(true);
    expect(isGnoToken("gno.land/r/gnoland/wugnot")).toBe(false);
  });

  it("derives the operator as gno-js-client's wallet does", async () => {
    const mnemonic =
      "test test test test test test test test test test test junk";
    const wallet = await GnoWallet.fromMnemonic(mnemonic, {
      addressPrefix: "g",
      accountIndex: 0,
    });
    expect(gnoKey(mnemonic).address).toBe(await wallet.getAddress());
  });
});
