export interface UniswapQuoter {
  quoteExactInputSingle(
    input: UniswapQuoterExactInputArgs,
  ): Promise<bigint | null>;

  quoteExactOutputSingle(
    input: UniswapQuoterExactOutputArgs,
  ): Promise<bigint | null>;
}
