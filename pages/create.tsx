import React, { useEffect, useState, useCallback } from 'react';
import { ethers } from 'ethers';
import { 
    FARM_FACTORY_ADDRESS, 
    FARM_FACTORY_ABI, 
    CURRENT_FARM_IMPLEMENTATION_ABI, // Use the new name
    ERC20_ABI, 
    getSigner, 
    getAccount, 
    checkNetwork, 
    getProvider 
} from '../utils/web3';

// --- Statically import only the relevant schema --- 
import schema_v2 from '../metadata/farmTypes/EnhancedFixedAPYFarm_v1.json';

// Interface for the loaded schema structure
interface FarmSchema {
  type: string;
  implementationAddress?: string; // Optional for now, add later
  initFields: { name: string; type: string; placeholder?: string; label?: string }[]; // Allow custom labels/placeholders
  metadataFields?: { name: string; type: string; }[];
  actions?: Record<string, { inputs?: { name: string; type: string; }[]; method: string; }>;
  tags?: string[];
  // Add other potential schema fields if needed later
}

// Correctly define the type for a single field from the initFields array
interface SchemaField { 
  name: string; 
  type: string; 
  placeholder?: string; 
  label?: string; 
}

// Define steps in the creation process
type CreationStep = 
    | 'idle' 
    | 'deploying' 
    | 'waiting_deployment' 
    | 'needs_farm_approval' 
    | 'approving_farm' 
    | 'waiting_approval'
    | 'needs_funding' 
    | 'funding' 
    | 'waiting_funding'
    | 'completed' 
    | 'failed';

export default function CreateFarm() {
    const [loadedSchema, setLoadedSchema] = useState<FarmSchema | null>(null);

    // Form & Connection State
    const [formData, setFormData] = useState<Record<string, any>>({});
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [isWrongNetwork, setIsWrongNetwork] = useState<boolean>(false);
    const [signerAddress, setSignerAddress] = useState<string | null>(null);
    const [rewardTokenDecimals, setRewardTokenDecimals] = useState<number | null>(null);
    const [isFetchingDecimals, setIsFetchingDecimals] = useState<boolean>(false);
  
    // Creation Process State
    const [currentStep, setCurrentStep] = useState<CreationStep>('idle');
    const [deployedFarmAddress, setDeployedFarmAddress] = useState<string | null>(null);
    const [requiredAmountWei, setRequiredAmountWei] = useState<ethers.BigNumber | null>(null);
    const [currentFarmAllowance, setCurrentFarmAllowance] = useState<ethers.BigNumber | null>(null);
    const [error, setError] = useState<string>("");
  
    // Transaction Hashes
    const [deployTxHash, setDeployTxHash] = useState<string>("");
    const [approveTxHash, setApproveTxHash] = useState<string>("");
    const [fundTxHash, setFundTxHash] = useState<string>("");

    // Add state for the end date input
    const [endDateString, setEndDateString] = useState<string>("");

    // Add stakeAmount if needed later for interaction?
    const [stakeAmount, setStakeAmount] = useState("");

    // Add stakeTokenInfo and rewardTokenInfo for token info
    const [stakeTokenInfo, setStakeTokenInfo] = useState<{ name: string, symbol: string } | null>(null);
    const [rewardTokenInfo, setRewardTokenInfo] = useState<{ name: string, symbol: string } | null>(null);
    const [isFetchingStakeInfo, setIsFetchingStakeInfo] = useState<boolean>(false);
    const [isFetchingRewardInfo, setIsFetchingRewardInfo] = useState<boolean>(false);

    // Function to reset form state when type changes
    const resetFormState = () => {
        setFormData({});
        setEndDateString("");
        setStakeTokenInfo(null);
        setRewardTokenInfo(null);
        setRewardTokenDecimals(null);
        setCurrentStep('idle');
        setDeployedFarmAddress(null);
        setRequiredAmountWei(null);
        setCurrentFarmAllowance(null);
        setError("");
        setDeployTxHash("");
        setApproveTxHash("");
        setFundTxHash("");
        setIsFetchingStakeInfo(false);
        setIsFetchingRewardInfo(false);
    }

    // Effect to set schema when selection changes (simplified)
    useEffect(() => {
        // Directly load the enhanced schema
        console.log("Loading EnhancedFixedAPYFarm_v1 schema...");
        try {
            // Cast the imported JSON directly
            const schemaData = schema_v2 as FarmSchema;
             if (!schemaData || !schemaData.type || !Array.isArray(schemaData.initFields)) {
                 throw new Error(`Invalid schema structure in EnhancedFixedAPYFarm_v1.json`);
            }
            // TODO: Check implementationAddress exists in schema?
            setLoadedSchema(schemaData);
            console.log(`Loaded schema with type: ${schemaData.type}`);
            setError("");
        } catch (err: any) {
            console.error(`Failed to load schema:`, err);
            setError(`Failed to load schema. Error: ${err.message}`);
            setLoadedSchema(null);
        }
    }, []); // Load only once on mount

    // Combined check function
    const checkConnectionAndAllowance = async () => {
        setError(""); // Clear errors on check
        try {
            const account = await getAccount();
            setSignerAddress(account);
            if (account) {
                setIsConnected(true);
                const onCorrectNetwork = await checkNetwork();
                setIsWrongNetwork(!onCorrectNetwork);
                // Only check allowance if connected to the right network and required fields are present
                if (onCorrectNetwork && formData['rewardToken'] && formData['rewardAmount'] && rewardTokenDecimals !== null) {
                    await checkAllowance();
                }
            } else {
                setIsConnected(false);
                setIsWrongNetwork(false);
                setCurrentStep('idle'); // Reset process if disconnected
                setCurrentFarmAllowance(null);
            }
        } catch (err) {
            console.error("Error checking connection/allowance:", err);
            setIsConnected(false);
            setIsWrongNetwork(false);
            setSignerAddress(null);
            setCurrentStep('idle');
            setCurrentFarmAllowance(null);
        }
    };

    useEffect(() => {
        checkConnectionAndAllowance();

        const provider = window.ethereum as any;
        if (provider) {
            provider.on('accountsChanged', checkConnectionAndAllowance);
            provider.on('chainChanged', checkConnectionAndAllowance);
        }
        return () => {
            if (provider) {
                provider.removeListener('accountsChanged', checkConnectionAndAllowance);
                provider.removeListener('chainChanged', checkConnectionAndAllowance);
            }
        };

    }, []); // Run once on mount

    // Fetch reward token decimals
    useEffect(() => {
        const fetchDecimals = async () => {
            const rewardTokenAddress = formData['rewardToken'];
            if (rewardTokenAddress && ethers.utils.isAddress(rewardTokenAddress)) {
                setIsFetchingDecimals(true);
                setRewardTokenDecimals(null);
                setError("");
                try {
                    const provider = getProvider(); 
                    const tokenContract = new ethers.Contract(rewardTokenAddress, ERC20_ABI, provider);
                    const decimals = await tokenContract.decimals();
                    setRewardTokenDecimals(decimals);
                    console.log(`Fetched decimals for ${rewardTokenAddress}: ${decimals}`);
                } catch (err) {
                    console.error("Failed to fetch decimals:", err);
                    setError("Failed to fetch decimals for the reward token address.");
                    setRewardTokenDecimals(null);
                } finally {
                    setIsFetchingDecimals(false);
                }
            } else {
                setRewardTokenDecimals(null);
            }
        };
        fetchDecimals();
    }, [formData['rewardToken']]); // Re-run when these change

    // Fetch stake token info
    const fetchTokenInfo = async (
        tokenAddress: string, 
        setInfo: React.Dispatch<React.SetStateAction<{ name: string, symbol: string } | null>>,
        setIsLoading: React.Dispatch<React.SetStateAction<boolean>>,
        tokenType: string 
    ) => {
        if (tokenAddress && ethers.utils.isAddress(tokenAddress)) {
            setIsLoading(true);
            setInfo(null); 
            let fetchedName = `Unknown (${tokenAddress.substring(0,6)}...)`; // Default name
            let fetchedSymbol = `TOKEN`; // Default symbol
            let fetchedDecimals: number | null = null;
            try {
                const provider = getProvider(); 
                const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
                
                // Fetch decimals first (usually reliable)
                try {
                    fetchedDecimals = await tokenContract.decimals();
                } catch (decErr) {
                    console.warn(`Could not fetch decimals for ${tokenType} token ${tokenAddress}:`, decErr);
                    // Set decimals only for reward token error state
                    if (tokenType === 'Reward') setRewardTokenDecimals(null);
                    // Proceed without decimals, or throw specific error?
                }

                // Try fetching name, fallback on error
                try {
                    fetchedName = await tokenContract.name();
                } catch (nameErr) {
                    console.warn(`Could not fetch name for ${tokenType} token ${tokenAddress} (optional function):`, nameErr);
                }

                // Try fetching symbol, fallback on error
                try {
                    fetchedSymbol = await tokenContract.symbol();
                } catch (symbolErr) {
                    console.warn(`Could not fetch symbol for ${tokenType} token ${tokenAddress} (optional function):`, symbolErr);
                }
                
                setInfo({ name: fetchedName, symbol: fetchedSymbol });
                console.log(`Fetched info for ${tokenType} token ${tokenAddress}: ${fetchedName} (${fetchedSymbol}, ${fetchedDecimals ?? 'N/A'} decimals)`);
                
                if (tokenType === 'Reward') {
                    setRewardTokenDecimals(fetchedDecimals);
                }
            } catch (err) {
                // Catch broader errors (e.g., invalid address checked again?)
                console.error(`Failed to fetch info for ${tokenType} token:`, err);
                setError(`Failed to fetch info for the ${tokenType.toLowerCase()} token address.`);
                setInfo(null);
                if (tokenType === 'Reward') setRewardTokenDecimals(null);
            } finally {
                setIsLoading(false);
            }
        } else {
            // Clear info if address is invalid/empty
            setInfo(null);
            if (tokenType === 'Reward') setRewardTokenDecimals(null);
        }
    };

    // Fetch stake token info
    useEffect(() => {
        fetchTokenInfo(formData['stakeToken'], setStakeTokenInfo, setIsFetchingStakeInfo, 'Stake');
    }, [formData['stakeToken']]);

    // Fetch reward token info (includes decimals setting)
    useEffect(() => {
        fetchTokenInfo(formData['rewardToken'], setRewardTokenInfo, setIsFetchingRewardInfo, 'Reward');
        // This replaces the previous separate decimal fetching effect
    }, [formData['rewardToken']]);

    const handleChange = (field: string, value: any) => {
        // Handle date input separately
        if (field === 'endDate') {
            setEndDateString(value);
        } else {
    setFormData((prev) => ({ ...prev, [field]: value }));
        }
        // Reset later steps if inputs change
        if (currentStep !== 'idle' && currentStep !== 'deploying' && currentStep !== 'waiting_deployment') {
            setCurrentStep('idle');
            setDeployedFarmAddress(null);
            setDeployTxHash("");
            setApproveTxHash("");
            setFundTxHash("");
            setError("");
        }
    };

    // Check current allowance
    const checkAllowance = async (currentDecimals = rewardTokenDecimals) => {
        const rewardTokenAddress = formData['rewardToken'];
        const rewardAmount = formData['rewardAmount'];
        if (!signerAddress || !rewardTokenAddress || !rewardAmount || currentDecimals === null || !ethers.utils.isAddress(rewardTokenAddress)) {
            setCurrentStep('idle');
            setCurrentFarmAllowance(null);
            return;
        }

        try {
            const requiredBn = ethers.utils.parseUnits(rewardAmount.toString(), currentDecimals);
            setRequiredAmountWei(requiredBn); // Store required amount

            const provider = getProvider();
            const tokenContract = new ethers.Contract(rewardTokenAddress, ERC20_ABI, provider);
            const currentBn = await tokenContract.allowance(signerAddress, FARM_FACTORY_ADDRESS);
            setCurrentFarmAllowance(currentBn);

            if (currentBn.lt(requiredBn)) {
                console.log(`Allowance needed: Required=${requiredBn.toString()}, Current=${currentBn.toString()}`);
                setCurrentStep('needs_farm_approval');
            } else {
                console.log(`Allowance sufficient: Required=${requiredBn.toString()}, Current=${currentBn.toString()}`);
                setCurrentStep('needs_funding');
            }
        } catch (err: any) {
            console.error("Failed to check allowance:", err);
            setError(`Failed to check token allowance: ${err.message}`);
            setCurrentStep('idle');
            setCurrentFarmAllowance(null);
        }
    };

    // Handle Approve button click
    const handleApprove = async () => {
        const rewardTokenAddress = formData['rewardToken'];
        if (!signerAddress || !rewardTokenAddress || requiredAmountWei === null) {
            setError("Cannot approve: Missing required information.");
            return;
        }
        setCurrentStep('approving_farm');
        setError("");
        setApproveTxHash("");
        try {
            const signer = await getSigner();
            const tokenContract = new ethers.Contract(rewardTokenAddress, ERC20_ABI, signer);
            
            // Add a buffer to the approval amount? Or approve max?
            // Approving exact amount is fine, but MAX_UINT256 is common practice for UX
            const approveAmount = requiredAmountWei; // Or ethers.constants.MaxUint256
            
            console.log(`Approving ${approveAmount.toString()} for ${FARM_FACTORY_ADDRESS} on token ${rewardTokenAddress}`);
            const tx = await tokenContract.approve(FARM_FACTORY_ADDRESS, approveAmount);
            setApproveTxHash(tx.hash);
            await tx.wait();
            console.log("Approval successful:", tx.hash);
            // Re-check allowance after approval
            await checkAllowance();
        } catch (err: any) {
            console.error("Approval failed:", err);
            setError(`Approval failed: ${err.reason || err.message}`);
            setApproveTxHash(""); // Clear hash on error
        }
    };

    // --- VALIDATION (Updated for new fields and schema types) ---
    const validateInitialInputs = (fields: SchemaField[], data: Record<string, any>, endDateValue: string, currentSigner: string): { valid: boolean; errors: string[]; args: any[]; rewardAmountHuman: string | null } => {
        let valid = true;
        const errors: string[] = [];
        const validatedArgs: Record<string, any> = {}; // Store validated args by name
        let rewardAmountHuman: string | null = null;

        // --- Calculate Duration --- 
        if (!endDateValue) {
            valid = false; errors.push("End date is required.");
        } else {
            try {
                const endTime = new Date(endDateValue).getTime();
                const now = Date.now();
                const durationSeconds = Math.floor((endTime - now) / 1000);
                if (durationSeconds <= 0) throw new Error("End date must be in the future.");
                validatedArgs['duration'] = ethers.BigNumber.from(durationSeconds); // Store duration
                console.log(`Calculated duration: ${durationSeconds} seconds`);
            } catch (e: any) {
                valid = false; errors.push(`Invalid end date/time: ${e.message}`);
            }
        }
        
        // --- Store Owner --- 
        if (!currentSigner || !ethers.utils.isAddress(currentSigner)) {
             valid = false; errors.push("Connected wallet address is invalid.");
        } else {
             validatedArgs['owner'] = currentSigner;
        }

        // --- Validate fields defined in schema (excluding owner/duration) --- 
        const schemaFieldsToValidate = fields.filter(f => f.name !== 'owner' && f.name !== 'duration'); 
        for (const f of schemaFieldsToValidate) {
            const value = data[f.name];
            // Use label or name for error messages
            const fieldDisplayName = f.label || f.name;

            if (value === undefined || value === null || value === '') {
                valid = false; errors.push(`Field '${fieldDisplayName}' is required.`); continue;
            }
            try {
                if (f.type === 'address') {
                if (!ethers.utils.isAddress(value)) throw new Error(`Invalid address format`);
                validatedArgs[f.name] = ethers.utils.getAddress(value);
                } else if (f.type === 'uint256') {
                    if (f.name === 'lockDurationDays') {
                        const days = parseInt(value, 10);
                        if (isNaN(days) || days < 0) throw new Error("Must be a non-negative integer");
                        validatedArgs['lockDurationSeconds'] = ethers.BigNumber.from(days * 86400); 
                    } else if (f.name === 'boostMultiplierPercent') {
                        const percent = parseInt(value, 10);
                        if (isNaN(percent) || percent < 0) throw new Error("Must be a non-negative integer");
                        validatedArgs['boostMultiplier'] = ethers.BigNumber.from(100 + percent); 
                    } else {
                        // Handle other potential uint256 fields if schema expands
                        validatedArgs[f.name] = ethers.BigNumber.from(value);
                    }
                } else {
                validatedArgs[f.name] = value;
                }
            } catch (e: any) {
                valid = false; errors.push(`Field '${fieldDisplayName}': ${e.message || 'Invalid value'}`);
            }
        }

        // --- Check reward amount separately (for funding step) --- 
        rewardAmountHuman = data['rewardAmount'];
        if (!rewardAmountHuman || isNaN(parseFloat(rewardAmountHuman)) || parseFloat(rewardAmountHuman) <= 0) {
            valid = false; errors.push(`Valid 'Reward Amount' (> 0) is required.`);
        }
        
        // --- Construct final ordered args array based on schema type --- 
        let finalArgs: any[] = [];
        if (valid && loadedSchema) { // Ensure schema is loaded before constructing
            try {
                 // Always use the Enhanced farm argument order
                 finalArgs = [
                    validatedArgs['owner'], 
                    validatedArgs['stakeToken'], 
                    validatedArgs['rewardToken'], 
                    validatedArgs['duration'],
                    validatedArgs['lockDurationSeconds'], 
                    validatedArgs['boostMultiplier']
                 ];
                 if (finalArgs.some(arg => arg === undefined)) {
                     throw new Error("Internal validation error: Missing arguments.");
                 }
            } catch (e: any) {
                 valid = false;
                 errors.push(e.message);
                 finalArgs = []; // Clear args on error
            }
        }

        return { valid, errors, args: finalArgs, rewardAmountHuman };
    }

    // --- Action Handlers --- 

    const handleDeploy = async () => {
        if (!loadedSchema) { setError("Cannot deploy: Farm schema not loaded."); return; }
        if (!isConnected || !signerAddress) { setError("Please connect wallet."); return; }
        if (isWrongNetwork) { setError("Please switch to UNICHAIN."); return; }
        if (rewardTokenDecimals === null && formData['rewardToken']) { setError("Waiting for reward token decimals..."); return; }

        setError("");
        setDeployTxHash("");
        setApproveTxHash("");
        setFundTxHash("");
        setDeployedFarmAddress(null);
        setCurrentFarmAllowance(null);
        setRequiredAmountWei(null);

        // Validate initial inputs (owner, stake, reward token, duration)
        // Pass endDateString for validation
        const { valid, errors, args, rewardAmountHuman } = validateInitialInputs(loadedSchema.initFields, formData, endDateString, signerAddress || "");

        if (!valid || !rewardAmountHuman) {
            setError(`Input errors: ${errors.join(", ")}`); return;
        }
        
        let rewardAmountWeiTemp: ethers.BigNumber;
        try {
            if (rewardTokenDecimals === null) throw new Error("Reward token decimals not loaded.");
            rewardAmountWeiTemp = ethers.utils.parseUnits(rewardAmountHuman.toString(), rewardTokenDecimals);
            if (rewardAmountWeiTemp.isZero()) throw new Error("Reward amount must be greater than zero");
            setRequiredAmountWei(rewardAmountWeiTemp);
        } catch(e:any) {
            setError(`Input error for 'rewardAmount': ${e.message}`); return;
        }

        setCurrentStep('deploying');

        try {
            const signer = await getSigner();
            const provider = getProvider();
            const factory = new ethers.Contract(FARM_FACTORY_ADDRESS, FARM_FACTORY_ABI, signer);
            const factoryReader = new ethers.Contract(FARM_FACTORY_ADDRESS, FARM_FACTORY_ABI, provider);

            // Fix: Use the correct function name from the contract
            const countBefore = await factoryReader.getFarmCount();
            console.log("Farm count before deployment:", countBefore.toString());
            
            // Use the type directly from the loaded schema
            const farmTypeHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(loadedSchema.type));
            const metadataURI = "ipfs://YOUR_METADATA_HASH_HERE";

            // --- Encode initData using the Enhanced ABI --- 
            const farmInterface = new ethers.utils.Interface(CURRENT_FARM_IMPLEMENTATION_ABI);
            console.log("Arguments for initialize:", args);
            
            // First encode the args array into a single bytes parameter
            const encodedArgs = ethers.utils.defaultAbiCoder.encode(
                [
                    "address", // owner
                    "address", // stakeToken
                    "address", // rewardToken
                    "uint256", // duration
                    "uint256", // lockDurationSeconds
                    "uint256"  // boostMultiplier
                ],
                args
            );
            
            // Then encode the function call with the bytes parameter
            const initData = farmInterface.encodeFunctionData("initialize", [encodedArgs]);
            console.log("Encoded initData for factory:", initData);
            
            // --- Pre-flight check ... ---
             const stakeTokenAddr = args[1]; 
             const rewardTokenAddr = args[2]; 
             // ... getCode checks ...

            // --- Call deployFarm with generic initData --- 
            console.log(`Calling factory.deployFarm with farmTypeHash: ${farmTypeHash}`);
            const txResponse = await factory.deployFarm(
                farmTypeHash, 
                initData, // Pass the correctly encoded initData based on schema type
                metadataURI, 
                { value: 0 } 
            );
            
            console.log("Deployment transaction sent:", txResponse.hash);
            const receipt = await txResponse.wait();
            console.log("Deployment receipt received:", receipt);

            // Wrap post-receipt logic in try/catch
            try {
                // --- Get new farm count and fetch the last deployed farm address --- 
                const countAfter = await factoryReader.getFarmCount();
                console.log("Farm count after deployment:", countAfter.toString());

                if (!countAfter.gt(countBefore)) {
                    console.error("Farm count did not increase after deployment transaction.", { countBefore, countAfter });
                    throw new Error("Deployment transaction confirmed, but farm count did not increase. Cannot find new farm address.");
                }
                
                // Get the last deployed farm from the deployedFarms array by index
                const newFarmIndex = countAfter.sub(1);
                const newFarmAddress = await factoryReader.deployedFarms(newFarmIndex);
                console.log(`Attempting to set deployedFarmAddress state to: ${newFarmAddress}`); 
                setDeployedFarmAddress(newFarmAddress);

                // Proceed to check allowance for the new farm
                if (rewardAmountWeiTemp) { 
                    console.log(`Proceeding to checkFarmAllowance for ${newFarmAddress} with required amount ${rewardAmountWeiTemp.toString()}`); 
                    await checkFarmAllowance(newFarmAddress, rewardAmountWeiTemp); // Pass the temp variable
                } else {
                    console.error("Logic error: rewardAmountWeiTemp is null/undefined when trying to check allowance.");
                    setError("Internal logic error: Reward amount missing.");
                    setCurrentStep('failed');
                }
                // Next step determined by checkFarmAllowance
            } catch (postDeployError: any) {
                console.error("Error after deployment confirmation:", postDeployError);
                setError(`Deployment succeeded, but failed during post-deploy steps: ${postDeployError.message}`);
                setCurrentStep('failed');
            }

        } catch (err: any) {
            console.error("Deployment failed:", err);
            const revertReason = err.reason || (err.data ? err.data.message : null) || err.message || "Unknown error";
            setError(`Deployment failed: ${revertReason}`);
            setCurrentStep('failed');
        }
    };

    // Check allowance for the *newly deployed farm*
    const checkFarmAllowance = async (farmAddr: string, requiredAmount: ethers.BigNumber) => {
        if (!signerAddress || !formData['rewardToken'] || !ethers.utils.isAddress(formData['rewardToken'])) return;
        console.log(`Checking allowance for spender ${farmAddr}`);
        try {
            const provider = getProvider();
            const tokenContract = new ethers.Contract(formData['rewardToken'], ERC20_ABI, provider);
            const currentBn = await tokenContract.allowance(signerAddress, farmAddr);
            setCurrentFarmAllowance(currentBn);

            if (currentBn.lt(requiredAmount)) {
                console.log(`Farm allowance needed: Required=${requiredAmount.toString()}, Current=${currentBn.toString()}. Setting step to needs_farm_approval.`);
                setCurrentStep('needs_farm_approval'); // LOGGING POINT 1
            } else {
                console.log(`Farm allowance sufficient: Required=${requiredAmount.toString()}, Current=${currentBn.toString()}. Setting step to needs_funding.`);
                setCurrentStep('needs_funding'); // LOGGING POINT 2
            }
        } catch (err: any) {
            console.error("Failed to check farm allowance:", err);
            setError(`Failed to check token allowance for new farm: ${err.message}`);
            setCurrentStep('failed');
        }
    };

    // Handle approval for the *newly deployed farm*
    const handleApproveFarm = async () => {
        console.log("handleApproveFarm called."); // LOGGING POINT 3
        if (!signerAddress || !formData['rewardToken'] || !deployedFarmAddress || requiredAmountWei === null) {
            console.error("Cannot approve farm: Missing required info", { signerAddress, rewardToken: formData['rewardToken'], deployedFarmAddress, requiredAmountWei: requiredAmountWei?.toString() });
            setError("Cannot approve farm: Missing required information."); return;
        }
        setCurrentStep('approving_farm'); // LOGGING POINT 4
        setError("");
        setApproveTxHash("");
        try {
            const signer = await getSigner();
            const tokenContract = new ethers.Contract(formData['rewardToken'], ERC20_ABI, signer);
            const approveAmount = requiredAmountWei; 
            
            console.log(`Approving ${approveAmount.toString()} for farm ${deployedFarmAddress} on token ${formData['rewardToken']}`);
            const tx = await tokenContract.approve(deployedFarmAddress, approveAmount); 
            setApproveTxHash(tx.hash);
            console.log("Approval transaction sent:", tx.hash); // LOGGING POINT 5
            setCurrentStep('waiting_approval');
            await tx.wait();
            console.log("Farm approval successful, re-checking allowance:", tx.hash); // LOGGING POINT 6
            await checkFarmAllowance(deployedFarmAddress, requiredAmountWei); // Re-check allowance
        } catch (err: any) {
            console.error("Farm approval failed:", err);
            setError(`Farm approval failed: ${err.reason || err.message}`);
            setCurrentStep('needs_farm_approval'); // Go back to needing approval
            setApproveTxHash("");
        } 
    };

    // Handle funding the farm
    const handleFundFarm = async () => {
        if (!signerAddress || !deployedFarmAddress || requiredAmountWei === null) {
            setError("Cannot fund farm: Missing required information."); return;
        }
        // Ensure schema is loaded to determine correct ABI
        if (!loadedSchema) {
            setError("Cannot fund farm: Schema not loaded."); return;
        }

        setCurrentStep('funding');
        setError("");
        setFundTxHash("");
        try {
            const signer = await getSigner();
            // ALWAYS use the current farm ABI
            const farmContract = new ethers.Contract(deployedFarmAddress, CURRENT_FARM_IMPLEMENTATION_ABI, signer);
            
            console.log(`Funding farm ${deployedFarmAddress} with ${requiredAmountWei.toString()} wei`);
            
            // Check if fund function exists on the contract instance
            if (typeof farmContract.fund !== 'function') {
                console.error("Fund function not found on contract instance with selected ABI:", loadedSchema.type);
                throw new Error(`'fund' function not found in the ABI for farm type ${loadedSchema.type}. Check utils/web3.ts.`);
            }

            const tx = await farmContract.fund(requiredAmountWei);
            setFundTxHash(tx.hash);
            setCurrentStep('waiting_funding');
            await tx.wait();
            console.log("Farm funding successful:", tx.hash);
            setCurrentStep('completed');
            setFormData({}); 
            setEndDateString(""); // Also clear date string

        } catch (err: any) {
            console.error("Farm funding failed:", err);
            setError(`Farm funding failed: ${err.reason || err.message}`);
            // Go back to needing funding? Or just show failed?
            // Let's keep it simple and just show failed for now
            setCurrentStep('failed'); 
            setFundTxHash("");
        }
    };

    const getInputType = (schemaType: string) => {
        if (schemaType === 'uint256') return 'number';
        if (schemaType === 'address') return 'text';
        return 'text';
    }

    // --- Render Logic --- 
    const renderCurrentStep = () => {
        switch (currentStep) {
            case 'deploying':
                return <p>Deploying farm contract... Tx: {deployTxHash || 'Waiting...'}</p>;
            case 'waiting_deployment':
                return <p>Waiting for deployment confirmation... Tx: {deployTxHash}</p>;
            case 'needs_farm_approval':
                return (
                    <div style={{ marginTop: '15px', padding: '10px', border: '1px solid orange' }}>
                        <p><b>Next Step:</b> Approve the new Farm contract ({deployedFarmAddress?.substring(0,6)}...) to spend your reward tokens.</p>
                        {currentFarmAllowance !== null && requiredAmountWei !== null && (
                            <p style={{fontSize: '0.9em'}}>Required: {ethers.utils.formatUnits(requiredAmountWei, rewardTokenDecimals || 18)} | Current Allowance: {ethers.utils.formatUnits(currentFarmAllowance, rewardTokenDecimals || 18)}</p>
                        )}
                        <button onClick={handleApproveFarm} disabled={!isConnected || isWrongNetwork}>Approve New Farm</button>
                    </div>
                );
            case 'approving_farm':
                return <p>Approving farm... Tx: {approveTxHash || 'Waiting...'}</p>;           
            case 'waiting_approval':
                return <p>Waiting for approval confirmation... Tx: {approveTxHash}</p>; 
            case 'needs_funding':
  return (
                    <div style={{ marginTop: '15px', padding: '10px', border: '1px solid green' }}>
                        <p><b>Final Step:</b> Fund the new Farm contract ({deployedFarmAddress?.substring(0,6)}...) with the rewards.</p>
                        {requiredAmountWei !== null && (
                            <p style={{fontSize: '0.9em'}}>Amount: {ethers.utils.formatUnits(requiredAmountWei, rewardTokenDecimals || 18)} tokens</p>
                        )}
                        <button onClick={handleFundFarm} disabled={!isConnected || isWrongNetwork}>Fund Farm</button>
        </div>
                );
            case 'funding':
                return <p>Funding farm... Tx: {fundTxHash || 'Waiting...'}</p>;       
            case 'waiting_funding':
                return <p>Waiting for funding confirmation... Tx: {fundTxHash}</p>;   
            case 'completed':
                return <p style={{ color: 'green', fontWeight: 'bold' }}>Farm created and funded successfully! <br/>Deploy Tx: {deployTxHash}<br/>Fund Tx: {fundTxHash}</p>;
            case 'failed':
                return <p style={{ color: 'red' }}>Process failed. See error message.</p>;   
            case 'idle':
            default:
                return (
                    <button onClick={handleDeploy} disabled={!isConnected || isWrongNetwork || isFetchingDecimals || (!!formData['rewardToken'] && rewardTokenDecimals === null)}>
                        Deploy Farm
                    </button>
                );
        }
    }

    // Determine if form inputs should be disabled based on current step
    // Disable only during active transaction steps or on completion/failure
    const disableInputs = [
        'deploying', 
        'waiting_deployment', 
        'approving_farm', 
        'waiting_approval',
        'funding', 
        'waiting_funding',
        'completed',
        'failed'
    ].includes(currentStep);

    // Function to get minimum date for date picker (e.g., tomorrow)
    const getMinEndDate = () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        // Format as YYYY-MM-DDTHH:MM required by datetime-local
        return tomorrow.toISOString().slice(0, 16);
    };

    if (!loadedSchema) {
        return <p style={{ color: 'red' }}>Error: {error || "Selected farm type schema could not be loaded."}</p>;
    }

    return (
        <div>
            <h1>Create Enhanced Fixed APY Farm</h1>
            
            <h2>Configure Farm</h2>

            {/* Dynamic Form Fields based on loadedSchema */}
            {loadedSchema.initFields 
                // Filter out owner (auto) and duration (handled by date picker)
                .filter(f => f.name !== 'owner' && f.name !== 'duration') 
                .map((f: SchemaField) => {
                    const isStakeTokenField = f.name === 'stakeToken';
                    const isRewardTokenField = f.name === 'rewardToken';
                    const tokenInfo = isStakeTokenField ? stakeTokenInfo : (isRewardTokenField ? rewardTokenInfo : null);
                    const isLoadingInfo = isStakeTokenField ? isFetchingStakeInfo : (isRewardTokenField ? isFetchingRewardInfo : false);
                    
                    // Only render fields defined in the current schema's initFields
                    // And manually add the rewardAmount field which is needed for funding
                    return (
                        <div key={f.name} style={{ marginBottom: '10px' }}>
                            <label style={{ display: 'block', marginBottom: '5px' }}>
                                {f.label || f.name} {/* Use custom label if available */}
                                {isStakeTokenField && tokenInfo && ` (${tokenInfo.symbol})`}
                                {isRewardTokenField && tokenInfo && ` (${tokenInfo.symbol})`}
                                {(isStakeTokenField || isRewardTokenField) && !tokenInfo && ' (address)'}
                            </label>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                <input 
                                    type={f.name === 'lockDurationDays' || f.name === 'boostMultiplierPercent' ? 'number' : f.type === 'address' ? 'text' : 'text'} // Adjust input type
                                    min={f.type === 'uint256' ? "0" : undefined}
                                    step={f.name === 'lockDurationDays' || f.name === 'boostMultiplierPercent' ? '1' : undefined} // Integer steps
                                    value={formData[f.name] || ''} 
                                    onChange={(e) => handleChange(f.name, e.target.value)}
                                    placeholder={f.placeholder || (f.type === 'address' ? '0x...' : '0')}
                                    disabled={disableInputs}
                                    style={{ padding: '8px', width: '300px' }}
                                />
                                {isLoadingInfo && <span style={{ marginLeft: '10px', fontSize: '0.8em'}}> (Loading...)</span>}
                                {!isLoadingInfo && tokenInfo && <span style={{ marginLeft: '10px', fontSize: '0.9em', color: 'grey' }}>{tokenInfo.name}</span>}
                            </div>
                        </div>
                    );
                 })
            }
            {/* Always render Reward Amount field separately as it's needed for funding */}
            <div key="rewardAmount" style={{ marginBottom: '10px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>
                    Reward Amount {rewardTokenInfo ? `(${rewardTokenInfo.name} - ${rewardTokenDecimals ?? ''} decimals)` : '(Enter reward token first)'}
                </label>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input 
                        type="number"
                        min="0"
                        step="any" // Allow decimals
                        value={formData['rewardAmount'] || ''} 
                        onChange={(e) => handleChange('rewardAmount', e.target.value)}
                        placeholder={'e.g., 100.5'}
                        disabled={disableInputs || rewardTokenDecimals === null && !!formData['rewardToken']}
                        style={{ padding: '8px', width: '300px' }}
                    />
                    {isFetchingRewardInfo && <span style={{ marginLeft: '10px', fontSize: '0.8em'}}> (Loading...)</span>}
                </div>
            </div>

            {/* Always render End Date Picker */}
            <div key="endDate" style={{ marginBottom: '10px' }}>
                 <label style={{ display: 'block', marginBottom: '5px' }}>End Date & Time</label>
                 <input 
                     type="datetime-local"
                     value={endDateString}
                     min={getMinEndDate()} 
                     onChange={(e) => handleChange('endDate', e.target.value)}
                     disabled={disableInputs}
                     style={{ padding: '8px', width: '300px' }}
                 />
            </div>
            
            {/* Render current step UI / Button */} 
            <div style={{marginTop: '20px'}}> 
                {renderCurrentStep()} 
            </div>

            {/* Global Status Messages */}
            {!isConnected && <p style={{ color: 'orange', marginTop: '10px' }}>Connect wallet to start</p>}
            {isWrongNetwork && <p style={{ color: 'orange', marginTop: '10px' }}>Please switch to UNICHAIN network</p>}
            {error && <p style={{ color: 'red', marginTop: '10px' }}>Error: {error}</p>}
    </div>
  );
}

