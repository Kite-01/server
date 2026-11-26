import { describe, expect, it } from "vitest";
import { gnoTxFee, parseQeval } from "../GnoActor";

describe("GnoActor", () => {
  it("asks for the gas a simulation used and a fifth more, at the chain's price", () => {
    // a GnoSwap swap, as Onyx simulated it
    expect(
      gnoTxFee(124_434_514n, { amount: 1, denom: "ugnot", gas: 1000 }),
    ).toEqual({ gas_wanted: 149_331_416n, gas_fee: "149332ugnot" });
    expect(gnoTxFee(1_000n, { amount: 3, denom: "ugnot", gas: 2 })).toEqual({
      gas_wanted: 11_200n,
      gas_fee: "16800ugnot",
    });
  });

  it("pays 1 ugnot per 1,000 gas when the chain reports no price", () => {
    expect(gnoTxFee(1_000_000n, null)).toEqual({
      gas_wanted: 1_210_000n,
      gas_fee: "1210ugnot",
    });
  });

  it("reads vm/qeval's values", () => {
    expect(parseQeval('("Open" string)\n')).toBe("Open");
    expect(parseQeval("(true bool)")).toBe("true");
    expect(parseQeval("(6574529713 int64)")).toBe("6574529713");
  });
});
