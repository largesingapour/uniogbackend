import Head from "next/head";
import Link from "next/link";

export default function Home() {
  return (
    <>
      <Head>
        <title>UNICHAIN Farm</title>
      </Head>
      <main style={{ padding: 40 }}>
        <h1>Welcome to UNICHAIN Farm</h1>
        <p><Link href="/create">Create a Farm</Link></p>
        <p><Link href="/explore">Explore Farms</Link></p>
      </main>
    </>
  );
}
