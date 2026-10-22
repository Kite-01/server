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

type UniswapQuote = {
  feeTier: number;
  amount: bigint;
};
