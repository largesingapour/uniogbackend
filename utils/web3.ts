import { ethers } from "ethers";
import { useAccount, useWalletClient, usePublicClient, useChainId } from 'wagmi';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';

// Add type definition for window.ethereum
declare global {
    interface Window {
        ethereum?: any;
    }
}

// Updated with the address of the NEWEST deployed factory
export const FARM_FACTORY_ADDRESS = "0x5d07717D6bF7B1553F5223fb63770b07984B050b";

// Updated ABI for the FarmFactory using the provided full version
export const FARM_FACTORY_ABI = [
  {
    "inputs": [],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "FailedDeployment",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "balance",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "needed",
        "type": "uint256"
      }
    ],
    "name": "InsufficientBalance",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "farmType",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "farm",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "creator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "metadataURI",
        "type": "string"
      }
    ],
    "name": "FarmDeployed",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "farmType",
        "type": "bytes32"
      },
      {
        "internalType": "bytes",
        "name": "initData",
        "type": "bytes"
      },
      {
        "internalType": "string",
        "name": "metadataURI",
        "type": "string"
      }
    ],
    "name": "deployFarm",
    "outputs": [
      {
        "internalType": "address",
        "name": "farm",
        "type": "address"
      }
    ],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "deployedFarms",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "deploymentFee",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getAllDeployedFarms",
    "outputs": [
      {
        "internalType": "address[]",
        "name": "",
        "type": "address[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getFarmCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "offset",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "limit",
        "type": "uint256"
      }
    ],
    "name": "getDeployedFarms",
    "outputs": [
      {
        "internalType": "address[]",
        "name": "farms",
        "type": "address[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "name": "implementationForType",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "farmType",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "implementation",
        "type": "address"
      }
    ],
    "name": "registerFarmType",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "fee",
        "type": "uint256"
      }
    ],
    "name": "setDeploymentFee",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "transferOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "withdrawFees",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

// Basic ABI for ERC20 functions needed
export const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)"
];

// ABI for the current farm implementation 
export const CURRENT_FARM_IMPLEMENTATION_ABI = [
  "function initialize(bytes memory data) external",
  "function fund(uint256 _rewardAmount) external",
  "function stake(uint256 amount) external",
  "function unstake(uint256 amount) external",
  "function claim() external",
  "function getMetadata() external view returns (bytes memory)",
  "function getUserStake(address account) view returns (uint256 amount, uint256 lockEndTime)",
  "function earned(address account) view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function rewardRatePerSecond() view returns (uint256)",
  "function endTimestamp() view returns (uint256)",
  "function lastUpdateTimestamp() view returns (uint256)",
  "function isFunded() view returns (bool)",
  "function totalRewardAmount() view returns (uint256)",
  "function owner() view returns (address)",
  "function stakeToken() view returns (address)",
  "function rewardToken() view returns (address)",
  "function lockDurationSeconds() view returns (uint256)",
  "function boostMultiplier() view returns (uint256)"
];

// Simple check if window.ethereum exists
const hasEthereumProvider = (): boolean => {
  return typeof window !== 'undefined' && typeof window.ethereum !== 'undefined';
};

// Function to get the Ethers provider
export const getProvider = () => {
  // With the Wagmi hooks setup, we need to fallback to window.ethereum
  // Since hooks can only be used in components and not in utility functions
  if (!hasEthereumProvider()) {
    throw new Error("No Ethereum provider found. Install MetaMask or a similar wallet.");
  }
  return new ethers.providers.Web3Provider(window.ethereum);
};

// Function to get the Ethers signer
export const getSigner = async () => {
  // With the Wagmi hooks setup, we need to fallback to window.ethereum
  // Since hooks can only be used in components and not in utility functions
  if (!hasEthereumProvider()) {
    throw new Error("No Ethereum provider found. Install MetaMask or a similar wallet.");
  }
  
  const provider = getProvider();
  // Request account access if needed
  await provider.send("eth_requestAccounts", []); 
  return provider.getSigner();
};

// Function to get the connected account address
export const getAccount = async (): Promise<string | null> => {
  // With the Wagmi hooks setup, we need to fallback to window.ethereum
  // Since hooks can only be used in components and not in utility functions
  if (!hasEthereumProvider()) {
    return null;
  }
  
  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    return accounts && accounts.length > 0 ? accounts[0] : null;
  } catch (error) {
    console.error("Error fetching accounts:", error);
    return null;
  }
};

// Function to check if connected to the correct network (UNICHAIN)
export const checkNetwork = async (): Promise<boolean> => {
  // With the Wagmi hooks setup, we need to fallback to window.ethereum
  // Since hooks can only be used in components and not in utility functions
  if (!hasEthereumProvider()) {
    return false;
  }
  
  const provider = getProvider();
  const { chainId } = await provider.getNetwork();
  return chainId === 130; // UNICHAIN Chain ID
}; 