import {
  decodeFunctionResult,
  encodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { type UniswapQuoter } from "./interfaces/UniswapQuoter";
import { getOnchainActor } from "../shared/onchainActor";
import { getChain } from "../shared/chains";
import { common } from "../shared/common";

export class Uniswap implements UniswapQuoter {
  Abi = parseAbi([
    "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    "function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  ]);

  private getToken = (caip2Id: Caip2Id, tokenAddress: string) => {
    if (!common.isZeroAddress(tokenAddress)) return tokenAddress as Address;
    const chain = getChain(caip2Id);
    return chain.contracts.WETH9 as Address;
  };

  quoteExactInputSingle = async (
    input: UniswapQuoterExactInputArgs,
  ): Promise<bigint | null> => {
    const chain = getChain(input.caip2Id);
    const QuoterV2 = chain.contracts.Uniswap.QuoterV2;

    const calldata = encodeFunctionData({
      abi: this.Abi,
      functionName: "quoteExactInputSingle",
      args: [
        {
          tokenIn: this.getToken(input.caip2Id, input.tokenIn),
          tokenOut: this.getToken(input.caip2Id, input.tokenOut),
          amountIn: input.amountIn,
          fee: input.feeTier,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });

    const onchainActor = getOnchainActor(chain.type);
    const result = await onchainActor
      .ethCall(input.caip2Id, QuoterV2, calldata)
      .catch(() => null);

    if (!result || result === "0x") {
      return null;
    }

    const [amountOut] = decodeFunctionResult({
      abi: this.Abi,
      functionName: "quoteExactInputSingle",
      data: result as Hex,
    });

    return amountOut;
  };

  quoteExactOutputSingle = async (
    input: UniswapQuoterExactOutputArgs,
  ): Promise<bigint | null> => {
    const chain = getChain(input.caip2Id);
    const QuoterV2 = chain.contracts.Uniswap.QuoterV2;

    const calldata = encodeFunctionData({
      abi: this.Abi,
      functionName: "quoteExactOutputSingle",
      args: [
        {
          tokenIn: this.getToken(input.caip2Id, input.tokenIn),
          tokenOut: this.getToken(input.caip2Id, input.tokenOut),
          amount: input.amountOut,
          fee: input.feeTier,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });

    const onchainActor = getOnchainActor(chain.type);
    const result = await onchainActor
      .ethCall(input.caip2Id, QuoterV2, calldata)
      .catch(() => null);

    if (!result || result === "0x") return null;

    const [amountIn] = decodeFunctionResult({
      abi: this.Abi,
      functionName: "quoteExactOutputSingle",
      data: result as Hex,
    });

    return amountIn;
  };
}
