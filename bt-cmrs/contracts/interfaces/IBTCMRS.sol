// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IBTCMRS {
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
}
