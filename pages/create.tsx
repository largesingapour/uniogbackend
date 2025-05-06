import React, { useEffect, useState, useCallback } from 'react';
import { ethers } from 'ethers';
import { 
    FARM_FACTORY_ADDRESS, 
    FARM_FACTORY_ABI, 
    CURRENT_FARM_IMPLEMENTATION_ABI, // Now imports the full FixedAPYFarm ABI from utils/web3
    ERC20_ABI, 
    getSigner, 
    getAccount, 
    checkNetwork, 
    getProvider,
    checkFarmTypeRegistered
} from '../utils/web3';

// --- Statically import the fixed APY farm schema --- 
import schema_v2 from '../metadata/farmTypes/FixedAPYFarm_v2.json';

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
        // Directly load the schema
        console.log("Loading FixedAPYFarm_v2 schema...");
        try {
            // Cast the imported JSON directly
            const schemaData = schema_v2 as FarmSchema;
             if (!schemaData || !schemaData.type || !Array.isArray(schemaData.initFields)) {
                 throw new Error(`Invalid schema structure in FixedAPYFarm_v2.json`);
            }
            // Check if the farm type is registered
            checkFarmTypeRegistered(schemaData.type).then(isRegistered => {
                if (!isRegistered) {
                    console.warn(`Farm type ${schemaData.type} is not registered in the factory. Deployment might fail.`);
                    setError(`Warning: Farm type ${schemaData.type} is not registered in the factory. Please contact the admin to register it.`);
                } else {
                    console.log(`Farm type ${schemaData.type} is registered in the factory.`);
                    setError("");
                }
            });
            
            // TODO: Check implementationAddress exists in schema?
            setLoadedSchema(schemaData);
            console.log(`Loaded schema with type: ${schemaData.type}`);
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
        } else if (field === 'lockDurationDays') {
            // Validate lockDurationDays to prevent zero values
            const parsedValue = parseInt(value);
            if (parsedValue <= 0) {
                setError("Lock duration must be greater than zero days");
                // Still update the form data so the user sees what they typed
                setFormData((prev) => ({ ...prev, [field]: value }));
            } else {
                setError(""); // Clear error if value is valid
                setFormData((prev) => ({ ...prev, [field]: value }));
            }
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
    const validateInitialInputs = (fields: SchemaField[], data: Record<string, any>, endDateValue: string, currentSigner: string, schemaType: string): { valid: boolean; errors: string[]; args: any[]; rewardAmountHuman: string | null } => {
        const errors: string[] = [];
        const args: any[] = [];
        let rewardAmountHuman: string | null = null;
      
        // Check all fields exist
        for (const field of fields) {
            if (!data[field.name] && field.name !== 'endDate') {
                errors.push(`Missing required field: ${field.label || field.name}`);
            }
        }

        // Add additional metadata fields to the form data
        if (!data['farmName']) {
            errors.push('Farm Name is required');
        }

        if (!data['description']) {
            errors.push('Farm Description is required');
        }

        // Explicitly validate lockDurationDays to prevent zero values
        if (data.lockDurationDays) {
            const daysValue = parseInt(data.lockDurationDays);
            if (isNaN(daysValue) || daysValue <= 0) {
                errors.push('Lock duration must be greater than zero days');
            }
        }
      
        // If no errors yet, validate and prepare specific fields
        if (errors.length === 0) {
            // Address validations
            try {
                const stakeTokenAddr = ethers.utils.getAddress(data.stakeToken);
                const rewardTokenAddr = ethers.utils.getAddress(data.rewardToken);
            
                // Convert lock duration from days to seconds
                let lockDurationSeconds = 0;
                if (data.lockDurationDays) {
                    const daysValue = parseInt(data.lockDurationDays);
                    if (isNaN(daysValue) || daysValue <= 0) {
                        errors.push('Lock duration must be greater than zero days');
                    } else {
                        lockDurationSeconds = daysValue * 24 * 60 * 60; // days to seconds
                    }
                }
            
                // Parse APY percentage
                let fixedAPYPercent = 0;
                if (data.fixedAPYPercent) {
                    const apyValue = parseInt(data.fixedAPYPercent);
                    if (isNaN(apyValue) || apyValue < 0) {
                        errors.push('APY percentage must be a positive number');
                    } else {
                        fixedAPYPercent = apyValue;
                    }
                }
            
                // Calculate reward amount based on APY (example)
                // NOTE: This calculation is just for display, the actual reward logic happens in the contract
                if (data.rewardAmount) {
                    rewardAmountHuman = data.rewardAmount;
                }
            
                // Prepare final arguments array with the encoded parameters format required
                args.push(
                    "0x724e6425bb38473e011ea961515c65e81e2769a94ca4c3174aa97e31a057dc20", // Use the exact bytes32 hash directly
                    ethers.utils.defaultAbiCoder.encode(
                        ['address', 'address', 'uint256', 'uint256'],
                        [stakeTokenAddr, rewardTokenAddr, lockDurationSeconds, fixedAPYPercent]
                    ),
                    JSON.stringify({
                        farmName: data.farmName,
                        description: data.description,
                        farmType: "FixedAPYFarm"
                    })
                );
            
            } catch (err: any) {
                console.error("Validation error:", err);
                errors.push(`Invalid input data: ${err.message}`);
            }
        }
      
        return {
            valid: errors.length === 0,
            errors,
            args,
            rewardAmountHuman
        };
    };

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

        // Validate initial inputs
        const { valid, errors, args, rewardAmountHuman } = validateInitialInputs(loadedSchema.initFields, formData, endDateString, signerAddress || "", loadedSchema.type);

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
            
            // Get validated addresses and other parameters
            const stakeTokenAddr = ethers.utils.getAddress(formData.stakeToken);
            const rewardTokenAddr = ethers.utils.getAddress(formData.rewardToken);
            
            // Convert lock duration from days to seconds
            const lockDurationDays = parseInt(formData.lockDurationDays || "0");
            const lockDurationSeconds = lockDurationDays * 24 * 60 * 60; // days to seconds
            
            // Get APY percentage
            const fixedAPYPercent = parseInt(formData.fixedAPYPercent || "0");

            // Create metadata JSON
            const metadataURI = JSON.stringify({
                farmName: formData.farmName,
                description: formData.description,
                farmType: "FixedAPYFarm"
            });

            // --- Encode initData as specified ---
            const initData = ethers.utils.defaultAbiCoder.encode(
                ['address', 'address', 'uint256', 'uint256'],
                [stakeTokenAddr, rewardTokenAddr, lockDurationSeconds, fixedAPYPercent]
            );
            
            console.log("Encoded initData for factory:", initData);
            
            // --- Call deployFarm with the farm type and encoded initData --- 
            // Use the specific bytes32 hash instead of formatting a string
            const farmType = "0x724e6425bb38473e011ea961515c65e81e2769a94ca4c3174aa97e31a057dc20";
            console.log(`Calling factory.deployFarm with farm type hash: ${farmType} (FixedAPYFarm)`);
            const txResponse = await factory.deployFarm(
                farmType, // Use the exact bytes32 hash directly
                initData, // Properly encoded initialization data
                metadataURI // Metadata JSON string
            );
            
            setDeployTxHash(txResponse.hash);
            console.log("Deployment transaction sent:", txResponse.hash);
            
            setCurrentStep('waiting_deployment');
            const receipt = await txResponse.wait();
            console.log("Deployment receipt received:", receipt);

            // Extract the deployed farm address from the event
            if (receipt.events && receipt.events.length > 0) {
                // Look for the FarmDeployed event
                const farmDeployedEvent = receipt.events.find(e => 
                    e.event === 'FarmDeployed' && e.args && e.args.farm
                );
                
                if (farmDeployedEvent && farmDeployedEvent.args) {
                    const newFarmAddress = farmDeployedEvent.args.farm;
                    console.log(`Deployed farm address from event: ${newFarmAddress}`);
                    setDeployedFarmAddress(newFarmAddress);
                    
                    // Proceed to check allowance for the new farm
                    await checkFarmAllowance(newFarmAddress, rewardAmountWeiTemp);
                } else {
                    // Fallback: Try to get the farm address from the factory
                    const countAfter = await factoryReader.getFarmCount();
                    console.log("Farm count after deployment:", countAfter.toString());

                    if (!countAfter.gt(countBefore)) {
                        throw new Error("Farm count did not increase after deployment. Cannot find new farm address.");
                    }
                    
                    // Get the last deployed farm from the deployedFarms array by index
                    const newFarmIndex = countAfter.sub(1);
                    const newFarmAddress = await factoryReader.deployedFarms(newFarmIndex);
                    console.log(`Farm address from factory: ${newFarmAddress}`);
                    setDeployedFarmAddress(newFarmAddress);
                    
                    // Check allowance for funding
                    await checkFarmAllowance(newFarmAddress, rewardAmountWeiTemp);
                }
            } else {
                throw new Error("Deployment receipt has no events. Cannot find farm address.");
            }
        } catch(e:any) {
            console.error("Deployment failed:", e);
            setError(`Deployment failed: ${e.reason || e.message}`);
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
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px' }}>
            <h1>Create Fixed APY Farm</h1>
            
            {error && <div style={{ color: 'red', marginBottom: '20px', padding: '10px', backgroundColor: '#ffeeee', borderRadius: '5px' }}>{error}</div>}
            
            <div style={{ marginBottom: '20px', padding: '20px', border: '1px solid #eee', borderRadius: '5px' }}>
                <h2>Farm Metadata</h2>
                
                <div style={{ marginBottom: '15px' }}>
                    <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                        Farm Name *
                    </label>
                    <input 
                        type="text"
                        value={formData['farmName'] || ''}
                        onChange={(e) => handleChange('farmName', e.target.value)}
                        placeholder="Enter a name for your farm"
                        style={{ 
                            width: '100%', 
                            padding: '8px', 
                            border: '1px solid #ccc', 
                            borderRadius: '4px' 
                        }}
                        disabled={currentStep !== 'idle'}
                    />
                </div>
                
                <div style={{ marginBottom: '15px' }}>
                    <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                        Description *
                    </label>
                    <textarea 
                        value={formData['description'] || ''}
                        onChange={(e) => handleChange('description', e.target.value)}
                        placeholder="Enter a description for your farm"
                        style={{ 
                            width: '100%', 
                            padding: '8px', 
                            border: '1px solid #ccc', 
                            borderRadius: '4px',
                            minHeight: '100px' 
                        }}
                        disabled={currentStep !== 'idle'}
                    />
                </div>
            </div>
            
            {loadedSchema && (
                <div style={{ marginBottom: '20px', padding: '20px', border: '1px solid #eee', borderRadius: '5px' }}>
                    <h2>Farm Configuration</h2>
                    
                    {loadedSchema.initFields.map((field) => (
                        <div key={field.name} style={{ marginBottom: '15px' }}>
                            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                                {field.label || field.name} *
                            </label>
                            <input 
                                type={getInputType(field.type)}
                                value={formData[field.name] || ''}
                                onChange={(e) => handleChange(field.name, e.target.value)}
                                placeholder={field.placeholder || ''}
                                style={{ 
                                    width: '100%', 
                                    padding: '8px', 
                                    border: '1px solid #ccc', 
                                    borderRadius: '4px' 
                                }}
                                disabled={currentStep !== 'idle'}
                            />
                            
                            {/* Show token info if available */}
                            {field.name === 'stakeToken' && stakeTokenInfo && (
                                <div style={{ marginTop: '5px', fontSize: '14px', color: '#666' }}>
                                    Token: {stakeTokenInfo.name} ({stakeTokenInfo.symbol})
                                </div>
                            )}
                            
                            {field.name === 'rewardToken' && rewardTokenInfo && (
                                <div style={{ marginTop: '5px', fontSize: '14px', color: '#666' }}>
                                    Token: {rewardTokenInfo.name} ({rewardTokenInfo.symbol})
                                </div>
                            )}
                            
                            {/* Show loading indicators */}
                            {field.name === 'stakeToken' && isFetchingStakeInfo && (
                                <div style={{ marginTop: '5px', fontSize: '14px', color: '#666' }}>
                                    Fetching token info...
                                </div>
                            )}
                            
                            {field.name === 'rewardToken' && isFetchingRewardInfo && (
                                <div style={{ marginTop: '5px', fontSize: '14px', color: '#666' }}>
                                    Fetching token info...
                                </div>
                            )}
                        </div>
                    ))}
                    
                    {/* Add reward amount field */}
                    <div style={{ marginBottom: '15px' }}>
                        <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                            Reward Amount *
                        </label>
                        <input 
                            type="number"
                            value={formData['rewardAmount'] || ''}
                            onChange={(e) => handleChange('rewardAmount', e.target.value)}
                            placeholder="Amount of reward tokens to fund the farm"
                            style={{ 
                                width: '100%', 
                                padding: '8px', 
                                border: '1px solid #ccc', 
                                borderRadius: '4px' 
                            }}
                            disabled={currentStep !== 'idle'}
                        />
                        {rewardTokenInfo && (
                            <div style={{ marginTop: '5px', fontSize: '14px', color: '#666' }}>
                                You will need to approve {formData['rewardAmount'] || '0'} {rewardTokenInfo.symbol} tokens
                            </div>
                        )}
                    </div>
                </div>
            )}
            
            {/* Action buttons */}
            <div style={{ marginTop: '20px' }}>
                {renderCurrentStep()}
            </div>
            
            {/* Display deployment information */}
            {deployedFarmAddress && (
                <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '5px' }}>
                    <h3>Deployment Information</h3>
                    <p><strong>Farm Address:</strong> {deployedFarmAddress}</p>
                    {deployTxHash && (
                        <p><strong>Deploy Transaction:</strong> {deployTxHash}</p>
                    )}
                    {approveTxHash && (
                        <p><strong>Approve Transaction:</strong> {approveTxHash}</p>
                    )}
                    {fundTxHash && (
                        <p><strong>Fund Transaction:</strong> {fundTxHash}</p>
                    )}
                </div>
            )}
        </div>
    );
}

