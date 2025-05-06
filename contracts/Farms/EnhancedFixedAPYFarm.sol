// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
// Add the missing import for the interface
import {IFarm} from "../interfaces/IFarm.sol";

// Structure to store user staking info including lock time
struct StakedInfo {
    // ... struct fields ...
}

contract EnhancedFixedAPYFarm is IFarm {
    // ... state variables, events, modifiers ...

    function initialize(bytes memory data) external override {
        require(!initialized, "Already initialized");
        // Decode based on the expected arguments for this specific farm type
        (
            address _owner,
            address _stakeToken,
            address _rewardToken,
            uint256 _duration,
            uint256 _lockDurationSeconds,
            uint256 _boostMultiplier
        ) = abi.decode(data, (
            address, 
            address, 
            address, 
            uint256, 
            uint256, 
            uint256
        )); 

        // --- Start Checks ---
        require(_owner != address(0), "Zero owner");
        // ... other checks ...
        require(_duration > 0, "Zero duration");
        require(_boostMultiplier >= 100, "Boost must be >= 100");

        // --- Assignments ---
        owner = _owner;
        stakeToken = IERC20(_stakeToken);
        rewardToken = IERC20(_rewardToken);
        duration = _duration;
        lockDurationSeconds = _lockDurationSeconds;
        boostMultiplier = _boostMultiplier;
        // ... rest of assignments ...
        uint256 startTime = block.timestamp;
        lastUpdate = startTime;
        endTimestamp = startTime + duration;

        initialized = true;
    }

    // ... fund, stake, unstake, claim, etc. remain the same ...
} 