import {
  mainnet,
  optimism,
  bsc,
  polygon,
  robinhood,
  base,
  arbitrum,
  type Chain,
} from "viem/chains";

export const Registry: Record<
  Caip2Namespace,
  Record<
    string,
    { ChainId: number; Info: Chain; Descriptors: Record<string, unknown> }
  >
> = {
  eip155: {
    "1": {
      ChainId: 1,
      Info: mainnet,
      Descriptors: {
        Alchemy: "ETH_MAINNET",
        Moralis: "0x1",
        Quicknode: "arbitrum-mainnet",
        Nodit: {
          protocol: "ethereum",
          network: "mainnet",
        },
      },
    },
    "10": {
      ChainId: 10,
      Info: optimism,
      Descriptors: {
        Alchemy: "OPT_MAINNET",
        Moralis: "0xa",
        Quicknode: "optimism-mainnet",
        Nodit: {
          protocol: "optimism",
          network: "mainnet",
        },
      },
    },
    "56": {
      ChainId: 56,
      Info: bsc,
      Descriptors: {
        Alchemy: "BNB_MAINNET",
        Moralis: "0x38",
        Quicknode: "bsc-mainnet",
        Nodit: {
          protocol: "bsc",
          network: "mainnet",
        },
      },
    },
    "137": {
      ChainId: 137,
      Info: polygon,
      Descriptors: {
        Alchemy: "MATIC_MAINNET",
        Moralis: "0x89",
        Quicknode: "polygon-mainnet",
        Nodit: {
          protocol: "polygon",
          network: "mainnet",
        },
      },
    },
    "4663": {
      ChainId: 4663,
      Info: robinhood,
      Descriptors: {
        Alchemy: "ROBINHOOD_MAINNET",
        Quicknode: "robinhood-mainnet",
      },
    },
    "8453": {
      ChainId: 8453,
      Info: base,
      Descriptors: {
        Alchemy: "BASE_MAINNET",
        Moralis: "0x2105",
        Quicknode: "base-mainnet",
        Nodit: {
          protocol: "base",
          network: "mainnet",
        },
      },
    },
    "42161": {
      ChainId: 42161,
      Info: arbitrum,
      Descriptors: {
        Alchemy: "ARB_MAINNET",
        Moralis: "0xa4b1",
        Quicknode: "arbitrum-mainnet",
        Nodit: {
          protocol: "arbitrum",
          network: "mainnet",
        },
      },
    },
  },
};
