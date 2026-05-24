// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract StakeholderRegistry is AccessControl {
    bytes32 public constant MINE_ROLE = keccak256("MINE_ROLE");
    bytes32 public constant LOGISTICS_ROLE = keccak256("LOGISTICS_ROLE");
    bytes32 public constant SMELTER_ROLE = keccak256("SMELTER_ROLE");
    bytes32 public constant MANUFACTURER_ROLE = keccak256("MANUFACTURER_ROLE");
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");

    struct Stakeholder {
        string name;
        string metadataURI;
        bool isActive;
        uint256 registeredAt;
    }

    mapping(address => Stakeholder) public stakeholders;
    address[] public stakeholderList;

    event StakeholderRegistered(
        address indexed account,
        bytes32 indexed role,
        string name,
        uint256 timestamp
    );
    event StakeholderDeactivated(address indexed account, uint256 timestamp);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function registerStakeholder(
        address account,
        bytes32 role,
        string calldata name,
        string calldata metadataURI
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(account != address(0), "Invalid address");
        require(!hasRole(role, account), "Already registered");

        _grantRole(role, account);

        Stakeholder storage existing = stakeholders[account];
        if (existing.registeredAt == 0) {
            stakeholderList.push(account);
        }
        stakeholders[account] = Stakeholder({
            name: name,
            metadataURI: metadataURI,
            isActive: true,
            registeredAt: block.timestamp
        });

        emit StakeholderRegistered(account, role, name, block.timestamp);
    }

    function deactivateStakeholder(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(stakeholders[account].registeredAt != 0, "Unknown stakeholder");
        stakeholders[account].isActive = false;
        emit StakeholderDeactivated(account, block.timestamp);
    }

    function isActive(address account) external view returns (bool) {
        return stakeholders[account].isActive;
    }

    function getStakeholderCount() external view returns (uint256) {
        return stakeholderList.length;
    }
}
