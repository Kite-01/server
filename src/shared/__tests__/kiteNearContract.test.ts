import { describe, expect, it } from "vitest";
import { toHex } from "viem";
import { kiteNear, type NearKiteTransfer } from "../kiteNearContract";

// The same transfer as `vector::fixed_vector` in Kite-01/near-contracts, contracts/kite-types.
const transfer: NearKiteTransfer = {
  id: "7d0c3a52-2f1e-4b8a-9c61-0f3e2d1c4b5a",
  pay_in: "Native",
  amount_in: "1500000000000000000000000",
  settlement_token: { Token: "usdc.near" },
  settlement_recipient: "shop.near",
  min_amount_out: "4950000",
  fees: [
    {
      id: "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9",
      recipient: "kite.near",
      amount: "50000",
    },
  ],
  refund_account: "payer.near",
  expires_at: "1800000000",
  swap: {
    router: "dclv2.ref-labs.near",
    pool: { Dcl: "usdc.near|wrap.near|100" },
    wrap: "wrap.near",
  },
  implementation: "4reLvkAWfqk5fsqio1KLudk46cqRz9erQdaHkWZKMJDZ",
};

describe("kiteNear", () => {
  it("serializes the deposit state as kite-types does", () => {
    expect(toHex(kiteNear.serializeState("kite-factory.near", transfer))).toBe(
      "0x110000006b6974652d666163746f72792e6e6561722400000037643063336135322d326631652d346238612d396336312d30663365326431633462356100000080716433b629a33d0100000000000109000000757364632e6e6561720900000073686f702e6e656172f0874b00000000000000000000000000010000002400000031663265336434632d356236612d343937382d383639352d613462336332643165306639090000006b6974652e6e65617250c300000000000000000000000000000a00000070617965722e6e65617200d2496b00000000011300000064636c76322e7265662d6c6162732e6e6561720017000000757364632e6e6561727c777261702e6e6561727c31303009000000777261702e6e656172394abeb35e707609de8f73b63d43bd1a376ffe67935caa68937dd29bc04e673c01000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    );
  });

  it("predicts the account the factory derives", () => {
    expect(kiteNear.predictAddress("kite-factory.near", transfer)).toBe(
      "0s819fe7716a8986ce5ac59d6e34c6ea9ead979641",
    );
  });

  it("validates like the contract", () => {
    expect(kiteNear.validateTransferInput(transfer)).toBeNull();
    expect(
      kiteNear.validateTransferInput({ ...transfer, min_amount_out: "1" }),
    ).toMatch(/Fees amount exceed/);
    expect(kiteNear.validateTransferInput({ ...transfer, swap: null })).toMatch(
      /swap router/,
    );
    expect(
      kiteNear.validateTransferInput({
        ...transfer,
        settlement_token: { Token: "wrap.near" },
      }),
    ).toMatch(/Native and wrapped/);
  });

  it("lists the tokens to register", () => {
    expect(kiteNear.tokensToRegister(transfer)).toEqual([
      "usdc.near",
      "wrap.near",
    ]);
  });
});
