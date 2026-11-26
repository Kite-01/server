import { describe, expect, it } from "vitest";
import { ChainAddress } from "../schema";
import { Value } from "@sinclair/typebox/value";

describe("ChainAddress", () => {
  it("accepts EVM, Gnome, NEAR and Stellar addresses", () => {
    for (const address of [
      "0x" + "1".repeat(40),
      "shop.near",
      "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6",
      "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      "MDFJHLAXAUMHA4OWPOB4P7YO72AQR2HMIUYFOXLXE2DZGM633K7HYAAAAAAETFQC2JNVQ",
      "g1ded7ay6fryetk2snl5y0f69fj2jy2h6s03hv2c",
    ]) {
      expect(Value.Check(ChainAddress, address)).toBe(true);
    }

    expect(Value.Check(ChainAddress, "stellar:testnet")).toBe(false);
  });
});
