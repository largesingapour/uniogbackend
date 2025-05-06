// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IFarm} from "../interfaces/IFarm.sol";

contract FarmFactory is Ownable {
    using Clones for address;

    constructor() Ownable(msg.sender) {}

    uint256 public deploymentFee;
    address public feeReceiver;

    mapping(bytes32 => address) public implementations;
    address[] public deployedFarms;
    mapping(address => string) public farmMetadataURI;
    mapping(address => address) public farmCreators;

    event FarmTypeRegistered(bytes32 indexed farmType, address implementation);
    event FarmDeployed(bytes32 indexed farmType, address indexed farm, address indexed creator, string metadataURI);

    function registerFarmType(bytes32 farmType, address implementation) external onlyOwner {
        require(farmType != bytes32(0), "Invalid type");
        require(implementation != address(0), "Zero address");
        require(implementations[farmType] == address(0), "Already registered");

        implementations[farmType] = implementation;
        emit FarmTypeRegistered(farmType, implementation);
    }

    function setDeploymentFee(uint256 _fee, address _receiver) external onlyOwner {
        deploymentFee = _fee;
        feeReceiver = _receiver;
    }

    function deployFarm(
        bytes32 farmType,
        bytes calldata initData,
        string calldata metadataURI
    ) external payable returns (address farm) {
        address impl = implementations[farmType];
        require(impl != address(0), "Unregistered farm type");

        if (deploymentFee > 0) {
            require(msg.value >= deploymentFee, "Insufficient fee");
            if (feeReceiver != address(0)) {
                payable(feeReceiver).transfer(deploymentFee);
            }
        }

        farm = impl.clone();
        
        (bool success, ) = farm.call(initData);
        require(success, "Initialization failed");

        deployedFarms.push(farm);
        farmMetadataURI[farm] = metadataURI;
        farmCreators[farm] = msg.sender;

        emit FarmDeployed(farmType, farm, msg.sender, metadataURI);
    }

    function getFarmCount() external view returns (uint256) {
        return deployedFarms.length;
    }

    function getDeployedFarms(uint256 offset, uint256 limit) external view returns (address[] memory farms) {
        uint256 len = deployedFarms.length;
        if (offset >= len) return new address[](0);

        uint256 end = offset + limit > len ? len : offset + limit;
        farms = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            farms[i - offset] = deployedFarms[i];
        }
    }

    function isRegisteredFarmType(bytes32 farmType) external view returns (bool) {
        return implementations[farmType] != address(0);
    }

    function getFarmCreator(address farm) external view returns (address) {
        return farmCreators[farm];
    }

    function getMetadataURI(address farm) external view returns (string memory) {
        return farmMetadataURI[farm];
    }
}
