const { execSync } = require("child_process");

function main() {
  execSync("bash circuits/compile-circuits.sh", { stdio: "inherit" });
}

main();
