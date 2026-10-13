import { beforeEach, describe, expect, it } from "vitest";
import {
  createApp,
  createChain,
  createFee,
  address,
} from "../../test/factories";
import { FeeType } from "../../shared/constants";
import { FeeService } from "../Fee.service";

const service = new FeeService();

const ctx = (overrides: Record<string, unknown> = {}) => ({
  customer: { id: "c-1", traits: { plan: "pro", billing: { tier: "gold" } } },
  sourceAmount: 1_000_000n,
  sourceToken: { address: address(0xaaa) },
  targetToken: { address: address(0xbbb) },
  ...overrides,
});

describe("FeeService conditions", () => {
  it("matches an empty condition", () => {
    expect(service.matchesCondition({}, ctx() as never)).toBe(true);
  });

  it.each([
    [{ customer: { id: { _eq: "c-1" } } }, true],
    [{ customer: { id: { _eq: "c-2" } } }, false],
    [{ customer: { "traits.plan": { _in: ["pro", "team"] } } }, true],
    [{ customer: { "traits.plan": { _in: ["free"] } } }, false],
    [{ customer: { "traits.billing.tier": { _eq: "gold" } } }, true],
    [{ customer: { "traits.missing": { _eq: "x" } } }, false],
    [{ customer: { id: { _foo: "c-1" } } }, false],
  ])("customer condition %j -> %s", (condition, expected) => {
    expect(service.matchesCondition(condition, ctx() as never)).toBe(expected);
  });

  it("fails customer conditions when there is no customer", () => {
    expect(
      service.matchesCondition(
        { customer: { id: { _eq: "c-1" } } },
        ctx({ customer: null }) as never,
      ),
    ).toBe(false);
  });

  it.each([
    [{ sourceAmount: { _gte: "1000000" } }, true],
    [{ sourceAmount: { _gt: "1000000" } }, false],
    [{ sourceAmount: { _gt: "999999", _lt: "1000001" } }, true],
    [{ sourceAmount: { _eq: "1000000" } }, true],
    [{ sourceAmount: { _lte: "999999" } }, false],
    [{ sourceAmount: { _bad: "1" } }, false],
  ])("amount condition %j -> %s", (condition, expected) => {
    expect(service.matchesCondition(condition, ctx() as never)).toBe(expected);
  });

  it("matches currencies by contract address ignoring case", () => {
    const token = address(0xaaa);

    expect(
      service.matchesCondition(
        {
          sourceCurrency: {
            contractAddress: { _eq: token.toLowerCase() },
          },
        },
        ctx() as never,
      ),
    ).toBe(true);
    expect(
      service.matchesCondition(
        { sourceCurrency: { contractAddress: { _in: [address(1)] } } },
        ctx() as never,
      ),
    ).toBe(false);
    expect(
      service.matchesCondition(
        { targetCurrency: { contractAddress: { _eq: address(0xbbb) } } },
        ctx() as never,
      ),
    ).toBe(true);
    expect(
      service.matchesCondition(
        { sourceCurrency: { symbol: { _eq: "USDC" } } },
        ctx() as never,
      ),
    ).toBe(false);
  });

  it("requires every part of the condition to match", () => {
    expect(
      service.matchesCondition(
        {
          customer: { id: { _eq: "c-1" } },
          sourceAmount: { _gt: "5000000" },
        },
        ctx() as never,
      ),
    ).toBe(false);
  });
});

describe("FeeService amounts", () => {
  const base = {
    id: "x",
    appId: null,
    chainId: "c",
    label: "f",
    condition: {},
    feeAddress: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("returns a fixed fee as is", () => {
    expect(
      service.computeFeeAmount(
        {
          ...base,
          type: FeeType.Fixed,
          value: 250n,
          minAmountToCharge: null,
          maxAmountToCharge: null,
        },
        1_000_000n,
      ),
    ).toBe(250n);
  });

  it("charges variable fees in basis points, rounding up", () => {
    const fee = {
      ...base,
      type: FeeType.Variable,
      value: 30n,
      minAmountToCharge: null,
      maxAmountToCharge: null,
    };

    expect(service.computeFeeAmount(fee, 1_000_000n)).toBe(3000n);
    expect(service.computeFeeAmount(fee, 1_001n)).toBe(4n);
    expect(service.computeFeeAmount(fee, 0n)).toBe(0n);
  });

  it("clamps to the minimum and maximum", () => {
    const fee = {
      ...base,
      type: FeeType.Variable,
      value: 100n,
      minAmountToCharge: 5000n,
      maxAmountToCharge: 20000n,
    };

    expect(service.computeFeeAmount(fee, 100_000n)).toBe(5000n);
    expect(service.computeFeeAmount(fee, 1_000_000n)).toBe(10000n);
    expect(service.computeFeeAmount(fee, 100_000_000n)).toBe(20000n);
  });
});

describe("FeeService storage", () => {
  let appId: string;
  let otherAppId: string;
  let chainId: string;

  beforeEach(async () => {
    appId = (await createApp()).id;
    otherAppId = (await createApp()).id;
    chainId = (await createChain()).id;
  });

  it("shows an app its own fees and the system fees", async () => {
    const own = await createFee(chainId, { appId, label: "own" });
    const system = await createFee(chainId, { appId: null, label: "system" });
    await createFee(chainId, { appId: otherAppId, label: "other" });

    const visible = await service.getFees({ appId });
    expect(visible.data.map((f) => f.id).sort()).toEqual(
      [own.id, system.id].sort(),
    );
  });

  it("lists only system fees when no app is given", async () => {
    await createFee(chainId, { appId, label: "own" });
    const system = await createFee(chainId, { appId: null, label: "system" });

    const result = await service.getFees({ appId: null });
    expect(result.data.map((f) => f.id)).toEqual([system.id]);
  });

  it("filters by chain", async () => {
    const otherChain = await createChain("eip155:1");
    const a = await createFee(chainId, { appId });
    await createFee(otherChain.id, { appId });

    expect(
      (await service.getFees({ appId, chainId })).data.map((f) => f.id),
    ).toEqual([a.id]);
  });

  it("lets an app read a system fee but not change it", async () => {
    const system = await createFee(chainId, { appId: null });

    expect((await service.getFee(appId, system.id))?.id).toBe(system.id);
    expect(
      await service.updateFee(appId, system.id, { label: "hacked" }),
    ).toBeUndefined();
    expect(await service.deleteFee(appId, system.id)).toBeUndefined();
  });

  it("updates and deletes system fees when addressed as system", async () => {
    const system = await createFee(chainId, { appId: null });

    expect(
      (await service.updateFee(null, system.id, { label: "renamed" }))?.label,
    ).toBe("renamed");
    expect((await service.deleteFee(null, system.id))?.id).toBe(system.id);
  });

  it("does not touch another app's fee", async () => {
    const other = await createFee(chainId, { appId: otherAppId });

    expect(await service.getFee(appId, other.id)).toBeUndefined();
    expect(
      await service.updateFee(appId, other.id, { label: "x" }),
    ).toBeUndefined();
    expect(await service.deleteFee(appId, other.id)).toBeUndefined();
    expect(await service.getFee(otherAppId, other.id)).toBeDefined();
  });

  it("selects the fees that match the quote context", async () => {
    const always = await createFee(chainId, { appId, label: "always" });
    await createFee(chainId, {
      appId,
      label: "big",
      condition: { sourceAmount: { _gte: "5000000" } },
    });
    const system = await createFee(chainId, {
      appId: null,
      label: "system",
      condition: { sourceAmount: { _lt: "5000000" } },
    });

    const matching = await service.getMatchingFees(appId, chainId, {
      customer: null,
      sourceAmount: 1_000_000n,
      sourceToken: { address: address(1) },
      targetToken: { address: address(2) },
    } as never);

    expect(matching.map((f) => f.id).sort()).toEqual(
      [always.id, system.id].sort(),
    );
  });

  it("rejects a negative fee value and an inverted min/max", async () => {
    await expect(createFee(chainId, { value: -1n })).rejects.toThrow();
    await expect(
      createFee(chainId, { minAmountToCharge: 10n, maxAmountToCharge: 1n }),
    ).rejects.toThrow();
  });
});
