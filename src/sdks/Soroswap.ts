import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { getStellarChain } from "../shared/chains";
import { getStellarActor } from "../shared/onchainActor";
import { AppError } from "../shared/errors";

export type SoroswapQuote = {
  path: string[];
  amount: bigint;
};

export class Soroswap {
  router = (caip2Id: Caip2Id) => {
    const chain = getStellarChain(caip2Id);
    const router = chain.contracts.Soroswap?.router;
    if (!router) {
      throw new AppError(
        `${chain.name} has no Soroswap router, so it can't swap: pay in the settlement token`,
      );
    }
    return router;
  };

  /** The direct pair first, then through USDC or XLM. */
  paths = (caip2Id: Caip2Id, tokenIn: string, tokenOut: string) => {
    const { usdc, nativeToken } = getStellarChain(caip2Id).contracts;
    const hubs = [usdc, nativeToken].filter(
      (hub) => hub !== tokenIn && hub !== tokenOut,
    );
    return [
      [tokenIn, tokenOut],
      ...hubs.map((hub) => [tokenIn, hub, tokenOut]),
    ];
  };

  private quoteEach = async (
    caip2Id: Caip2Id,
    method: "router_get_amounts_out" | "router_get_amounts_in",
    tokenIn: string,
    tokenOut: string,
    amount: bigint,
  ) => {
    if (tokenIn === tokenOut) return [];

    const router = this.router(caip2Id);
    const quotes = await Promise.all(
      this.paths(caip2Id, tokenIn, tokenOut).map(async (path) => {
        const amounts = await getStellarActor()
          .view<bigint[]>(caip2Id, router, method, [
            nativeToScVal(amount, { type: "i128" }),
            xdr.ScVal.scvVec(
              path.map((token) => Address.fromString(token).toScVal()),
            ),
          ])
          .catch(() => null);

        const value =
          amounts &&
          BigInt(
            method === "router_get_amounts_out" ? amounts.at(-1)! : amounts[0],
          );
        return value && value > 0n ? { path, amount: value } : null;
      }),
    );

    return quotes.filter((q): q is SoroswapQuote => q !== null);
  };

  quoteExactInput = async (input: {
    caip2Id: Caip2Id;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
  }): Promise<SoroswapQuote | null> => {
    const quotes = await this.quoteEach(
      input.caip2Id,
      "router_get_amounts_out",
      input.tokenIn,
      input.tokenOut,
      input.amountIn,
    );

    return quotes.reduce<SoroswapQuote | null>(
      (best, q) => (!best || q.amount > best.amount ? q : best),
      null,
    );
  };

  quoteExactOutput = async (input: {
    caip2Id: Caip2Id;
    tokenIn: string;
    tokenOut: string;
    amountOut: bigint;
  }): Promise<SoroswapQuote | null> => {
    const quotes = await this.quoteEach(
      input.caip2Id,
      "router_get_amounts_in",
      input.tokenIn,
      input.tokenOut,
      input.amountOut,
    );

    return quotes.reduce<SoroswapQuote | null>(
      (best, q) => (!best || q.amount < best.amount ? q : best),
      null,
    );
  };
}
