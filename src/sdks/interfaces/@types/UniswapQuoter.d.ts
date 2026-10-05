type UniswapQuoterExactInputArgs = {
  caip2Id: Caip2Id;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  feeTier: number;
};

type UniswapQuoterExactOutputArgs = {
  caip2Id: Caip2Id;
  tokenIn: string;
  tokenOut: string;
  amountOut: bigint;
  feeTier: number;
};
