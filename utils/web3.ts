import { ethers } from "ethers";
import { useAccount, useWalletClient, usePublicClient, useChainId } from 'wagmi';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
// Import ABIs directly from the JSON files
import FARM_FACTORY_ABI_JSON from '../abi/FarmFactory.json';
import FIXED_APY_FARM_ABI from '../abi/FixedAPYFarm.json';

// Add type definition for window.ethereum
declare global {
    interface Window {
        ethereum?: any;
    }
}

// Updated with the address of the NEWEST deployed factory
export const FARM_FACTORY_ADDRESS = "0x5d07717D6bF7B1553F5223fb63770b07984B050b";

// Updated ABI for the FarmFactory using the imported ABI from the JSON file
export const FARM_FACTORY_ABI = FARM_FACTORY_ABI_JSON;

// Basic ABI for ERC20 functions needed
export const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)"
];

// Update to use the imported ABI from the JSON file for FixedAPYFarm
export const CURRENT_FARM_IMPLEMENTATION_ABI = FIXED_APY_FARM_ABI;

// For backward compatibility, also expose it under a more specific name
export const FIXED_APY_FARM_IMPLEMENTATION_ABI = FIXED_APY_FARM_ABI;

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

// Function to check if a farm type is registered in the factory
export const checkFarmTypeRegistered = async (farmType: string): Promise<boolean> => {
  try {
    const provider = getProvider();
    const factory = new ethers.Contract(FARM_FACTORY_ADDRESS, FARM_FACTORY_ABI, provider);
    const bytes32FarmType = ethers.utils.formatBytes32String(farmType);
    const implementationAddress = await factory.implementationForType(bytes32FarmType);
    
    // If the implementation address is not the zero address, the farm type is registered
    return implementationAddress !== ethers.constants.AddressZero;
  } catch (error) {
    console.error(`Error checking if farm type ${farmType} is registered:`, error);
    return false;
  }
}; 