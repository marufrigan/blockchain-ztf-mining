const fs = require("fs");
const path = require("path");

const ADDR_FILE = path.join(__dirname, "..", "data", "deployed-addresses.json");

function writeJSON(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function saveAddresses(addresses) {
  writeJSON(ADDR_FILE, addresses);
}

function loadAddresses() {
  if (!fs.existsSync(ADDR_FILE)) throw new Error("Missing deployed-addresses.json. Run scripts/01_deploy.js first.");
  return readJSON(ADDR_FILE);
}

module.exports = {
  writeJSON,
  readJSON,
  saveAddresses,
  loadAddresses
};
