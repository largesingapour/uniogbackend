import type { AppProps } from 'next/app';
import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Web3Provider, EnhancedWalletButton } from '../utils/WalletModal';

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <Web3Provider>
      <Head>
        <title>UNICHAIN Farm</title>
        <meta name="description" content="Deploy and Explore UNICHAIN Farms" />
      </Head>
      <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
        <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>
          <div>
            <Link href="/" style={{ marginRight: '15px', textDecoration: 'none', color: 'blue' }}>Home</Link>
            <Link href="/create" style={{ marginRight: '15px', textDecoration: 'none', color: 'blue' }}>Create Farm</Link>
            <Link href="/explore" style={{ textDecoration: 'none', color: 'blue' }}>Explore Farms</Link>
          </div>
          <div>
            <EnhancedWalletButton />
          </div>
        </nav>
        <Component {...pageProps} />
      </div>
    </Web3Provider>
  );
}

export default MyApp; 