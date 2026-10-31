import {
  mainnet,
  optimism,
  bsc,
  polygon,
  robinhood,
  base,
  arbitrum,
  monad,
  sepolia,
  monadTestnet,
  baseSepolia,
  arbitrumSepolia,
  optimismSepolia,
  hardhat,
} from "viem/chains";
import { ChainType } from "../constants";
import { Address, zeroAddress } from "viem";

type Chain = {
  caip2Id: Caip2Id;
  type: ChainType;
  chainId: number;
  name: string;
  icon: string;
  testnet?: true;
  publicRpcUrls: readonly string[];
  confirmations: number;
  blockExplorer?: {
    name: string;
    url: string;
  };
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  descriptors?: Record<string, unknown>;
  contracts: {
    multicall3?: {
      address: Address;
      blockCreated?: number;
    };
    WETH9: string;
    /**
     * @see https://developers.uniswap.org/deployments
     */
    Uniswap?: {
      SwapRouter02?: string;
      UniswapV2Router02?: string;
    };
  };
};

const icon = (folder: string) => {
  return `https://cdn.jsdelivr.net/gh/trustwallet/assets@master/blockchains/${folder}/info/logo.png`;
};

export const Chains: Record<Caip2Id, Chain> = {
  "eip155:1": {
    caip2Id: "eip155:1",
    type: ChainType.Evm,
    chainId: mainnet.id,
    name: mainnet.name,
    icon: icon("ethereum"),
    publicRpcUrls: mainnet.rpcUrls.default.http,
    confirmations: 12,
    blockExplorer: {
      name: mainnet.blockExplorers.default.name,
      url: mainnet.blockExplorers.default.url,
    },
    nativeCurrency: mainnet.nativeCurrency,
    descriptors: {
      NearIntents: "eth",
      TrustWallet: "ethereum",
      Alchemy: "ETH_MAINNET",
      QuickNode: "ethereum-mainnet",
    },
    contracts: {
      multicall3: mainnet.contracts.multicall3,
      WETH9: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      Uniswap: {
        SwapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
        UniswapV2Router02: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
      },
    },
  },
  "eip155:10": {
    caip2Id: "eip155:10",
    type: ChainType.Evm,
    chainId: optimism.id,
    name: optimism.name,
    icon: icon("optimism"),
    publicRpcUrls: optimism.rpcUrls.default.http,
    confirmations: 6,
    blockExplorer: {
      name: optimism.blockExplorers.default.name,
      url: optimism.blockExplorers.default.url,
    },
    nativeCurrency: optimism.nativeCurrency,
    descriptors: {
      NearIntents: "op",
      TrustWallet: "optimism",
      Alchemy: "OPT_MAINNET",
      QuickNode: "optimism-mainnet",
    },
    contracts: {
      multicall3: optimism.contracts.multicall3,
      WETH9: "0x4200000000000000000000000000000000000006",
      Uniswap: {
        SwapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
        UniswapV2Router02: "0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2",
      },
    },
  },
  "eip155:56": {
    caip2Id: "eip155:56",
    type: ChainType.Evm,
    chainId: bsc.id,
    name: bsc.name,
    icon: icon("binance"),
    publicRpcUrls: bsc.rpcUrls.default.http,
    confirmations: 24,
    blockExplorer: {
      name: bsc.blockExplorers.default.name,
      url: bsc.blockExplorers.default.url,
    },
    nativeCurrency: bsc.nativeCurrency,
    descriptors: {
      NearIntents: "bsc",
      TrustWallet: "binance",
      Alchemy: "BNB_MAINNET",
      QuickNode: "bnbchain-mainnet",
    },
    contracts: {
      multicall3: bsc.contracts.multicall3,
      WETH9: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      Uniswap: {
        SwapRouter02: "0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2",
        UniswapV2Router02: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
      },
    },
  },
  "eip155:137": {
    caip2Id: "eip155:137",
    type: ChainType.Evm,
    chainId: polygon.id,
    name: polygon.name,
    icon: icon("polygon"),
    publicRpcUrls: polygon.rpcUrls.default.http,
    confirmations: 32,
    blockExplorer: {
      name: polygon.blockExplorers.default.name,
      url: polygon.blockExplorers.default.url,
    },
    nativeCurrency: polygon.nativeCurrency,
    descriptors: {
      NearIntents: "pol",
      TrustWallet: "polygon",
      Alchemy: "MATIC_MAINNET",
      QuickNode: "polygon-mainnet",
    },
    contracts: {
      multicall3: polygon.contracts.multicall3,
      WETH9: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
      Uniswap: {
        SwapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
        UniswapV2Router02: "0xedf6066a2b290C185783862C7F4776A2C8077AD1",
      },
    },
  },
  "eip155:4663": {
    caip2Id: "eip155:4663",
    type: ChainType.Evm,
    chainId: robinhood.id,
    name: robinhood.name,
    icon: icon("robinhoodchain"),
    publicRpcUrls: robinhood.rpcUrls.default.http,
    confirmations: 12,
    blockExplorer: {
      name: robinhood.blockExplorers.default.name,
      url: robinhood.blockExplorers.default.url,
    },
    nativeCurrency: robinhood.nativeCurrency,
    descriptors: {
      NearIntents: "hood",
      TrustWallet: "robinhoodchain",
      Alchemy: "ROBINHOOD_MAINNET",
      QuickNode: "robinhood-mainnet",
    },
    contracts: {
      multicall3: robinhood.contracts.multicall3,
      WETH9: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
      Uniswap: {
        SwapRouter02: "0xCaf681a66D020601342297493863E78C959E5cb2",
        UniswapV2Router02: "0x89e5DB8B5aA49aA85AC63f691524311AEB649eba",
      },
    },
  },
  "eip155:8453": {
    caip2Id: "eip155:8453",
    type: ChainType.Evm,
    chainId: base.id,
    name: base.name,
    icon: icon("base"),
    publicRpcUrls: base.rpcUrls.default.http,
    confirmations: 6,
    blockExplorer: {
      name: base.blockExplorers.default.name,
      url: base.blockExplorers.default.url,
    },
    nativeCurrency: base.nativeCurrency,
    descriptors: {
      NearIntents: "base",
      TrustWallet: "base",
      Alchemy: "BASE_MAINNET",
      QuickNode: "base-mainnet",
    },
    contracts: {
      multicall3: base.contracts.multicall3,
      WETH9: "0x4200000000000000000000000000000000000006",
      Uniswap: {
        SwapRouter02: "0x2626664c2603336E57B271c5C0b26F421741e481",
        UniswapV2Router02: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
      },
    },
  },
  "eip155:42161": {
    caip2Id: "eip155:42161",
    type: ChainType.Evm,
    chainId: arbitrum.id,
    name: arbitrum.name,
    icon: icon("arbitrum"),
    publicRpcUrls: arbitrum.rpcUrls.default.http,
    confirmations: 6,
    blockExplorer: {
      name: arbitrum.blockExplorers.default.name,
      url: arbitrum.blockExplorers.default.url,
    },
    nativeCurrency: arbitrum.nativeCurrency,
    descriptors: {
      NearIntents: "arb",
      TrustWallet: "arbitrum",
      Alchemy: "ARB_MAINNET",
      QuickNode: "arbitrum-mainnet",
    },
    contracts: {
      multicall3: arbitrum.contracts.multicall3,
      WETH9: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      Uniswap: {
        SwapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
        UniswapV2Router02: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
      },
    },
  },
  "eip155:143": {
    caip2Id: "eip155:143",
    type: ChainType.Evm,
    chainId: monad.id,
    name: monad.name,
    icon: icon("monad"),
    publicRpcUrls: monad.rpcUrls.default.http,
    confirmations: 12,
    blockExplorer: {
      name: monad.blockExplorers.default.name,
      url: monad.blockExplorers.default.url,
    },
    nativeCurrency: monad.nativeCurrency,
    descriptors: {
      NearIntents: "monad",
      TrustWallet: "monad",
      Alchemy: "MONAD_MAINNET",
      QuickNode: "monad-mainnet",
    },
    contracts: {
      multicall3: monad.contracts.multicall3,
      WETH9: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
      Uniswap: {
        SwapRouter02: "0xfE31F71C1b106EAc32F1A19239c9a9A72ddfb900",
        UniswapV2Router02: "0x4B2ab38DBF28D31D467aA8993f6c2585981D6804",
      },
    },
  },
  "eip155:11155111": {
    caip2Id: "eip155:11155111",
    type: ChainType.Evm,
    chainId: sepolia.id,
    name: sepolia.name,
    icon: icon("sepolia"),
    testnet: sepolia.testnet,
    publicRpcUrls: sepolia.rpcUrls.default.http,
    confirmations: 12,
    blockExplorer: {
      name: sepolia.blockExplorers.default.name,
      url: sepolia.blockExplorers.default.url,
    },
    nativeCurrency: sepolia.nativeCurrency,
    descriptors: {
      Alchemy: "ETH_SEPOLIA",
      QuickNode: "ethereum-sepolia",
    },
    contracts: {
      multicall3: sepolia.contracts.multicall3,
      WETH9: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
      Uniswap: {
        SwapRouter02: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
        UniswapV2Router02: "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3",
      },
    },
  },
  "eip155:10143": {
    caip2Id: "eip155:10143",
    type: ChainType.Evm,
    chainId: monadTestnet.id,
    name: monadTestnet.name,
    icon: icon("monad"),
    testnet: monadTestnet.testnet,
    publicRpcUrls: monadTestnet.rpcUrls.default.http,
    confirmations: 12,
    blockExplorer: {
      name: monadTestnet.blockExplorers.default.name,
      url: monadTestnet.blockExplorers.default.url,
    },
    nativeCurrency: monadTestnet.nativeCurrency,
    descriptors: {
      Alchemy: "MONAD_TESTNET",
      QuickNode: "monad-testnet",
    },
    contracts: {
      multicall3: monadTestnet.contracts.multicall3,
      /**
       * @see https://github.com/portdeveloper/puddleswap#contracts-monad-testnet
       */
      /** Puddleswap WMON address */
      WETH9: "0x97B3070F9Da6C002343862b35E68Bd8e22608943",
      Uniswap: {
        /** PuddleSwap uniswap router address */
        UniswapV2Router02: "0x430c23895c8D44883526e3E0B09327dAD8766660",
      },
    },
  },
  "eip155:84532": {
    caip2Id: "eip155:84532",
    type: ChainType.Evm,
    chainId: baseSepolia.id,
    name: baseSepolia.name,
    icon: icon("base"),
    testnet: baseSepolia.testnet,
    publicRpcUrls: baseSepolia.rpcUrls.default.http,
    confirmations: 12,
    blockExplorer: {
      name: baseSepolia.blockExplorers.default.name,
      url: baseSepolia.blockExplorers.default.url,
    },
    nativeCurrency: baseSepolia.nativeCurrency,
    descriptors: {
      Alchemy: "BASE_SEPOLIA",
      QuickNode: "base-sepolia",
    },
    contracts: {
      multicall3: baseSepolia.contracts.multicall3,
      WETH9: "0x4200000000000000000000000000000000000006",
      Uniswap: {
        SwapRouter02: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
      },
    },
  },
  "eip155:421614": {
    caip2Id: "eip155:421614",
    type: ChainType.Evm,
    chainId: arbitrumSepolia.id,
    name: arbitrumSepolia.name,
    icon: icon("arbitrum"),
    testnet: arbitrumSepolia.testnet,
    publicRpcUrls: arbitrumSepolia.rpcUrls.default.http,
    confirmations: 12,
    blockExplorer: {
      name: arbitrumSepolia.blockExplorers.default.name,
      url: arbitrumSepolia.blockExplorers.default.url,
    },
    nativeCurrency: arbitrumSepolia.nativeCurrency,
    descriptors: {
      Alchemy: "ARB_SEPOLIA",
      QuickNode: "arbitrum-sepolia",
    },
    contracts: {
      multicall3: arbitrumSepolia.contracts.multicall3,
      WETH9: "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73",
      Uniswap: {
        SwapRouter02: "0x101F443B4d1b059569D643917553c771E1b9663E",
      },
    },
  },
  "eip155:11155420": {
    caip2Id: "eip155:11155420",
    type: ChainType.Evm,
    chainId: optimismSepolia.id,
    name: optimismSepolia.name,
    icon: icon("optimism"),
    testnet: optimismSepolia.testnet,
    publicRpcUrls: optimismSepolia.rpcUrls.default.http,
    confirmations: 12,
    blockExplorer: {
      name: optimismSepolia.blockExplorers.default.name,
      url: optimismSepolia.blockExplorers.default.url,
    },
    nativeCurrency: optimismSepolia.nativeCurrency,
    descriptors: {
      Alchemy: "OPT_SEPOLIA",
      QuickNode: "optimism-sepolia",
    },
    contracts: {
      multicall3: optimismSepolia.contracts.multicall3,
      WETH9: "0x4200000000000000000000000000000000000006",
      Uniswap: {
        SwapRouter02: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
      },
    },
  },
  "eip155:31337": {
    caip2Id: "eip155:31337",
    type: ChainType.Evm,
    chainId: hardhat.id,
    name: hardhat.name,
    icon: icon("hardhat"),
    testnet: true,
    publicRpcUrls: hardhat.rpcUrls.default.http,
    confirmations: 6,
    nativeCurrency: hardhat.nativeCurrency,
    contracts: {
      WETH9: zeroAddress,
    },
  },
};
