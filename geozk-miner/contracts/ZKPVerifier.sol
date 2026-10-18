// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IRegionProofVerifier {
    function verifyProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[6] calldata pubSignals
    ) external view returns (bool);
}
