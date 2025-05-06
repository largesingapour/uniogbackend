// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

interface IFarm {
    function initialize(bytes memory data) external;
    function fund(uint256 _rewardAmount) external;
    function stake(uint256 amount) external;
    function unstake(uint256 amount) external;
    function claim() external;
    function getMetadata() external view returns (bytes memory);
}
