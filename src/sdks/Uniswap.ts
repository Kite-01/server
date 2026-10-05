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

export class Uniswap implements UniswapQuoter {
  Abi = parseAbi([
    "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    "function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  ]);

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
          tokenIn: input.tokenIn as Address,
          tokenOut: input.tokenOut as Address,
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
          tokenIn: input.tokenIn as Address,
          tokenOut: input.tokenOut as Address,
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
