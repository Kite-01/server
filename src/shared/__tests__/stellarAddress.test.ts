import { describe, expect, it } from "vitest";
import { isStellarAddress, stellarKeypair } from "../stellarAddress";

describe("stellarAddress", () => {
  it("derives keys on SEP-5 paths, as its test vectors do", () => {
    const mnemonic =
      "illness spike retreat truth genius clock brain pass fit cave bargain toe";

    expect(stellarKeypair(mnemonic, 0).publicKey()).toBe(
      "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6",
    );
    expect(stellarKeypair(mnemonic, 1).publicKey()).toBe(
      "GBAW5XGWORWVFE2XTJYDTLDHXTY2Q2MO73HYCGB3XMFMQ562Q2W2GJQX",
    );
  });

  it("accepts G…, C… and M… addresses", () => {
    expect(
      isStellarAddress(
        "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6",
      ),
    ).toBe(true);
    expect(
      isStellarAddress(
        "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      ),
    ).toBe(true);
    expect(
      isStellarAddress(
        "MDFJHLAXAUMHA4OWPOB4P7YO72AQR2HMIUYFOXLXE2DZGM633K7HYAAAAAAETFQC2JNVQ",
      ),
    ).toBe(true);
    expect(isStellarAddress("shop.near")).toBe(false);
    expect(isStellarAddress("0x" + "1".repeat(40))).toBe(false);
  });
});
