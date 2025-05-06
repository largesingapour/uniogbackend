import { useEffect, useState, useCallback } from "react";
import React from 'react';
import { ethers } from "ethers";
import Link from 'next/link';
import { FARM_FACTORY_ADDRESS, FARM_FACTORY_ABI, CURRENT_FARM_IMPLEMENTATION_ABI, ERC20_ABI } from "../utils/web3";

// Define the structure for a Farm
interface DisplayField {
  name: string;
  value: string;
}

interface Farm {
  address: string;
  data: DisplayField[];
  stakeTokenSymbol?: string;
  rewardTokenSymbol?: string;
  isFunded?: boolean; 
}

// Define the structure for the schema (optional but good practice)
interface Field {
  name: string;
  type: string;
}

interface FarmSchema {
  type: string;
  initFields: Field[];
  metadataFields: Field[];
  // Add other fields from the schema if needed
}

// Utility to fetch token symbol
const getTokenSymbol = async (address: string, provider: ethers.providers.Provider): Promise<string> => {
    if (!address || !ethers.utils.isAddress(address)) return 'Invalid Address';
    try {
        const contract = new ethers.Contract(address, ERC20_ABI, provider);
        return await contract.symbol();
    } catch (e) {
        console.error(`Failed to fetch symbol for ${address}:`, e);
        return '?'; // Indicate error fetching symbol
    }
}

// Use the UNICHAIN RPC directly for read-only operations
const defaultProvider = new ethers.providers.JsonRpcProvider('https://rpc.unichain.network');
// Fallback providers if the main one fails
const fallbackProviders = [
  'https://unichain-rpc.publicnode.com',
  'https://unichain-mainnet.g.alchemy.com/v2/demo'
];

export default function ExploreFarms() {
  const [farms, setFarms] = useState<Farm[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentProvider, setCurrentProvider] = useState<ethers.providers.Provider>(defaultProvider);
  const [providerAttempts, setProviderAttempts] = useState(0);

  // Function to try fallback providers if the main one fails
  const tryNextProvider = useCallback(() => {
    if (providerAttempts < fallbackProviders.length) {
      console.log(`Trying fallback provider ${providerAttempts + 1}`);
      const nextProvider = new ethers.providers.JsonRpcProvider(fallbackProviders[providerAttempts]);
      setCurrentProvider(nextProvider);
      setProviderAttempts(prev => prev + 1);
      return true;
    }
    return false;
  }, [providerAttempts]);

  useEffect(() => {
    const loadFarms = async () => {
      setIsLoading(true);
      setError("");
      try {
        const factory = new ethers.Contract(FARM_FACTORY_ADDRESS, FARM_FACTORY_ABI, currentProvider);
        
        // First get the farm count
        const farmCount = await factory.getFarmCount().catch((err: any) => {
          console.error("Error getting farm count:", err);
          throw new Error("Could not get farm count");
        });
        
        console.log("Farm count:", farmCount.toString());
        
        // If we have farms, fetch them in batches to avoid timeout
        if (farmCount.gt(0)) {
          // Use a smaller limit to avoid timeout issues
          const batchSize = 10;
          const totalFarms = farmCount.toNumber();
          let allFarmAddresses: string[] = [];
          
          // Fetch farms in batches
          for (let offset = 0; offset < totalFarms; offset += batchSize) {
            const limit = Math.min(batchSize, totalFarms - offset);
            console.log(`Fetching farms from ${offset} to ${offset + limit}`);
            
            try {
              const farmBatch = await factory.getDeployedFarms(offset, limit);
              allFarmAddresses = [...allFarmAddresses, ...farmBatch];
            } catch (err) {
              console.error(`Error fetching batch at offset ${offset}:`, err);
              // Continue with what we have
            }
          }
          
          console.log("Fetched farm addresses:", allFarmAddresses);

          if (allFarmAddresses.length === 0) {
            setFarms([]);
            setIsLoading(false);
            return;
          }
          
          const farmDataPromises = allFarmAddresses.map(async (addr) => {
            try {
               const farmContract = new ethers.Contract(addr, CURRENT_FARM_IMPLEMENTATION_ABI, currentProvider);
               
               // Check if getMetadata function exists before calling it
               if (typeof farmContract.getMetadata !== 'function') {
                 console.error(`Farm at ${addr} doesn't have getMetadata function`);
                 return { 
                   address: addr, 
                   data: [{ name: "Error", value: "Farm contract doesn't support metadata retrieval" }] 
                 };
               }
               
               const metadataBytes = await farmContract.getMetadata();
               console.log(`Metadata bytes for ${addr}:`, metadataBytes);
               
               const metadataTypes = [
                  'address', 'address', 'uint256', 'uint256', 'uint256', 
                  'bool', 'uint256', 'uint256'
               ];
               const decodedValues = ethers.utils.defaultAbiCoder.decode(metadataTypes, metadataBytes);
               console.log(`Decoded values for ${addr}:`, decodedValues);

               // Fetch symbols in parallel
               const [stakeSymbol, rewardSymbol, stakeDecimals, rewardDecimals] = await Promise.all([
                   getTokenSymbol(decodedValues[0], currentProvider),
                   getTokenSymbol(decodedValues[1], currentProvider),
                   // Fetch decimals for formatting (can reuse ERC20_ABI)
                   new ethers.Contract(decodedValues[0], ERC20_ABI, currentProvider).decimals().catch(() => 18), // Default to 18 on error
                   new ethers.Contract(decodedValues[1], ERC20_ABI, currentProvider).decimals().catch(() => 18)  // Default to 18 on error
               ]);
               
               const displayData: DisplayField[] = [
                   { name: "Stake Token", value: `${stakeSymbol} (${decodedValues[0]})` },
                   { name: "Reward Token", value: `${rewardSymbol} (${decodedValues[1]})` },
                   { name: "Total Staked", value: ethers.utils.formatUnits(decodedValues[2], stakeDecimals) },
                   { name: "Reward Rate/Sec", value: ethers.utils.formatUnits(decodedValues[3], rewardDecimals) },
                   { name: "Last Update", value: new Date(decodedValues[4].toNumber() * 1000).toLocaleString() },
                   { name: "Is Funded", value: decodedValues[5].toString() },
                   { name: "Total Rewards", value: ethers.utils.formatUnits(decodedValues[6], rewardDecimals) },
                   { name: "End Time", value: new Date(decodedValues[7].toNumber() * 1000).toLocaleString() },
               ];
               
               return { 
                   address: addr, 
                   data: displayData, 
                   stakeTokenSymbol: stakeSymbol,
                   rewardTokenSymbol: rewardSymbol,
                   isFunded: decodedValues[5]
               }; 
            } catch (innerErr: any) {
              console.error(`Failed to load metadata for farm ${addr}:`, innerErr);
              return { address: addr, data: [{ name: "Error", value: `Could not load metadata: ${innerErr.message}`}] }; 
            }
          });

          const resolvedFarmData = (await Promise.all(farmDataPromises)).filter(f => f !== null) as Farm[];
          setFarms(resolvedFarmData);
        }
      } catch (err: any) {
        console.error("Failed to load farms:", err);
        
        // Try using a fallback provider
        if (tryNextProvider()) {
          console.log("Retrying with next provider");
          return; // Will trigger the effect again with the new provider
        }
        
        setError(err.message || "Failed to load farms.");
      } finally {
        setIsLoading(false);
      }
    };

    loadFarms();
  }, [currentProvider, tryNextProvider]);

  return (
    <div>
      <h1>Explore Farms</h1>
      {isLoading && (
        <div>
          <p>Loading farms... This may take a moment to connect to the UNICHAIN network.</p>
          {providerAttempts > 0 && (
            <p style={{ color: 'orange' }}>
              Connection issue detected. Trying alternate RPC endpoint ({providerAttempts}/{fallbackProviders.length})...
            </p>
          )}
        </div>
      )}
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}
      {!isLoading && !error && farms.length === 0 && (
        <div>
          <p>No farms found. This could be because:</p>
          <ul>
            <li>No farms have been created yet</li>
            <li>The connection to UNICHAIN network is experiencing issues</li>
          </ul>
          <p>Try refreshing the page in a few moments.</p>
        </div>
      )}
      {!isLoading && !error && farms.map((farm) => (
        <Link key={farm.address} href={`/farm/${farm.address}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{ border: "1px solid #eee", borderRadius: '8px', marginBottom: 15, padding: 15, cursor:'pointer' }}>
              <h3 style={{ marginTop: 0, marginBottom: 10 }}>Farm: {farm.address}</h3>
              {farm.data.map((d) => (
                <div key={d.name} style={{ marginBottom: '5px', overflowWrap: 'break-word' }}>
                  <strong style={{ textTransform: 'capitalize' }}>{d.name}</strong>: {d.value}
                </div>
              ))}
            </div>
        </Link>
      ))}
    </div>
  );
}
