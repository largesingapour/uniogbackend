import React from 'react';
import '@rainbow-me/rainbowkit/styles.css';
import {
  RainbowKitProvider,
  ConnectButton,
  getDefaultConfig,
  lightTheme,
  darkTheme
} from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { mainnet, base } from 'wagmi/chains';
import { http } from 'wagmi';

// Define UNICHAIN as a custom chain
const unichain = {
  id: 130,
  name: 'UNICHAIN',
  nativeCurrency: {
    decimals: 18,
    name: 'UNICHAIN',
    symbol: 'ETH',
  },
  rpcUrls: {
    public: { http: ['https://mainnet.unichain.org'] },
    default: { http: ['https://mainnet.unichain.org'] },
  },
  blockExplorers: {
    default: { name: 'UniScan', url: 'https://uniscan.xyz' },
  },
} as const;

// Create a config with the getDefaultConfig helper
const config = getDefaultConfig({
  appName: 'UNICHAIN Farm',
  projectId: '24d363deb599a3c2c46b3e09e7bad231',
  chains: [unichain, base, mainnet],
  transports: {
    [unichain.id]: http('https://mainnet.unichain.org'),
    [base.id]: http(),
    [mainnet.id]: http(),
  },
  ssr: true
});

// Create a query client for data fetching
const queryClient = new QueryClient();

// Web3Provider component wraps the application to provide wallet connection functionality
export const Web3Provider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={lightTheme({
            accentColor: '#3f51b5',
            accentColorForeground: 'white',
            borderRadius: 'medium'
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};

// Enhanced connect button with additional options
export const EnhancedWalletButton: React.FC = () => {
  return (
    <ConnectButton 
      showBalance={true}
      chainStatus="icon"
      accountStatus="address"
    />
  );
};

// Export default for easy importing
export default EnhancedWalletButton; 