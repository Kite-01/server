import { beforeEach, describe, expect, it, vi } from "vitest";
import { SdkRequestError } from "../../shared/errors";
import { NearIntents } from "../NearIntents";
import { KeyVars } from "../../shared/constants";
import { USDC } from "../../test/factories";

vi.unmock("../NearIntents");

const http = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  headers: [] as Record<string, string>[],
}));

vi.mock("../Http", () => ({
  Http: class {
    constructor(_baseURL: string, headers: Record<string, string>) {
      http.headers.push(headers);
    }
    get = http.get;
    post = http.post;
  },
}));

const BASE_USDC = `nep141:base-${USDC.toLowerCase()}.omft.near`;
const options = { variables: {} };

describe("NearIntents", () => {
  let client: NearIntents;

  beforeEach(() => {
    client = new NearIntents();
    http.get.mockReset();
    http.post.mockReset();
    http.headers.length = 0;
    http.get.mockResolvedValue({
      isOk: true,
      data: [
        {
          assetId: BASE_USDC,
          blockchain: "base",
          symbol: "USDC",
          decimals: 6,
          contractAddress: USDC.toLowerCase(),
        },
        {
          assetId: "nep141:usdc.near",
          blockchain: "near",
          symbol: "USDC",
          decimals: 6,
          contractAddress: "usdc.near",
        },
      ],
    });
  });

  it("finds a token's asset id on chains NEAR Intents covers", async () => {
    expect(await client.getAssetId("eip155:8453", USDC, options)).toBe(
      BASE_USDC,
    );
    expect(
      await client.getAssetId(
        "eip155:8453",
        "0x0000000000000000000000000000000000000bad",
        options,
      ),
    ).toBeNull();
    expect(
      await client.getAssetId("eip155:8453", `0x${"0".repeat(40)}`, options),
    ).toBeNull();

    expect(http.get).toHaveBeenCalledTimes(2);
    expect(http.get).toHaveBeenCalledWith("/tokens");
  });

  it("sends the API key when one is set", async () => {
    http.post.mockResolvedValue({
      isOk: true,
      data: { quote: { depositAddress: "0xdep" } },
    });

    await client.quote({ dry: true } as never, {
      variables: { [KeyVars.NearIntentsApiKey]: "intents-key" },
    });
    await client.quote({ dry: true } as never, options);

    expect(http.headers[0]["X-API-Key"]).toBe("intents-key");
    expect(http.headers[1]["X-API-Key"]).toBeUndefined();
    expect(http.post).toHaveBeenCalledWith("/quote", { dry: true });
  });

  it("passes on 1Click's reason when it refuses", async () => {
    http.post.mockResolvedValue({
      isOk: false,
      statusCode: 400,
      data: { message: "recipient is not valid" },
    });

    const error = await client
      .quote({ dry: true } as never, options)
      .catch((e) => e);

    expect(error).toBeInstanceOf(SdkRequestError);
    expect(error).toMatchObject({
      message: "recipient is not valid",
      statusCode: 400,
    });
  });

  it("asks for a payout's status by its deposit address", async () => {
    http.get.mockResolvedValue({ isOk: true, data: { status: "SUCCESS" } });

    expect(await client.getStatus("0xDep", options)).toEqual({
      status: "SUCCESS",
    });
    expect(http.get).toHaveBeenCalledWith("/status?depositAddress=0xDep");
  });
});
