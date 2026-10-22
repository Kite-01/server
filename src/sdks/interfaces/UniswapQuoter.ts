export interface UniswapQuoter {
  quoteExactInput(
    input: UniswapQuoterExactInputArgs,
  ): Promise<UniswapQuote | null>;

  quoteExactOutput(
    input: UniswapQuoterExactOutputArgs,
  ): Promise<UniswapQuote | null>;
}
