// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./StakeholderRegistry.sol";
import "./ZKPVerifier.sol";

contract BTCMRS is ReentrancyGuard {
    StakeholderRegistry public registry;
    IRegionProofVerifier public verifier;

    enum MineralType {
        TIN,
        TUNGSTEN,
        TANTALUM,
        GOLD,
        COBALT
    }

    enum BatchStatus {
        CREATED,
        ZKP_VERIFIED,
        IN_TRANSIT,
        AT_SMELTER,
        PROCESSED,
        AT_MANUFACTURER,
        COMPLETED,
        REACQUISITION_REQUESTED,
        REACQUIRED,
        REJECTED,
        AUDIT_REQUIRED
    }

    enum ReacquisitionDecision {
        NONE,
        APPROVED,
        REJECTED,
        AUDIT_REQUIRED
    }

    struct MineralBatch {
        bytes32 batchId;
        MineralType mineralType;
        uint256 extractionDate;
        bytes32 certificationHash;
        bytes32 geoCommitment;
        bytes32 approvedRegionHash;
        address createdBy;
        bool zkProofVerified;
        BatchStatus status;
        uint256 createdAt;
        uint256 updatedAt;
        string metadataURI;
    }

    struct ReacquisitionRequest {
        bytes32 requestId;
        bytes32 batchId;
        address requester;
        string reason;
        ReacquisitionDecision decision;
        uint256 requestedAt;
        uint256 resolvedAt;
        bool exists;
    }

    mapping(bytes32 => MineralBatch) public batches;
    mapping(bytes32 => ReacquisitionRequest) public reacquisitions;
    mapping(bytes32 => bytes32[]) public batchHistory;
    mapping(bytes32 => bool) public approvedRegions;
    uint256 private batchCounter;
    uint256 private requestCounter;

    event RegionApproved(bytes32 indexed regionHash, address indexed approver, uint256 timestamp);
    event BatchCreated(
        bytes32 indexed batchId,
        address indexed createdBy,
        MineralType mineralType,
        bytes32 geoCommitment,
        uint256 timestamp
    );
    event ZKPVerified(
        bytes32 indexed batchId,
        address indexed verifier,
        bool result,
        uint256 gasUsed,
        uint256 timestamp
    );
    event BatchStatusUpdated(
        bytes32 indexed batchId,
        BatchStatus oldStatus,
        BatchStatus newStatus,
        address indexed updatedBy,
        uint256 timestamp
    );
    event ReacquisitionRequested(
        bytes32 indexed requestId,
        bytes32 indexed batchId,
        address indexed requester,
        string reason,
        uint256 timestamp
    );
    event ReacquisitionResolved(
        bytes32 indexed requestId,
        bytes32 indexed batchId,
        ReacquisitionDecision decision,
        address indexed resolver,
        uint256 timestamp
    );
    event CustodyTransferred(
        bytes32 indexed batchId,
        address indexed from,
        address indexed to,
        string location,
        uint256 timestamp
    );

    modifier onlyRole(bytes32 role) {
        require(registry.hasRole(role, msg.sender), "Unauthorized role");
        require(registry.isActive(msg.sender), "Inactive stakeholder");
        _;
    }

    modifier batchExists(bytes32 batchId) {
        require(batches[batchId].createdAt != 0, "Batch does not exist");
        _;
    }

    constructor(address registryAddress, address verifierAddress) {
        registry = StakeholderRegistry(registryAddress);
        verifier = IRegionProofVerifier(verifierAddress);
    }

    function approveRegion(bytes32 regionHash) external onlyRole(registry.AUDITOR_ROLE()) {
        approvedRegions[regionHash] = true;
        emit RegionApproved(regionHash, msg.sender, block.timestamp);
    }

    function createBatch(
        MineralType mineralType,
        bytes32 certificationHash,
        bytes32 geoCommitment,
        bytes32 approvedRegionHash,
        string calldata metadataURI
    ) external onlyRole(registry.MINE_ROLE()) nonReentrant returns (bytes32) {
        require(approvedRegions[approvedRegionHash], "Region not approved");

        batchCounter += 1;
        bytes32 batchId = keccak256(abi.encodePacked(msg.sender, block.timestamp, batchCounter));

        batches[batchId] = MineralBatch({
            batchId: batchId,
            mineralType: mineralType,
            extractionDate: block.timestamp,
            certificationHash: certificationHash,
            geoCommitment: geoCommitment,
            approvedRegionHash: approvedRegionHash,
            createdBy: msg.sender,
            zkProofVerified: false,
            status: BatchStatus.CREATED,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            metadataURI: metadataURI
        });

        emit BatchCreated(batchId, msg.sender, mineralType, geoCommitment, block.timestamp);
        return batchId;
    }

    function verifyAndRegisterBatch(
        bytes32 batchId,
        uint256[2] calldata proofA,
        uint256[2][2] calldata proofB,
        uint256[2] calldata proofC,
        uint256[6] calldata publicSignals
    ) external onlyRole(registry.AUDITOR_ROLE()) batchExists(batchId) nonReentrant {
        MineralBatch storage batch = batches[batchId];
        require(batch.status == BatchStatus.CREATED, "Invalid status");
        // Expected signal order: [minX, maxX, minY, maxY, regionHash, commitment]
        require(bytes32(publicSignals[4]) == batch.approvedRegionHash, "Region mismatch");
        require(bytes32(publicSignals[5]) == batch.geoCommitment, "Commitment mismatch");
        require(approvedRegions[bytes32(publicSignals[4])], "Region not approved");

        uint256 gasStart = gasleft();
        bool isValid = verifier.verifyProof(proofA, proofB, proofC, publicSignals);
        uint256 gasUsed = gasStart - gasleft();
        require(isValid, "ZKP verification failed");

        batch.zkProofVerified = true;
        batch.status = BatchStatus.ZKP_VERIFIED;
        batch.updatedAt = block.timestamp;

        emit ZKPVerified(batchId, msg.sender, true, gasUsed, block.timestamp);
        emit BatchStatusUpdated(batchId, BatchStatus.CREATED, BatchStatus.ZKP_VERIFIED, msg.sender, block.timestamp);
    }

    function updateBatchStatus(
        bytes32 batchId,
        BatchStatus newStatus,
        string calldata location
    ) external batchExists(batchId) nonReentrant {
        MineralBatch storage batch = batches[batchId];
        BatchStatus oldStatus = batch.status;

        if (newStatus == BatchStatus.IN_TRANSIT) {
            require(
                registry.hasRole(registry.LOGISTICS_ROLE(), msg.sender) || registry.hasRole(registry.MINE_ROLE(), msg.sender),
                "Unauthorized"
            );
        } else if (newStatus == BatchStatus.AT_SMELTER || newStatus == BatchStatus.PROCESSED) {
            require(registry.hasRole(registry.SMELTER_ROLE(), msg.sender), "Unauthorized");
        } else if (newStatus == BatchStatus.AT_MANUFACTURER || newStatus == BatchStatus.COMPLETED) {
            require(registry.hasRole(registry.MANUFACTURER_ROLE(), msg.sender), "Unauthorized");
        }

        batch.status = newStatus;
        batch.updatedAt = block.timestamp;
        batchHistory[batchId].push(keccak256(abi.encodePacked(oldStatus, newStatus, msg.sender, block.timestamp)));

        emit BatchStatusUpdated(batchId, oldStatus, newStatus, msg.sender, block.timestamp);
        emit CustodyTransferred(batchId, address(0), msg.sender, location, block.timestamp);
    }

    function requestReacquisition(
        bytes32 batchId,
        string calldata reason
    ) external batchExists(batchId) nonReentrant returns (bytes32) {
        require(
            registry.hasRole(registry.SMELTER_ROLE(), msg.sender) ||
                registry.hasRole(registry.MANUFACTURER_ROLE(), msg.sender),
            "Unauthorized"
        );

        MineralBatch storage batch = batches[batchId];
        require(
            batch.status == BatchStatus.AT_SMELTER ||
                batch.status == BatchStatus.AT_MANUFACTURER ||
                batch.status == BatchStatus.COMPLETED,
            "Invalid batch status for reacquisition"
        );

        requestCounter += 1;
        bytes32 requestId = keccak256(abi.encodePacked(batchId, msg.sender, block.timestamp, requestCounter));

        reacquisitions[requestId] = ReacquisitionRequest({
            requestId: requestId,
            batchId: batchId,
            requester: msg.sender,
            reason: reason,
            decision: ReacquisitionDecision.NONE,
            requestedAt: block.timestamp,
            resolvedAt: 0,
            exists: true
        });

        batch.status = BatchStatus.REACQUISITION_REQUESTED;
        batch.updatedAt = block.timestamp;

        emit ReacquisitionRequested(requestId, batchId, msg.sender, reason, block.timestamp);
        return requestId;
    }

    function resolveReacquisition(
        bytes32 requestId,
        ReacquisitionDecision decision
    ) external onlyRole(registry.AUDITOR_ROLE()) nonReentrant {
        ReacquisitionRequest storage req = reacquisitions[requestId];
        require(req.exists, "Request does not exist");
        require(req.decision == ReacquisitionDecision.NONE, "Already resolved");

        req.decision = decision;
        req.resolvedAt = block.timestamp;

        MineralBatch storage batch = batches[req.batchId];
        if (decision == ReacquisitionDecision.APPROVED) batch.status = BatchStatus.REACQUIRED;
        else if (decision == ReacquisitionDecision.REJECTED) batch.status = BatchStatus.REJECTED;
        else if (decision == ReacquisitionDecision.AUDIT_REQUIRED) batch.status = BatchStatus.AUDIT_REQUIRED;
        batch.updatedAt = block.timestamp;

        emit ReacquisitionResolved(requestId, req.batchId, decision, msg.sender, block.timestamp);
    }

    function getBatch(bytes32 batchId) external view returns (MineralBatch memory) {
        return batches[batchId];
    }

    function getReacquisition(bytes32 requestId) external view returns (ReacquisitionRequest memory) {
        return reacquisitions[requestId];
    }

    function getBatchHistory(bytes32 batchId) external view returns (bytes32[] memory) {
        return batchHistory[batchId];
    }

    function getBatchCount() external view returns (uint256) {
        return batchCounter;
    }

    function getReacquisitionCount() external view returns (uint256) {
        return requestCounter;
    }
}
