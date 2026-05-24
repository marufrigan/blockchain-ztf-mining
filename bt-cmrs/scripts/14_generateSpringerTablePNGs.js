/**
 * One-command generator for Springer-style table PNGs (Table 1–7).
 *
 * This runs sequentially to avoid races:
 *  1) Export table/springer_tables_data.json
 *  2) Render PNGs into table/
 *
 * Run:
 *   node scripts/14_generateSpringerTablePNGs.js
 *
 * Notes:
 * - Assumes a local JSON-RPC at http://127.0.0.1:8545 for localhost exports.
 * - For Sepolia, run the export script separately via Hardhat with that network.
 */
const { execSync } = require("child_process");
const path = require("path");

function run(cmd, cwd) {
  execSync(cmd, { stdio: "inherit", cwd });
}

function main() {
  const root = path.join(__dirname, "..");

  // Always export first (localhost).
  run("./node_modules/.bin/hardhat run scripts/13_exportSpringerTablesData.js --network localhost", root);

  // Then render images.
  run("python3 table/generate_springer_table_images.py", root);
}

main();

