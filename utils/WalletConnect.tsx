import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { getAccount, checkNetwork, getSigner } from './web3';

// A simple wallet connect component that supports MetaMask and can switch to UNICHAIN
const WalletConnect: React.FC = () => {
  const [address, setAddress] = useState<string | null>(null);
  const [chainIsValid, setChainIsValid] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);

  const updateConnectionStatus = async () => {
    try {
      const currentAccount = await getAccount();
      setAddress(currentAccount);
      
      if (currentAccount) {
        const isCorrectChain = await checkNetwork();
        setChainIsValid(isCorrectChain);
      }
    } catch (error) {
      console.error("Error updating connection status:", error);
    }
  };

  // Check connection on component mount
  useEffect(() => {
    updateConnectionStatus();
    
    // Set up event listeners for account and chain changes
    if (typeof window !== 'undefined' && window.ethereum) {
      // Use any type to avoid TypeScript errors with ethereum object
      const ethereum = window.ethereum as any;
      
      ethereum.on('accountsChanged', updateConnectionStatus);
      ethereum.on('chainChanged', updateConnectionStatus);
      
      // Cleanup on component unmount
      return () => {
        ethereum.removeListener('accountsChanged', updateConnectionStatus);
        ethereum.removeListener('chainChanged', updateConnectionStatus);
      };
    }
  }, []);

  const connectWallet = async () => {
    try {
      setIsConnecting(true);
      // This will trigger wallet connection
      await getSigner();
      await updateConnectionStatus();
    } catch (error) {
      console.error("Failed to connect wallet:", error);
    } finally {
      setIsConnecting(false);
    }
  };

  const switchToUnichain = async () => {
    try {
      if (typeof window !== 'undefined' && window.ethereum) {
        // Use any type to avoid TypeScript errors with ethereum object
        const ethereum = window.ethereum as any;
        
        await ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x82' }], // 130 in hex
        });
      }
    } catch (error: any) {
      // If chain doesn't exist, try to add it
      if (error.code === 4902) {
        try {
          const ethereum = window.ethereum as any;
          
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: '0x82', // 130 in hex
                chainName: 'UNICHAIN',
                nativeCurrency: {
                  name: 'UNICHAIN',
                  symbol: 'UNI',
                  decimals: 18,
                },
                rpcUrls: ['https://rpc.unichain.network'],
                blockExplorerUrls: ['https://scan.unichain.network'],
              },
            ],
          });
        } catch (addError) {
          console.error("Failed to add UNICHAIN network:", addError);
        }
      } else {
        console.error("Failed to switch network:", error);
      }
    }
  };

  // Render a connect button, switch network button, or connected address
  if (!address) {
    return (
      <button 
        onClick={connectWallet} 
        disabled={isConnecting}
        style={{
          backgroundColor: '#3f51b5',
          color: 'white',
          padding: '8px 16px',
          borderRadius: '4px',
          border: 'none',
          cursor: isConnecting ? 'default' : 'pointer',
          fontWeight: 'bold'
        }}
      >
        {isConnecting ? 'Connecting...' : 'Connect Wallet'}
      </button>
    );
  }

  if (!chainIsValid) {
    return (
      <button 
        onClick={switchToUnichain}
        style={{
          backgroundColor: 'orange',
          color: 'white',
          padding: '8px 16px',
          borderRadius: '4px',
          border: 'none',
          cursor: 'pointer',
          fontWeight: 'bold'
        }}
      >
        Switch to UNICHAIN
      </button>
    );
  }

  return (
    <div style={{ fontWeight: 'bold', color: '#4caf50' }}>
      Connected: {address.substring(0, 6)}...{address.substring(address.length - 4)}
    </div>
  );
};

export default WalletConnect; 