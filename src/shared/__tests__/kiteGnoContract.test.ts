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

const vector = (): GnoKiteTransfer => ({
  id: "6f1c2a8e4b3d4f0a9e7c5b1d2f3a4e5b",
  token: "ugnot",
  amount: "1000000",
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
      "kite1;id=6f1c2a8e4b3d4f0a9e7c5b1d2f3a4e5b;token=ugnot;amount=1000000;recipient=g1d4jhycmgv9h8gh6lta047h6lta047h6lsu9czk;fees=g1dd5hgetxv4j47h6lta047h6lta047h6lssult0:2500,g1v9c8qen9v4047h6lta047h6lta047h6lq7p8ns:7500;refund=g1vd6hxar0d4jhyh6lta047h6lta047h6lws58ht;expires=1767225600",
    );
    expect(kiteGno.hash(t)).toBe(
      "135af05a47f4a89260e5ab1cb80137cd871bbe98e6ee6fd9aff633a529ed37a9",
    );
    expect(kiteGno.predictAddress(REALM, t)).toBe(
      "g1030wu905kce5qzfmvtu2v2w596xdkycng9x6en",
    );

    const kusd = { ...t, token: `gno.land/r/${NS}/kusd.KUSD`, fees: [] };
    expect(kiteGno.hash(kusd)).toBe(
      "b153a95f690067bdd107455ba8a79e1adb33a629636928b456c091a426737d57",
    );
    expect(kiteGno.predictAddress(REALM, kusd)).toBe(
      "g1u6zctfesyqeu2z5nf3ca6jmp3rquj8nhnjhnnm",
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
      recipient: vector().recipient,
      fees: [
        { id: "b", recipient: vector().fees[1].recipient, amount: 7_500n },
        { id: "a", recipient: vector().fees[0].recipient, amount: 2_500n },
      ],
      refundAddress: vector().refund,
      expiresAt: new Date(1_767_225_600_000),
    });
    expect(t).toEqual(vector());
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
