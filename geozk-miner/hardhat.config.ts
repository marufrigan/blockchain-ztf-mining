import { HardhatUserConfig, subtask } from "hardhat/config";
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config();

const SOLC_VERSION = "0.8.23";

// Optional offline compilation: set USE_LOCAL_SOLCJS=true to compile with the
// solc-js 0.8.23 build from node_modules (npm i --no-save solc@0.8.23) instead
// of downloading the native compiler.
if (process.env.USE_LOCAL_SOLCJS === "true") {
  subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args: any, _hre, runSuper) => {
    if (args.solcVersion === SOLC_VERSION) {
      const solc = require("solc");
      return {
        compilerPath: path.join(__dirname, "node_modules", "solc", "soljson.js"),
        isSolcJs: true,
        version: SOLC_VERSION,
        longVersion: solc.version()
      };
    }
    return runSuper();
  });
}

const config: HardhatUserConfig = {
  solidity: {
    version: SOLC_VERSION,
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    hardhat: {
      // Extra funded accounts are used by the concurrent-load experiment.
      accounts: { count: 140 }
    },
    localhost: { url: "http://127.0.0.1:8545" },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    }
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "ETH"
  },
  mocha: {
    timeout: 600000
  }
};

export default config;
