type UniswapQuoterExactInputArgs = {
  caip2Id: Caip2Id;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
};

type UniswapQuoterExactOutputArgs = {
  caip2Id: Caip2Id;
  tokenIn: string;
  tokenOut: string;
  amountOut: bigint;
};

/** The quoted amount and the fee tier of the pool it was priced from. */
type UniswapQuote = {
  feeTier: number;
  amount: bigint;
};
