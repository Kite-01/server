import {
  mainnet,
  optimism,
  bsc,
  polygon,
  robinhood,
  base,
  arbitrum,
} from "viem/chains";
import { ChainType } from "../constants";

type Chain = {
  caip2Id: Caip2Id;
  type: ChainType;
  chainId: number;
  name: string;
  publicRpcUrls: readonly string[];
  confirmations: number;
  blockExplorer: {
    name: string;
    url: string;
  };
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  descriptors: Record<string, unknown>;
  contracts: {
    /**
     * @see https://developers.uniswap.org/deployments
     */
    Uniswap: {
      SwapRouter02: string;
      QuoterV2: string;
    };
  };
};

export const Chains: Record<Caip2Id, Chain> = {
  "eip155:1": {
    caip2Id: "eip155:1",
    type: ChainType.Evm,
    chainId: mainnet.id,
    name: mainnet.name,
    publicRpcUrls: mainnet.rpcUrls.default.http,
    confirmations: 12,
    blockExplorer: {
      name: mainnet.blockExplorers.default.name,
      url: mainnet.blockExplorers.default.url,
    },
    nativeCurrency: mainnet.nativeCurrency,
    descriptors: {
      TrustWallet: "ethereum",
      Alchemy: "ETH_MAINNET",
      Moralis: "0x1",
      QuickNode: "eth-mainnet",
      Nodit: {
        protocol: "ethereum",
        network: "mainnet",
      },
    },
    contracts: {
      Uniswap: {
        SwapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
        QuoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
      },
    },
  },
  "eip155:10": {
    caip2Id: "eip155:10",
    type: ChainType.Evm,
    chainId: optimism.id,
    name: optimism.name,
    publicRpcUrls: optimism.rpcUrls.default.http,
    confirmations: 6,
    blockExplorer: {
      name: optimism.blockExplorers.default.name,
      url: optimism.blockExplorers.default.url,
    },
    nativeCurrency: optimism.nativeCurrency,
    descriptors: {
      TrustWallet: "optimism",
      Alchemy: "OPT_MAINNET",
      Moralis: "0xa",
      QuickNode: "optimism-mainnet",
      Nodit: {
        protocol: "optimism",
        network: "mainnet",
      },
    },
    contracts: {
      Uniswap: {
        SwapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
        QuoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
      },
    },
  },
  "eip155:56": {
    caip2Id: "eip155:56",
    type: ChainType.Evm,
    chainId: bsc.id,
    name: bsc.name,
    publicRpcUrls: bsc.rpcUrls.default.http,
    confirmations: 24,
    blockExplorer: {
      name: bsc.blockExplorers.default.name,
      url: bsc.blockExplorers.default.url,
    },
    nativeCurrency: bsc.nativeCurrency,
    descriptors: {
      TrustWallet: "binance",
      Alchemy: "BNB_MAINNET",
      Moralis: "0x38",
      QuickNode: "bsc-mainnet",
      Nodit: {
        protocol: "bsc",
        network: "mainnet",
      },
    },
    contracts: {
      Uniswap: {
        SwapRouter02: "0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2",
        QuoterV2: "0x78D78E420Da98ad378D7799bE8f4AF69033EB077",
      },
    },
  },
  "eip155:137": {
    caip2Id: "eip155:137",
    type: ChainType.Evm,
    chainId: polygon.id,
    name: polygon.name,
    publicRpcUrls: polygon.rpcUrls.default.http,
    confirmations: 32,
    blockExplorer: {
      name: polygon.blockExplorers.default.name,
      url: polygon.blockExplorers.default.url,
    },
    nativeCurrency: polygon.nativeCurrency,
    descriptors: {
      TrustWallet: "polygon",
      Alchemy: "MATIC_MAINNET",
      Moralis: "0x89",
      QuickNode: "polygon-mainnet",
      Nodit: {
        protocol: "polygon",
        network: "mainnet",
      },
    },
    contracts: {
      Uniswap: {
        SwapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
        QuoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
      },
    },
  },
  "eip155:4663": {
    caip2Id: "eip155:4663",
    type: ChainType.Evm,
    chainId: robinhood.id,
    name: robinhood.name,
    publicRpcUrls: robinhood.rpcUrls.default.http,
    confirmations: 12,
    blockExplorer: {
      name: robinhood.blockExplorers.default.name,
      url: robinhood.blockExplorers.default.url,
    },
    nativeCurrency: robinhood.nativeCurrency,
    descriptors: {
      TrustWallet: "robinhoodchain",
      Alchemy: "ROBINHOOD_MAINNET",
      QuickNode: "robinhood-mainnet",
    },
    contracts: {
      Uniswap: {
        SwapRouter02: "0xCaf681a66D020601342297493863E78C959E5cb2",
        QuoterV2: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
      },
    },
  },
  "eip155:8453": {
    caip2Id: "eip155:8453",
    type: ChainType.Evm,
    chainId: base.id,
    name: base.name,
    publicRpcUrls: base.rpcUrls.default.http,
    confirmations: 6,
    blockExplorer: {
      name: base.blockExplorers.default.name,
      url: base.blockExplorers.default.url,
    },
    nativeCurrency: base.nativeCurrency,
    descriptors: {
      TrustWallet: "base",
      Alchemy: "BASE_MAINNET",
      Moralis: "0x2105",
      QuickNode: "base-mainnet",
      Nodit: {
        protocol: "base",
        network: "mainnet",
      },
    },
    contracts: {
      Uniswap: {
        SwapRouter02: "0x2626664c2603336E57B271c5C0b26F421741e481",
        QuoterV2: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
      },
    },
  },
  "eip155:42161": {
    caip2Id: "eip155:42161",
    type: ChainType.Evm,
    chainId: arbitrum.id,
    name: arbitrum.name,
    publicRpcUrls: arbitrum.rpcUrls.default.http,
    confirmations: 6,
    blockExplorer: {
      name: arbitrum.blockExplorers.default.name,
      url: arbitrum.blockExplorers.default.url,
    },
    nativeCurrency: arbitrum.nativeCurrency,
    descriptors: {
      TrustWallet: "arbitrum",
      Alchemy: "ARB_MAINNET",
      Moralis: "0xa4b1",
      QuickNode: "arbitrum-mainnet",
      Nodit: {
        protocol: "arbitrum",
        network: "mainnet",
      },
    },
    contracts: {
      Uniswap: {
        SwapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
        QuoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
      },
    },
  },
};
