// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./StakeholderRegistry.sol";
import "./ZKPVerifier.sol";

/// @title GeoZK-Miner core contract
/// @notice Region-private provenance and auditor-governed reacquisition for conflict-mineral batches.
contract GeoZKMiner is ReentrancyGuard {
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
        address custodian;
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
        BatchStatus statusAtRequest;
        ReacquisitionDecision decision;
        uint256 requestedAt;
        uint256 resolvedAt;
        bool exists;
    }

    mapping(bytes32 => MineralBatch) public batches;
    mapping(bytes32 => ReacquisitionRequest) public reacquisitions;
    mapping(bytes32 => bytes32[]) public batchHistory;
    mapping(bytes32 => bool) public approvedRegions;
    mapping(bytes32 => bool) public commitmentUsed;
    uint256 private batchCounter;
    uint256 private requestCounter;

    event RegionApproved(bytes32 indexed regionHash, address indexed approver, uint256 timestamp);
    event RegionRevoked(bytes32 indexed regionHash, address indexed revoker, uint256 timestamp);
    event BatchCreated(
        bytes32 indexed batchId,
        address indexed createdBy,
        MineralType mineralType,
        bytes32 certificationHash,
        bytes32 geoCommitment,
        bytes32 approvedRegionHash,
        uint256 timestamp
    );
    event ZKPVerified(
        bytes32 indexed batchId,
        address indexed verifier,
        bool result,
        uint256 verifierGasUsed,
        uint256 timestamp
    );
    event BatchStatusUpdated(
        bytes32 indexed batchId,
        BatchStatus oldStatus,
        BatchStatus newStatus,
        address indexed updatedBy,
        uint256 timestamp
    );
    event CustodyTransferred(
        bytes32 indexed batchId,
        address indexed from,
        address indexed to,
        string location,
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
        bool originValid,
        bool complianceValid,
        uint256 timestamp
    );

    modifier onlyActiveRole(bytes32 role) {
        require(registry.hasRole(role, msg.sender), "Unauthorized role");
        require(registry.isActive(msg.sender), "Inactive stakeholder");
        _;
    }

    modifier batchExists(bytes32 batchId) {
        require(batches[batchId].createdAt != 0, "Batch does not exist");
        _;
    }

    constructor(address registryAddress, address verifierAddress) {
        require(registryAddress != address(0) && verifierAddress != address(0), "Zero address");
        registry = StakeholderRegistry(registryAddress);
        verifier = IRegionProofVerifier(verifierAddress);
    }

    // ------------------------------------------------------------------
    // Region governance
    // ------------------------------------------------------------------

    function approveRegion(bytes32 regionHash) external onlyActiveRole(registry.AUDITOR_ROLE()) {
        require(!approvedRegions[regionHash], "Region already approved");
        approvedRegions[regionHash] = true;
        emit RegionApproved(regionHash, msg.sender, block.timestamp);
    }

    function revokeRegion(bytes32 regionHash) external onlyActiveRole(registry.AUDITOR_ROLE()) {
        require(approvedRegions[regionHash], "Region not approved");
        approvedRegions[regionHash] = false;
        emit RegionRevoked(regionHash, msg.sender, block.timestamp);
    }

    // ------------------------------------------------------------------
    // Batch creation and region-based ZKP verification
    // ------------------------------------------------------------------

    function createBatch(
        MineralType mineralType,
        bytes32 certificationHash,
        bytes32 geoCommitment,
        bytes32 approvedRegionHash,
        string calldata metadataURI
    ) external onlyActiveRole(registry.MINE_ROLE()) nonReentrant returns (bytes32) {
        require(approvedRegions[approvedRegionHash], "Region not approved");
        require(certificationHash != bytes32(0), "Missing certification hash");
        require(geoCommitment != bytes32(0), "Missing geo commitment");
        // A fresh commitment per batch binds each Groth16 proof to exactly one batch.
        require(!commitmentUsed[geoCommitment], "Commitment already used");
        commitmentUsed[geoCommitment] = true;

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
            custodian: msg.sender,
            zkProofVerified: false,
            status: BatchStatus.CREATED,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            metadataURI: metadataURI
        });

        emit BatchCreated(
            batchId,
            msg.sender,
            mineralType,
            certificationHash,
            geoCommitment,
            approvedRegionHash,
            block.timestamp
        );
        return batchId;
    }

    function verifyAndRegisterBatch(
        bytes32 batchId,
        uint256[2] calldata proofA,
        uint256[2][2] calldata proofB,
        uint256[2] calldata proofC,
        uint256[6] calldata publicSignals
    ) external onlyActiveRole(registry.AUDITOR_ROLE()) batchExists(batchId) nonReentrant {
        MineralBatch storage batch = batches[batchId];
        require(batch.status == BatchStatus.CREATED, "Invalid status");
        // Public signal order: [minX, maxX, minY, maxY, regionHash, commitment]
        require(bytes32(publicSignals[4]) == batch.approvedRegionHash, "Region mismatch");
        require(bytes32(publicSignals[5]) == batch.geoCommitment, "Commitment mismatch");
        require(approvedRegions[batch.approvedRegionHash], "Region not approved");

        uint256 gasStart = gasleft();
        bool isValid = verifier.verifyProof(proofA, proofB, proofC, publicSignals);
        uint256 verifierGasUsed = gasStart - gasleft();
        require(isValid, "ZKP verification failed");

        batch.zkProofVerified = true;
        batch.status = BatchStatus.ZKP_VERIFIED;
        batch.updatedAt = block.timestamp;
        batchHistory[batchId].push(
            keccak256(abi.encodePacked(BatchStatus.CREATED, BatchStatus.ZKP_VERIFIED, msg.sender, block.timestamp))
        );

        emit ZKPVerified(batchId, msg.sender, true, verifierGasUsed, block.timestamp);
        emit BatchStatusUpdated(batchId, BatchStatus.CREATED, BatchStatus.ZKP_VERIFIED, msg.sender, block.timestamp);
    }

    // ------------------------------------------------------------------
    // Lifecycle and custody progression
    // ------------------------------------------------------------------

    /// @dev Forward-only lifecycle: ZKP_VERIFIED -> IN_TRANSIT -> AT_SMELTER -> PROCESSED
    ///      -> AT_MANUFACTURER -> COMPLETED. Unverified batches cannot progress.
    function _requiredRole(BatchStatus oldStatus, BatchStatus newStatus) internal view returns (bytes32) {
        if (oldStatus == BatchStatus.ZKP_VERIFIED && newStatus == BatchStatus.IN_TRANSIT) {
            return registry.LOGISTICS_ROLE();
        }
        if (oldStatus == BatchStatus.IN_TRANSIT && newStatus == BatchStatus.AT_SMELTER) {
            return registry.SMELTER_ROLE();
        }
        if (oldStatus == BatchStatus.AT_SMELTER && newStatus == BatchStatus.PROCESSED) {
            return registry.SMELTER_ROLE();
        }
        if (oldStatus == BatchStatus.PROCESSED && newStatus == BatchStatus.AT_MANUFACTURER) {
            return registry.MANUFACTURER_ROLE();
        }
        if (oldStatus == BatchStatus.AT_MANUFACTURER && newStatus == BatchStatus.COMPLETED) {
            return registry.MANUFACTURER_ROLE();
        }
        revert("Invalid lifecycle transition");
    }

    function updateBatchStatus(
        bytes32 batchId,
        BatchStatus newStatus,
        string calldata location
    ) external batchExists(batchId) nonReentrant {
        MineralBatch storage batch = batches[batchId];
        BatchStatus oldStatus = batch.status;
        bytes32 role = _requiredRole(oldStatus, newStatus);
        require(registry.hasRole(role, msg.sender), "Unauthorized role");
        require(registry.isActive(msg.sender), "Inactive stakeholder");

        address previousCustodian = batch.custodian;
        batch.status = newStatus;
        batch.custodian = msg.sender;
        batch.updatedAt = block.timestamp;
        batchHistory[batchId].push(keccak256(abi.encodePacked(oldStatus, newStatus, msg.sender, block.timestamp)));

        emit BatchStatusUpdated(batchId, oldStatus, newStatus, msg.sender, block.timestamp);
        emit CustodyTransferred(batchId, previousCustodian, msg.sender, location, block.timestamp);
    }

    // ------------------------------------------------------------------
    // Reacquisition governance
    // ------------------------------------------------------------------

    function requestReacquisition(
        bytes32 batchId,
        string calldata reason
    ) external batchExists(batchId) nonReentrant returns (bytes32) {
        require(
            registry.hasRole(registry.SMELTER_ROLE(), msg.sender) ||
                registry.hasRole(registry.MANUFACTURER_ROLE(), msg.sender),
            "Unauthorized role"
        );
        require(registry.isActive(msg.sender), "Inactive stakeholder");
        require(bytes(reason).length > 0, "Missing reason");

        MineralBatch storage batch = batches[batchId];
        BatchStatus current = batch.status;
        require(
            current == BatchStatus.AT_SMELTER ||
                current == BatchStatus.PROCESSED ||
                current == BatchStatus.AT_MANUFACTURER ||
                current == BatchStatus.COMPLETED,
            "Invalid batch status for reacquisition"
        );

        requestCounter += 1;
        bytes32 requestId = keccak256(abi.encodePacked(batchId, msg.sender, block.timestamp, requestCounter));

        reacquisitions[requestId] = ReacquisitionRequest({
            requestId: requestId,
            batchId: batchId,
            requester: msg.sender,
            reason: reason,
            statusAtRequest: current,
            decision: ReacquisitionDecision.NONE,
            requestedAt: block.timestamp,
            resolvedAt: 0,
            exists: true
        });

        batch.status = BatchStatus.REACQUISITION_REQUESTED;
        batch.updatedAt = block.timestamp;
        batchHistory[batchId].push(
            keccak256(abi.encodePacked(current, BatchStatus.REACQUISITION_REQUESTED, msg.sender, block.timestamp))
        );

        emit BatchStatusUpdated(batchId, current, BatchStatus.REACQUISITION_REQUESTED, msg.sender, block.timestamp);
        emit ReacquisitionRequested(requestId, batchId, msg.sender, reason, block.timestamp);
        return requestId;
    }

    /// @notice Resolves a reacquisition request with the decision rule
    ///         D = APPROVED if origin valid and compliance failed,
    ///             REJECTED if origin invalid,
    ///             AUDIT_REQUIRED otherwise.
    /// @dev VerifyOrigin is derived on-chain from the stored ZKP result and the current
    ///      approval of the batch's region. VerifyCompliance is the auditor's attestation;
    ///      a certificate-specific ZKP for this input is future work.
    function resolveReacquisition(
        bytes32 requestId,
        bool complianceValid
    ) external onlyActiveRole(registry.AUDITOR_ROLE()) nonReentrant returns (ReacquisitionDecision) {
        ReacquisitionRequest storage req = reacquisitions[requestId];
        require(req.exists, "Request does not exist");
        require(req.decision == ReacquisitionDecision.NONE, "Already resolved");

        MineralBatch storage batch = batches[req.batchId];
        bool originValid = batch.zkProofVerified && approvedRegions[batch.approvedRegionHash];

        ReacquisitionDecision decision;
        BatchStatus newStatus;
        if (!originValid) {
            decision = ReacquisitionDecision.REJECTED;
            newStatus = BatchStatus.REJECTED;
        } else if (!complianceValid) {
            decision = ReacquisitionDecision.APPROVED;
            newStatus = BatchStatus.REACQUIRED;
        } else {
            decision = ReacquisitionDecision.AUDIT_REQUIRED;
            newStatus = BatchStatus.AUDIT_REQUIRED;
        }

        req.decision = decision;
        req.resolvedAt = block.timestamp;
        BatchStatus oldStatus = batch.status;
        batch.status = newStatus;
        batch.updatedAt = block.timestamp;
        batchHistory[req.batchId].push(keccak256(abi.encodePacked(oldStatus, newStatus, msg.sender, block.timestamp)));

        emit BatchStatusUpdated(req.batchId, oldStatus, newStatus, msg.sender, block.timestamp);
        emit ReacquisitionResolved(
            requestId,
            req.batchId,
            decision,
            msg.sender,
            originValid,
            complianceValid,
            block.timestamp
        );
        return decision;
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

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
