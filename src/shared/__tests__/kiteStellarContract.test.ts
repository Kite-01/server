import { describe, expect, it } from "vitest";
import { Networks } from "@stellar/stellar-sdk";
import { kiteStellar, type StellarKiteTransfer } from "../kiteStellarContract";

// Provisional until Kite-01/stellar-contracts is deployed: the same transfers as
// `vector::fixed_vector` and `vector::fixed_vector_with_swap` in its contracts/types.
const FACTORY = "CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L";
const XLM = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

const transfer = (swap: boolean): StellarKiteTransfer =>
  kiteStellar.buildTransferInput({
    transferId: "7d0c3a52-2f1e-4b8a-9c61-0f3e2d1c4b5a",
    payInToken: swap ? XLM : USDC,
    amountIn: swap ? 71_000_000n : 50_000_000n,
    settlementToken: USDC,
    settlementRecipient:
      "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR",
    minAmountOut: 49_500_000n,
    fees: [
      {
        id: "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9",
        recipient: "GCATS5YOVB6ROX2WUNKGNQ2MP3GMXDMKSG2O4N5CLX3A6W4PZGZZI55U",
        amount: 500_000n,
      },
    ],
    refundAddress:
      "MDFJHLAXAUMHA4OWPOB4P7YO72AQR2HMIUYFOXLXE2DZGM633K7HYAAAAAAETFQC2JNVQ",
    expiresAt: new Date(1_800_000_000_000),
    swap: {
      router: "CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR",
      path: [XLM, USDC],
    },
    implementation: "05".repeat(32),
  });

describe("kiteStellar", () => {
  it("encodes a same-token transfer as the contracts' types crate does", () => {
    const t = transfer(false);
    expect(t.swap).toBeNull();
    expect(kiteStellar.toScVal(t).toXDR("hex")).toBe(
      "00000011000000010000000b0000000f00000009616d6f756e745f696e0000000000000a00000000000000000000000002faf0800000000f0000000a657870697265735f6174000000000005000000006b49d2000000000f00000004666565730000001000000001000000010000001100000001000000020000000f00000006616d6f756e7400000000000a0000000000000000000000000007a1200000000f00000009726563697069656e740000000000001200000000000000008139770ea87d175f56a35466c34c7ecccb8d8a91b4ee37a25df60f5b8fc9b3940000000f00000002696400000000000d00000020000000000000000000000000000000007d0c3a522f1e4b8a9c610f3e2d1c4b5a0000000f0000000e696d706c656d656e746174696f6e00000000000d0000002005050505050505050505050505050505050505050505050505050505050505050000000f0000000e6d696e5f616d6f756e745f6f757400000000000a00000000000000000000000002f34f600000000f000000067061795f696e000000000012000000015045cd5ec0729a768fd5ad02505852df4f028dce830e5ac52209ba48483b2f010000000f0000000e726566756e645f616464726573730000000000120000000200000000499602d2ca93ac1705187071d67b83c7ff0efe8108e8ec4530575d7726879333dbdabe7c0000000f00000014736574746c656d656e745f726563697069656e740000001200000000000000008a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000f00000010736574746c656d656e745f746f6b656e00000012000000015045cd5ec0729a768fd5ad02505852df4f028dce830e5ac52209ba48483b2f010000000f00000004737761700000001000000001000000010000000f000000044e6f6e65",
    );
    expect(kiteStellar.salt(t).toString("hex")).toBe(
      "6d02817ffb23cde9ee311c1efe3d7e68eadda9ac65b08b4f72717088e6629f3c",
    );
    expect(kiteStellar.predictAddress(FACTORY, t, Networks.TESTNET)).toBe(
      "CCH2IKWM62KA66HAGCE64F4ZZEL2L2BHKBU4FTHF3ET4AEY4KVURUGI3",
    );
  });

  it("encodes a transfer with a swap route", () => {
    const t = transfer(true);
    expect(t.swap).not.toBeNull();
    expect(kiteStellar.toScVal(t).toXDR("hex")).toBe(
      "00000011000000010000000b0000000f00000009616d6f756e745f696e0000000000000a000000000000000000000000043b5fc00000000f0000000a657870697265735f6174000000000005000000006b49d2000000000f00000004666565730000001000000001000000010000001100000001000000020000000f00000006616d6f756e7400000000000a0000000000000000000000000007a1200000000f00000009726563697069656e740000000000001200000000000000008139770ea87d175f56a35466c34c7ecccb8d8a91b4ee37a25df60f5b8fc9b3940000000f00000002696400000000000d00000020000000000000000000000000000000007d0c3a522f1e4b8a9c610f3e2d1c4b5a0000000f0000000e696d706c656d656e746174696f6e00000000000d0000002005050505050505050505050505050505050505050505050505050505050505050000000f0000000e6d696e5f616d6f756e745f6f757400000000000a00000000000000000000000002f34f600000000f000000067061795f696e00000000001200000001d7928b72c2703ccfeaf7eb9ff4ef4d504a55a8b979fc9b450ea2c842b4d1ce610000000f0000000e726566756e645f616464726573730000000000120000000200000000499602d2ca93ac1705187071d67b83c7ff0efe8108e8ec4530575d7726879333dbdabe7c0000000f00000014736574746c656d656e745f726563697069656e740000001200000000000000008a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c0000000f00000010736574746c656d656e745f746f6b656e00000012000000015045cd5ec0729a768fd5ad02505852df4f028dce830e5ac52209ba48483b2f010000000f00000004737761700000001000000001000000020000000f00000004536f6d650000001100000001000000020000000f00000004706174680000001000000001000000020000001200000001d7928b72c2703ccfeaf7eb9ff4ef4d504a55a8b979fc9b450ea2c842b4d1ce6100000012000000015045cd5ec0729a768fd5ad02505852df4f028dce830e5ac52209ba48483b2f010000000f00000006726f75746572000000000012000000010707070707070707070707070707070707070707070707070707070707070707",
    );
    expect(kiteStellar.salt(t).toString("hex")).toBe(
      "7727178af173fcd4b96ddfc5801b1bd00b4fff625a771c19c72dca69af37891b",
    );
    expect(kiteStellar.predictAddress(FACTORY, t, Networks.TESTNET)).toBe(
      "CDO3ALQIMRICAU2CBANNJRMKWXOT6X5L344EWGZLAEA74EBXS6PSFVFA",
    );
  });

  it("validates like the contract", () => {
    const t = transfer(true);
    expect(kiteStellar.validateTransferInput(t)).toBeNull();
    expect(
      kiteStellar.validateTransferInput({ ...t, min_amount_out: "1" }),
    ).toMatch(/Fees amount exceed/);
    expect(kiteStellar.validateTransferInput({ ...t, swap: null })).toMatch(
      /swap router/,
    );
    expect(
      kiteStellar.validateTransferInput({
        ...t,
        swap: { router: t.swap!.router, path: [USDC, XLM] },
      }),
    ).toMatch(/swap route is invalid/);
    expect(
      kiteStellar.validateTransferInput({ ...transfer(false), swap: t.swap }),
    ).toMatch(/has no swap/);
  });

  it("validates G, C and M recipients, and refuses M for a token that isn't a SAC", () => {
    const t = transfer(false);
    const recipients = {
      G: "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR",
      C: FACTORY,
      M: "MDFJHLAXAUMHA4OWPOB4P7YO72AQR2HMIUYFOXLXE2DZGM633K7HYAAAAAAETFQC2JNVQ",
    };

    for (const address of Object.values(recipients)) {
      expect(
        kiteStellar.validateTransferInput({
          ...t,
          settlement_recipient: address,
          refund_address: address,
        }),
      ).toBeNull();
    }

    expect(
      kiteStellar.validateTransferInput(
        { ...t, settlement_recipient: recipients.M },
        { payIn: true, settlement: false },
      ),
    ).toMatch(/muxed address/);
    expect(
      kiteStellar.validateTransferInput(t, { payIn: false, settlement: true }),
    ).toMatch(/muxed address/);
    expect(
      kiteStellar.validateTransferInput(
        { ...t, refund_address: recipients.G },
        { payIn: false, settlement: false },
      ),
    ).toBeNull();
    expect(
      kiteStellar.validateTransferInput({ ...t, refund_address: "shop.near" }),
    ).toMatch(/not a valid Stellar address/);
    expect(
      kiteStellar.validateTransferInput({
        ...t,
        settlement_recipient: recipients.G.slice(0, -1) + "A",
      }),
    ).toMatch(/not a valid Stellar address/);
  });

  it("carries a swap only when the tokens differ", () => {
    expect(transfer(false).swap).toBeNull();
    expect(transfer(true).swap).toEqual({
      router: "CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR",
      path: [XLM, USDC],
    });
  });
});
