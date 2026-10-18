// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract MockRegionProofVerifier {
    bool public shouldVerify = true;

    function setShouldVerify(bool value) external {
        shouldVerify = value;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[6] calldata
    ) external view returns (bool) {
        return shouldVerify;
    }
}
