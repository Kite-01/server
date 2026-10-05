/**
 * A swapper obtains and executes swap routes for tokens the in-contract
 * Uniswap flow cannot cover. Provider output is untrusted: the implementation
 * must validate chains, tokens, amounts, recipient, approvals and slippage
 * before anything is signed.
 */
export interface Swapper {
  getQuote(
    input: SwapQuoteInput,
    options: SdkOptions,
  ): Promise<SwapQuote>;

  execute(
    quote: SwapQuote,
    options: SdkOptions,
  ): Promise<SwapExecution>;
}
