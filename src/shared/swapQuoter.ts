import { Uniswap } from "../sdks/Uniswap";
import { Rhea } from "../sdks/Rhea";
import { Soroswap } from "../sdks/Soroswap";
import { getChain } from "./chains";
import { ChainType } from "./constants";

export type SwapQuote = {
  amount: bigint;
  /** Uniswap V3 fee tier, or 0 for V2. EVM only. */
  feeTier: number | null;
  pool: string | null;
};

type ExactInput = {
  caip2Id: Caip2Id;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
};

type ExactOutput = {
  caip2Id: Caip2Id;
  tokenIn: string;
  tokenOut: string;
  amountOut: bigint;
};

export const swapQuoter = {
  quoteExactInput: async (input: ExactInput): Promise<SwapQuote | null> => {
    if (getChain(input.caip2Id).type === ChainType.Stellar) {
      const q = await new Soroswap().quoteExactInput(input);
      return q && { amount: q.amount, feeTier: null, pool: q.path.join(",") };
    }

    if (getChain(input.caip2Id).type === ChainType.Near) {
      const q = await new Rhea().quoteExactInput(input);
      return q && { amount: q.amount, feeTier: null, pool: q.pool };
    }

    const q = await new Uniswap().quoteExactInput(input);
    return q && { amount: q.amount, feeTier: q.feeTier, pool: null };
  },

  quoteExactOutput: async (input: ExactOutput): Promise<SwapQuote | null> => {
    if (getChain(input.caip2Id).type === ChainType.Stellar) {
      const q = await new Soroswap().quoteExactOutput(input);
      return q && { amount: q.amount, feeTier: null, pool: q.path.join(",") };
    }

    if (getChain(input.caip2Id).type === ChainType.Near) {
      const q = await new Rhea().quoteExactOutput(input);
      return q && { amount: q.amount, feeTier: null, pool: q.pool };
    }

    const q = await new Uniswap().quoteExactOutput(input);
    return q && { amount: q.amount, feeTier: q.feeTier, pool: null };
  },
};
