// pages/farm/[address].tsx

import { useRouter } from 'next/router';
import React, { useEffect, useState, useCallback } from 'react';
import { ethers } from 'ethers';
import { useAccount, useWalletClient, usePublicClient, useChainId } from 'wagmi';
import { CURRENT_FARM_IMPLEMENTATION_ABI, ERC20_ABI } from '../../utils/web3';

// Interface for decoded farm data
interface DecodedFarmData {
  stakeTokenAddress: string;
  rewardTokenAddress: string;
  totalStaked: ethers.BigNumber;
  rewardRatePerSecond: ethers.BigNumber;
  lastUpdateTimestamp: ethers.BigNumber;
  isFunded: boolean;
  totalRewardAmount: ethers.BigNumber;
  endTimestamp: ethers.BigNumber;
  // Add derived/fetched info
  stakeTokenSymbol?: string;
  rewardTokenSymbol?: string;
  stakeTokenDecimals?: number;
  rewardTokenDecimals?: number;
  farmEndTime?: Date;
  farmStartTime?: Date; // Calculated from end and duration
  lockDurationSeconds?: ethers.BigNumber;
  boostMultiplier?: ethers.BigNumber;
}

// Interface for decoded user data
interface DecodedUserData {
    stakedAmount: ethers.BigNumber;
    rewardDebt: ethers.BigNumber;
    stakeTokenBalance: ethers.BigNumber;
    stakeTokenAllowance: ethers.BigNumber;
}

// Utility to fetch token info (handles missing name/symbol)
const getTokenInfo = async (address: string, provider: ethers.providers.Provider): Promise<{name: string, symbol: string, decimals: number | null }> => {
     if (!address || !ethers.utils.isAddress(address)) throw new Error(`Invalid token address provided to getTokenInfo: ${address}`);

    let name = `Unknown (${address.substring(0,6)}...)`;
    let symbol = 'TOKEN';
    let decimals: number | null = null;

    try {
        const contract = new ethers.Contract(address, ERC20_ABI, provider);
        // Fetch decimals first
        try {
            decimals = await contract.decimals();
        } catch (e) { console.warn(`Could not fetch decimals for ${address}`); }
        // Fetch name (optional)
        try {
            name = await contract.name();
        } catch (e) { console.warn(`Could not fetch name for ${address}`); }
        // Fetch symbol (optional)
        try {
            symbol = await contract.symbol();
        } catch (e) { console.warn(`Could not fetch symbol for ${address}`); }

        return { name, symbol, decimals };

    } catch (e) {
        console.error(`Failed to fetch token info for ${address}:`, e);
        // Return defaults even if contract instantiation failed?
        return { name, symbol, decimals };
    }
}

export default function FarmDetailsPage() {
    const router = useRouter();
    const { address } = router.query;
    // Ensure farmAddress is a valid address string or null
    const farmAddress = typeof address === 'string' && ethers.utils.isAddress(address) ? address : null;

    // Wagmi hooks for wallet connection
    const { address: connectedAddress, isConnected } = useAccount();
    const { data: walletClient } = useWalletClient();
    const publicClient = usePublicClient();
    const chainId = useChainId();
    const isCorrectNetwork = chainId === 130; // UNICHAIN Chain ID

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    const [farmData, setFarmData] = useState<DecodedFarmData | null>(null);
    const [userData, setUserData] = useState<DecodedUserData | null>(null);

    // Interaction State
    const [stakeAmount, setStakeAmount] = useState("");
    const [needsStakeApproval, setNeedsStakeApproval] = useState(false);
    const [isApprovingStake, setIsApprovingStake] = useState(false);
    const [isStaking, setIsStaking] = useState(false);
    const [isClaiming, setIsClaiming] = useState(false);
    const [approveTxHash, setApproveTxHash] = useState("");
    const [stakeTxHash, setStakeTxHash] = useState("");
    const [claimTxHash, setClaimTxHash] = useState("");

    // Add state for estimated claimable rewards
    const [estimatedClaimableRewards, setEstimatedClaimableRewards] = useState<ethers.BigNumber>(ethers.BigNumber.from(0));

    // Add state for unstake interactions
    const [unstakeAmount, setUnstakeAmount] = useState("");
    const [isUnstaking, setIsUnstaking] = useState(false);
    const [unstakeTxHash, setUnstakeTxHash] = useState("");
    const [currentLockEndTime, setCurrentLockEndTime] = useState<ethers.BigNumber | null>(null);
    const [isStakeLocked, setIsStakeLocked] = useState<boolean>(false);

    // Get ethers provider from window.ethereum
    const getProvider = useCallback(() => {
        if (typeof window !== 'undefined' && window.ethereum) {
            return new ethers.providers.Web3Provider(window.ethereum);
        }
        
        // Return the primary UNICHAIN RPC endpoint
        try {
            return new ethers.providers.JsonRpcProvider('https://rpc.unichain.network');
        } catch (e) {
            console.error("Error connecting to primary RPC:", e);
            // Try fallback providers
            try {
                return new ethers.providers.JsonRpcProvider('https://unichain-rpc.publicnode.com');
            } catch (e2) {
                console.error("Error connecting to first fallback RPC:", e2);
                // Try another fallback
                return new ethers.providers.JsonRpcProvider('https://unichain-mainnet.g.alchemy.com/v2/demo');
            }
        }
    }, []);

    // Function to safely call contract methods with retries
    const safeContractCall = async <T,>(
        contractMethod: () => Promise<T>,
        fallbackValue: T,
        retries = 2
    ): Promise<T> => {
        try {
            return await contractMethod();
        } catch (err) {
            console.error("Contract call failed:", err);
            if (retries > 0) {
                console.log(`Retrying... (${retries} attempts left)`);
                return safeContractCall(contractMethod, fallbackValue, retries - 1);
            }
            return fallbackValue;
        }
    };

    // --- Data Loading Function ---
    const loadData = useCallback(async () => {
        if (!farmAddress) {
            setError("Invalid or missing Farm Address in URL.");
            setIsLoading(false);
            return;
        }

        console.log(`Loading data for farm: ${farmAddress}, connected: ${isConnected}, address: ${connectedAddress}`);
        setIsLoading(true);
        setError(""); // Clear previous errors on reload

        try {
            const provider = getProvider();
            const farmContract = new ethers.Contract(farmAddress, CURRENT_FARM_IMPLEMENTATION_ABI, provider);

            // --- Fetch and Decode Farm Metadata ---
            console.log("Fetching farm metadata...");
            const metadataBytes = await safeContractCall(
                () => farmContract.getMetadata(),
                ethers.utils.hexlify(ethers.utils.toUtf8Bytes('{}')) // Empty fallback
            );
            
            if (!metadataBytes || metadataBytes === ethers.utils.hexlify(ethers.utils.toUtf8Bytes('{}'))) {
                throw new Error("Failed to fetch farm metadata after retries");
            }
            
            const metadataTypes = [
                'address', 'address', 'uint256', 'uint256', 'uint256',
                'bool', 'uint256', 'uint256'
            ];
            const decodedValues = ethers.utils.defaultAbiCoder.decode(metadataTypes, metadataBytes);
            console.log("Decoded metadata values:", decodedValues);

            // --- Fetch Token Info ---
            const stakeTokenAddr = decodedValues[0];
            const rewardTokenAddr = decodedValues[1];

            const [stakeTokenInfo, rewardTokenInfo] = await Promise.all([
                ethers.utils.isAddress(stakeTokenAddr) ? getTokenInfo(stakeTokenAddr, provider).catch(e => { console.error("Stake Token Info Error:", e); return null; }) : Promise.resolve(null),
                ethers.utils.isAddress(rewardTokenAddr) ? getTokenInfo(rewardTokenAddr, provider).catch(e => { console.error("Reward Token Info Error:", e); return null; }) : Promise.resolve(null)
            ]);

            // --- Calculate Start/End Dates ---
            let farmEndTime: Date | undefined;
            let farmStartTime: Date | undefined;
            let durationSeconds: number | undefined;
            try {
                if (typeof farmContract.duration === 'function') {
                    durationSeconds = (await farmContract.duration()).toNumber();
                }
                const endTimestampSeconds = decodedValues[7].toNumber();
                farmEndTime = new Date(endTimestampSeconds * 1000);
                if (durationSeconds && durationSeconds > 0) {
                    farmStartTime = new Date((endTimestampSeconds - durationSeconds) * 1000);
                }
            } catch (e) { console.error("Could not read farm duration/timestamps"); }

            const fetchedFarmData: DecodedFarmData = {
                stakeTokenAddress: stakeTokenAddr,
                rewardTokenAddress: rewardTokenAddr,
                totalStaked: decodedValues[2],
                rewardRatePerSecond: decodedValues[3],
                lastUpdateTimestamp: decodedValues[4],
                isFunded: decodedValues[5],
                totalRewardAmount: decodedValues[6],
                endTimestamp: decodedValues[7],
                stakeTokenSymbol: stakeTokenInfo?.symbol,
                rewardTokenSymbol: rewardTokenInfo?.symbol,
                stakeTokenDecimals: stakeTokenInfo?.decimals ?? undefined, // Use undefined if null
                rewardTokenDecimals: rewardTokenInfo?.decimals ?? undefined,
                farmEndTime: farmEndTime,
                farmStartTime: farmStartTime,
            };
            setFarmData(fetchedFarmData);

            // --- Fetch User Data (if connected and farm data loaded) ---
            if (isConnected && connectedAddress && fetchedFarmData.stakeTokenAddress && ethers.utils.isAddress(fetchedFarmData.stakeTokenAddress)) {
                 console.log(`Fetching user info for ${connectedAddress}...`);
                 const stakeTokenContract = new ethers.Contract(fetchedFarmData.stakeTokenAddress, ERC20_ABI, provider);
                 
                 // Call getUserStake instead of userInfo with safe handling
                 const userStakeResult = await safeContractCall(
                     () => farmContract.getUserStake(connectedAddress),
                     { amount: ethers.BigNumber.from(0), lockEndTime: ethers.BigNumber.from(0) }
                 );
                 
                 console.log("Result from getUserStake call:", userStakeResult);

                 // Get earned rewards with safe handling
                 const userRewardDebt = await safeContractCall(
                     () => farmContract.earned(connectedAddress),
                     ethers.BigNumber.from(0)
                 );
                 
                 // Extract values from getUserStake result
                 const userStaked = userStakeResult ? userStakeResult.amount : ethers.BigNumber.from(0);
                 const userLockEndTime = userStakeResult ? userStakeResult.lockEndTime : ethers.BigNumber.from(0);

                 // Fetch balance and allowance in parallel with safe handling
                 const [userBalance, currentAllowance] = await Promise.all([
                     safeContractCall(
                         () => stakeTokenContract.balanceOf(connectedAddress),
                         ethers.BigNumber.from(0)
                     ),
                     safeContractCall(
                         () => stakeTokenContract.allowance(connectedAddress, farmAddress),
                         ethers.BigNumber.from(0)
                     )
                 ]);
                 
                 const fetchedUserData: DecodedUserData = {
                    stakedAmount: userStaked,
                    rewardDebt: userRewardDebt,
                    stakeTokenBalance: userBalance,
                    stakeTokenAllowance: currentAllowance
                    // We could add lockEndTime here if needed for display
                 };
                 setUserData(fetchedUserData);
                 console.log("Fetched User Data:", fetchedUserData);
                 
                 // Check if approval is needed for the current stakeAmount input
                 if (stakeAmount && fetchedFarmData.stakeTokenDecimals && parseFloat(stakeAmount) > 0) {
                    try {
                        const stakeAmountWei = ethers.utils.parseUnits(stakeAmount, fetchedFarmData.stakeTokenDecimals);
                        setNeedsStakeApproval(currentAllowance.lt(stakeAmountWei));
                    } catch {
                        console.warn("Could not parse stake amount for allowance check");
                        setNeedsStakeApproval(true);
                    }
                 } else {
                     setNeedsStakeApproval(false);
                 }

                 // Set initial estimated rewards based on fetched data
                 const initialEstimate = calculateEstimatedRewards(
                    userStaked,
                    fetchedFarmData.rewardRatePerSecond,
                    fetchedFarmData.lastUpdateTimestamp,
                    fetchedFarmData.endTimestamp,
                    userRewardDebt
                 );
                 setEstimatedClaimableRewards(initialEstimate);

                 setCurrentLockEndTime(userLockEndTime); // Store lock end time in state
                 const nowSeconds = Math.floor(Date.now() / 1000);
                 setIsStakeLocked(userLockEndTime.gt(nowSeconds)); // Check if currently locked

            } else {
                 setUserData(null); // Clear user data if not connected or stake token invalid
                 setCurrentLockEndTime(null); // Clear lock info if not connected
                 setIsStakeLocked(false);
            }

        } catch (err: any) {
            console.error("Failed to load farm data:", err);
            setError(`Failed to load farm data: ${err.message || err}`);
            setFarmData(null);
            setUserData(null);
        } finally {
            setIsLoading(false);
        }
    }, [farmAddress, stakeAmount, isConnected, connectedAddress, getProvider]);

    // --- Load data on farm address change, wallet connection, and account change ---
    useEffect(() => {
        if (farmAddress) {
            loadData();
        }
    }, [farmAddress, loadData, connectedAddress, chainId]);

    // --- Approve, Stake, Claim, and Unstake functions ---
    const handleApproveStake = async () => {
        if (!farmData?.stakeTokenAddress || !farmAddress || !isConnected || !walletClient || !connectedAddress) {
            console.error("Cannot approve: Missing data or not connected");
            return;
        }
        if (!farmData.stakeTokenDecimals) {
            setError("Token decimals unknown, cannot calculate approve amount.");
            return;
        }

        setIsApprovingStake(true);
        setApproveTxHash("");
        setError("");

        try {
            // Parse amount to approve from input
            const amountToApprove = ethers.utils.parseUnits(stakeAmount, farmData.stakeTokenDecimals);
            const provider = getProvider();
            const signer = provider.getSigner(connectedAddress);
            const tokenContract = new ethers.Contract(farmData.stakeTokenAddress, ERC20_ABI, signer);
            
            console.log(`Approving ${amountToApprove.toString()} tokens for farm ${farmAddress}`);
            const tx = await tokenContract.approve(farmAddress, amountToApprove);
            setApproveTxHash(tx.hash);
            
            await tx.wait();
            console.log(`Approval successful: ${tx.hash}`);
            // Refresh user data to get updated allowance
            await loadData();
        } catch (err: any) {
            console.error("Approval failed:", err);
            setError(`Failed to approve tokens: ${err.message || err}`);
        } finally {
            setIsApprovingStake(false);
        }
    };

    const handleStake = async () => {
        if (!farmAddress || !farmData?.stakeTokenDecimals || !isConnected || !walletClient || !connectedAddress) {
            console.error("Cannot stake: Missing data or not connected");
            return;
        }

        setIsStaking(true);
        setStakeTxHash("");
        setError("");

        try {
            // Parse amount to stake from input
            const amountToStake = ethers.utils.parseUnits(stakeAmount, farmData.stakeTokenDecimals);
            const provider = getProvider();
            const signer = provider.getSigner(connectedAddress);
            const farmContract = new ethers.Contract(farmAddress, CURRENT_FARM_IMPLEMENTATION_ABI, signer);
            
            console.log(`Staking ${amountToStake.toString()} tokens in farm ${farmAddress}`);
            const tx = await farmContract.stake(amountToStake);
            setStakeTxHash(tx.hash);
            
            await tx.wait();
            console.log(`Stake successful: ${tx.hash}`);
            setStakeAmount(""); // Clear input
            // Refresh data to show updated stake
            await loadData();
        } catch (err: any) {
            console.error("Stake failed:", err);
            setError(`Failed to stake tokens: ${err.message || err}`);
        } finally {
            setIsStaking(false);
        }
    };

    const handleClaim = async () => {
        if (!farmAddress || !isConnected || !walletClient || !connectedAddress) {
            console.error("Cannot claim: Not connected");
            return;
        }

        setIsClaiming(true);
        setClaimTxHash("");
        setError("");

        try {
            const provider = getProvider();
            const signer = provider.getSigner(connectedAddress);
            const farmContract = new ethers.Contract(farmAddress, CURRENT_FARM_IMPLEMENTATION_ABI, signer);
            
            console.log(`Claiming rewards from farm ${farmAddress}`);
            const tx = await farmContract.claim();
            setClaimTxHash(tx.hash);
            
            await tx.wait();
            console.log(`Claim successful: ${tx.hash}`);
            // Refresh data to show updated rewards
            await loadData();
        } catch (err: any) {
            console.error("Claim failed:", err);
            setError(`Failed to claim rewards: ${err.message || err}`);
        } finally {
            setIsClaiming(false);
        }
    };

    const handleUnstake = async () => {
        if (!farmAddress || !farmData?.stakeTokenDecimals || !isConnected || !walletClient || !connectedAddress) {
            console.error("Cannot unstake: Missing data or not connected");
            return;
        }

        setIsUnstaking(true);
        setUnstakeTxHash("");
        setError("");

        try {
            // Parse amount to unstake from input
            const amountToUnstake = ethers.utils.parseUnits(unstakeAmount, farmData.stakeTokenDecimals);
            const provider = getProvider();
            const signer = provider.getSigner(connectedAddress);
            const farmContract = new ethers.Contract(farmAddress, CURRENT_FARM_IMPLEMENTATION_ABI, signer);
            
            console.log(`Unstaking ${amountToUnstake.toString()} tokens from farm ${farmAddress}`);
            
            // Check if still in lock period
            if (isStakeLocked) {
                console.warn("Warning: Attempting to unstake during lock period.");
                setError("Cannot unstake during lock period. Please wait until lock expires.");
                setIsUnstaking(false);
                return;
            }
            
            const tx = await farmContract.unstake(amountToUnstake);
            setUnstakeTxHash(tx.hash);
            
            await tx.wait();
            console.log(`Unstake successful: ${tx.hash}`);
            setUnstakeAmount(""); // Clear input
            // Refresh data to show updated stake
            await loadData();
        } catch (err: any) {
            console.error("Unstake failed:", err);
            setError(`Failed to unstake tokens: ${err.message || err}`);
        } finally {
            setIsUnstaking(false);
        }
    };

    // --- Effect for Live Reward Estimation ---
    useEffect(() => {
        if (!farmData || !userData) {
            // Don't run the timer if data isn't loaded
            setEstimatedClaimableRewards(ethers.BigNumber.from(0)); // Ensure reset
            return;
        }

        // Timer to update estimated rewards every second
        const intervalId = setInterval(() => {
            const newEstimate = calculateEstimatedRewards(
                userData.stakedAmount,
                farmData.rewardRatePerSecond,
                farmData.lastUpdateTimestamp,
                farmData.endTimestamp,
                userData.rewardDebt // Base rewards from chain
            );
            setEstimatedClaimableRewards(newEstimate);
        }, 1000); // Update every second

        // Cleanup function to clear the interval when the component unmounts or dependencies change
        return () => clearInterval(intervalId);

    // Dependencies: Re-run if the core data used for calculation changes
    }, [farmData, userData]);

    // --- Helper function for reward calculation ---
    const calculateEstimatedRewards = (
        userStaked: ethers.BigNumber | undefined,
        rewardRatePerSecond: ethers.BigNumber | undefined,
        lastUpdateTimestamp: ethers.BigNumber | undefined,
        endTimestamp: ethers.BigNumber | undefined,
        baseRewardDebt: ethers.BigNumber | undefined
    ): ethers.BigNumber => {
        if (!userStaked || !rewardRatePerSecond || !lastUpdateTimestamp || !endTimestamp || !baseRewardDebt || userStaked.isZero()) {
            return baseRewardDebt || ethers.BigNumber.from(0);
        }

        const nowSeconds = ethers.BigNumber.from(Math.floor(Date.now() / 1000));
        let effectiveLastUpdate = lastUpdateTimestamp;
        let effectiveCurrentTimestamp = nowSeconds;

        // Clamp timestamps to the farm's active period
        if (effectiveCurrentTimestamp.gt(endTimestamp)) {
            effectiveCurrentTimestamp = endTimestamp;
        }
        if (effectiveLastUpdate.gt(effectiveCurrentTimestamp)) {
            // This can happen if on-chain lastUpdate is slightly ahead due to block timing
            effectiveLastUpdate = effectiveCurrentTimestamp; 
        }
        if (effectiveLastUpdate.lt(farmData?.farmStartTime?.getTime() ? Math.floor(farmData.farmStartTime.getTime() / 1000) : 0)) {
             // Don't calculate rewards from before the farm technically started (based on endTimestamp - duration)
             effectiveLastUpdate = ethers.BigNumber.from(farmData?.farmStartTime?.getTime() ? Math.floor(farmData.farmStartTime.getTime() / 1000) : 0);
        }

        let accruedRewards = ethers.BigNumber.from(0);
        if (effectiveCurrentTimestamp.gt(effectiveLastUpdate)) {
            const timeElapsed = effectiveCurrentTimestamp.sub(effectiveLastUpdate);
            // Calculate accrued rewards: (userStaked * rewardRatePerSecond * timeElapsed) / 1e18
            // Use FixedPointMath or full precision multiplication if necessary
            try {
                 // Using BigNumber multiplication - watch out for potential overflow with huge numbers / rates
                 accruedRewards = userStaked
                     .mul(rewardRatePerSecond)
                     .mul(timeElapsed)
                     .div(ethers.constants.WeiPerEther); // Assuming rate has 1e18 precision baked in
            } catch (e) { console.error("Error calculating accrued rewards:", e); }
        }
        
        // Total estimated = rewards recorded on chain + newly accrued estimate
        return baseRewardDebt.add(accruedRewards);
    };

    // --- Calculate Token APY --- 
    const calculateTokenAPY = (): number | null => {
        // Need reward rate, total staked, and decimals for both tokens
        if (!farmData || !farmData.rewardRatePerSecond || !farmData.totalStaked || 
            farmData.stakeTokenDecimals === undefined || farmData.rewardTokenDecimals === undefined ||
            farmData.totalStaked.isZero()) { // Avoid division by zero
            return null; 
        }
        
        try {
            const secondsInYear = ethers.BigNumber.from(365 * 24 * 60 * 60);
            // Use a large precision factor to handle potential small rates accurately
            const precisionFactor = ethers.constants.WeiPerEther.mul(10**6); // e.g., 1e24

            // ratePerTokenPerSec = (rewardRatePerSecond * precisionFactor * 10**stakeDecimals) / (totalStaked * 10**rewardDecimals)
            // We multiply by stakeDecimals and divide by rewardDecimals later for clarity/precision
            
            // Rewards (in reward wei) per second per 1e18 stake wei
            const ratePerWeiStakedPerSec = farmData.rewardRatePerSecond.mul(precisionFactor).div(farmData.totalStaked);

            // Rewards (in reward wei) per year per 1e18 stake wei
            const rewardsPerWeiStakedPerYear = ratePerWeiStakedPerSec.mul(secondsInYear);
            
            // Now adjust for decimals to get: Reward Tokens per 1 Stake Token per Year
            const stakeDecimalsFactor = ethers.BigNumber.from(10).pow(farmData.stakeTokenDecimals);
            const rewardDecimalsFactor = ethers.BigNumber.from(10).pow(farmData.rewardTokenDecimals);

            // (rewardWei/year / stakeWei) * stakeDecFactor / rewardDecFactor = (rewardTokens/year / stakeTokens)
            // We divide by precisionFactor at the end
            const humanReadableRatePerYear = rewardsPerWeiStakedPerYear
                                                .mul(stakeDecimalsFactor)
                                                .div(rewardDecimalsFactor)
                                                .mul(100); // Multiply by 100 for percentage BEFORE dividing by precision
                                                
            // Divide by precision factor to get final APY %
            const apyBigNumber = humanReadableRatePerYear.div(precisionFactor);
            
            const apyNumber = parseFloat(ethers.utils.formatUnits(apyBigNumber, 0)); // formatUnits needs integer decimals
            
            return isFinite(apyNumber) ? apyNumber : null;

        } catch (e) {
            console.error("Error calculating Token APY:", e);
            return null;
        }
    };

    const tokenAPY = calculateTokenAPY();

    // --- Render Logic ---
    if (isLoading && !farmData) return (
      <div>
        <h1>Loading farm {farmAddress}</h1>
        <p>Connecting to the UNICHAIN network. This may take a moment...</p>
        <p><small>If this takes longer than expected, the RPC endpoint might be experiencing issues. Try refreshing the page.</small></p>
      </div>
    );
    
    if (error && !farmData) return (
      <div>
        <h1>Error loading farm</h1>
        <p style={{ color: 'red' }}>{error}</p>
        <div>
          <p>This could be due to one of the following reasons:</p>
          <ul>
            <li>The UNICHAIN network is experiencing connection issues</li>
            <li>The farm contract address is invalid or doesn't exist</li>
            <li>The farm contract doesn't implement the required interface</li>
          </ul>
          <button onClick={() => window.location.reload()}>Retry</button>
          {" | "}
          <a href="/explore">Return to Farm List</a>
        </div>
      </div>
    );

    const formatAmount = (amount: ethers.BigNumber | undefined, decimals: number | undefined, precision = 4): string => {
        const validDecimals = (typeof decimals === 'number' && !isNaN(decimals)) ? decimals : 18;
        if (amount === undefined) return 'N/A';
        try {
            const formatted = ethers.utils.formatUnits(amount, validDecimals);
            const num = parseFloat(formatted);
            return isNaN(num) ? 'Error' : num.toFixed(precision);
        } catch(e) {
            console.error("Error formatting amount:", e, { amount: amount?.toString(), decimals });
            return 'Error';
        }
    }

    let hasInsufficientBalance = false;
    if (userData && farmData?.stakeTokenDecimals && stakeAmount && !isNaN(parseFloat(stakeAmount)) && parseFloat(stakeAmount) > 0) {
        try {
            hasInsufficientBalance = ethers.utils.parseUnits(stakeAmount, farmData.stakeTokenDecimals).gt(userData.stakeTokenBalance);
        } catch {
            hasInsufficientBalance = true;
        }
    }

    const hasClaimableRewards = estimatedClaimableRewards && !estimatedClaimableRewards.isZero();

    return (
        <div>
            <h1>Farm Details: {farmAddress}</h1>
            {error && farmData && <p style={{ color: 'red' }}>Error: {error}</p>}

            <h2>Farm Info {isLoading && '(Updating...)'}</h2>
            {farmData ? (
                <ul>
                    <li>Stake Token: {farmData.stakeTokenSymbol || 'N/A'} ({farmData.stakeTokenAddress})</li>
                    <li>Reward Token: {farmData.rewardTokenSymbol || 'N/A'} ({farmData.rewardTokenAddress})</li>
                    <li>Status: {farmData.isFunded ? 'Active' : 'Not Funded'}</li>
                    <li>Total Staked: {formatAmount(farmData.totalStaked, farmData.stakeTokenDecimals)} {farmData.stakeTokenSymbol}</li>
                    <li>Total Rewards: {formatAmount(farmData.totalRewardAmount, farmData.rewardTokenDecimals)} {farmData.rewardTokenSymbol}</li>
                    <li>Reward Rate: {formatAmount(farmData.rewardRatePerSecond, farmData.rewardTokenDecimals, 8)} {farmData.rewardTokenSymbol}/sec</li>
                    <li>Est. Token APY: {tokenAPY !== null ? `${tokenAPY.toFixed(2)}%` : 'N/A'}</li>
                    <li>Starts: {farmData.farmStartTime?.toLocaleString() || 'N/A'}</li>
                    <li>Ends: {farmData.farmEndTime?.toLocaleString() || 'N/A'}</li>
                    <li>Last Update: {farmData.lastUpdateTimestamp ? new Date(farmData.lastUpdateTimestamp.toNumber() * 1000).toLocaleString() : 'N/A'}</li>
                    {farmData.lockDurationSeconds && farmData.lockDurationSeconds.gt(0) && (
                        <li><b>Lock Duration:</b> {farmData.lockDurationSeconds.toNumber()} seconds ({Math.round(farmData.lockDurationSeconds.toNumber() / 86400)} days)</li>
                    )}
                    {farmData.boostMultiplier && farmData.boostMultiplier.gt(100) && (
                        <li><b>Lock Boost:</b> {(farmData.boostMultiplier.toNumber() - 100)}%</li>
                    )}
                </ul>
            ) : (
                 <p>Farm data could not be loaded (or address is invalid).</p>
            )}

            <hr />

            {connectedAddress ? (
                <>
                     <h2>Your Stats {isLoading && '(Updating...)'}</h2>
                    {userData ? (
                         <ul>
                            <li>Your Staked: {formatAmount(userData.stakedAmount, farmData?.stakeTokenDecimals)} {farmData?.stakeTokenSymbol}</li>
                            <li>Claimable Rewards: {formatAmount(estimatedClaimableRewards, farmData?.rewardTokenDecimals, 8)} {farmData?.rewardTokenSymbol}</li>
                            <li>Your {farmData?.stakeTokenSymbol} Balance: {formatAmount(userData.stakeTokenBalance, farmData?.stakeTokenDecimals)}</li>
                            <li>Farm Allowance (for Staking): {formatAmount(userData.stakeTokenAllowance, farmData?.stakeTokenDecimals)} {farmData?.stakeTokenSymbol}</li>
                            {connectedAddress && currentLockEndTime && currentLockEndTime.gt(0) && (
                                <li>Your Lock Ends: {new Date(currentLockEndTime.toNumber() * 1000).toLocaleString()} {isStakeLocked ? '(Locked)' : '(Unlocked)'}</li>
                            )}
                        </ul>
                    ) : (
                        <p>Loading user data...</p>
                    )}

                    {/* Stake Section */}
                    <div style={{ marginTop: '20px', padding:'10px', border: '1px solid #ccc' }}>
                        <h3>Stake {farmData?.stakeTokenSymbol || 'Token'}</h3>
                        <div>
                            <input
                                type="number"
                                value={stakeAmount}
                                min="0"
                                step="any"
                                onChange={(e) => {
                                    const amount = e.target.value;
                                    if (amount === '' || (/^\d*\.?\d*$/.test(amount) && parseFloat(amount) >= 0)) {
                                        setStakeAmount(amount);
                                        // Check allowance dynamically as amount changes
                                        if (userData && farmData?.stakeTokenDecimals && amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0) {
                                            try {
                                                const requiredBn = ethers.utils.parseUnits(amount, farmData.stakeTokenDecimals);
                                                setNeedsStakeApproval(userData.stakeTokenAllowance.lt(requiredBn));
                                            } catch {
                                                setNeedsStakeApproval(true);
                                            }
                                        } else {
                                            setNeedsStakeApproval(false);
                                        }
                                    }
                                }}
                                placeholder={`Amount of ${farmData?.stakeTokenSymbol || 'tokens'}`}
                                disabled={isStaking || isApprovingStake || !farmData?.isFunded}
                                style={{ padding: '8px', marginRight: '10px' }}
                            />
                        </div>
                         {hasInsufficientBalance && <p style={{color: 'red', fontSize: '0.9em'}}>Insufficient balance</p>}
                        <div style={{ marginTop: '10px'}}>
                            {needsStakeApproval ? (
                                <button onClick={handleApproveStake} disabled={isApprovingStake || !stakeAmount || parseFloat(stakeAmount) <= 0 || hasInsufficientBalance || !farmData?.isFunded}>
                                    {isApprovingStake ? 'Approving...' : 'Approve'}
                                </button>
                            ) : (
                                <button onClick={handleStake} disabled={isStaking || !stakeAmount || parseFloat(stakeAmount) <= 0 || hasInsufficientBalance || !farmData?.isFunded}>
                                    {isStaking ? 'Staking...' : 'Stake'}
                                </button>
                            )}
                        </div>
                         {approveTxHash && <p style={{fontSize:'0.8em'}}>Approve Tx: {approveTxHash}</p>}
                         {stakeTxHash && <p style={{fontSize:'0.8em'}}>Stake Tx: {stakeTxHash}</p>}
                         {!farmData?.isFunded && <p style={{fontSize:'0.8em', color:'orange'}}>Farm not funded yet.</p>}
                    </div>

                     {/* Claim Section */}
                    <div style={{ marginTop: '20px' }}>
                        <h3>Claim {farmData?.rewardTokenSymbol || 'Reward'} Rewards</h3>
                         <button onClick={handleClaim} disabled={isClaiming || !hasClaimableRewards || !farmData?.isFunded}>
                            {isClaiming ? 'Claiming...' : 'Claim'}
                        </button>
                         {claimTxHash && <p style={{fontSize:'0.8em'}}>Claim Tx: {claimTxHash}</p>}
                    </div>

                    {/* Unstake Section */} 
                    <div style={{ marginTop: '20px', padding:'10px', border: '1px solid #aaa' }}>
                        <h3>Unstake {farmData?.stakeTokenSymbol || 'Token'}</h3>
                        {userData?.stakedAmount && userData.stakedAmount.gt(0) ? (
                             <> 
                                <div>
                                    <input 
                                        type="number"
                                        value={unstakeAmount}
                                        min="0"
                                        step="any"
                                        onChange={(e) => {
                                            const amount = e.target.value;
                                            if (amount === '' || (/^\d*\.?\d*$/.test(amount) && parseFloat(amount) >= 0)) {
                                                setUnstakeAmount(amount);
                                            }
                                        }}
                                        placeholder={`Amount (Max: ${formatAmount(userData.stakedAmount, farmData?.stakeTokenDecimals)})`}
                                        disabled={isUnstaking || isStakeLocked}
                                        style={{ padding: '8px', marginRight: '10px' }}
                                    />
                                </div>
                                <div style={{ marginTop: '10px'}}>
                                     <button onClick={handleUnstake} disabled={isUnstaking || !unstakeAmount || parseFloat(unstakeAmount) <= 0 || isStakeLocked}>
                                        {isUnstaking ? 'Unstaking...' : 'Unstake'}
                                     </button>
                                </div>
                                {isStakeLocked && currentLockEndTime && <p style={{fontSize:'0.8em', color:'orange'}}>Your stake is locked until {new Date(currentLockEndTime.toNumber() * 1000).toLocaleString()}.</p>}
                                {unstakeTxHash && <p style={{fontSize:'0.8em'}}>Unstake Tx: {unstakeTxHash}</p>}
                             </>
                         ) : (
                            <p>You have no tokens staked in this farm.</p>
                         )}
                    </div> 
                </>
            ) : (
                <p>Connect your wallet to interact with the farm.</p>
            )}
        </div>
    );
}