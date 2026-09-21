const { ethers } = require("hardhat");

const ADDRESSES = {
  ponsFeeEscrow: "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e",
  ponsMemeHook: "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044",
  swapRouter02: "0xcaf681a66d020601342297493863e78c959e5cb2",
  wrappedNative: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
};

async function main() {
  if (!process.env.TREASURY_ADDRESS || !process.env.TARGET_TOKEN_ADDRESS) {
    throw new Error("Set TREASURY_ADDRESS and TARGET_TOKEN_ADDRESS before running this script.");
  }

  const [deployer] = await ethers.getSigners();
  const treasury = ethers.getAddress(process.env.TREASURY_ADDRESS);
  const targetToken = ethers.getAddress(process.env.TARGET_TOKEN_ADDRESS);
  const poolFee = Number(process.env.UNISWAP_POOL_FEE || "10000");
  const Adapter = await ethers.getContractFactory("ClaimToRBLXAdapter");
  const adapter = await Adapter.deploy(
    deployer.address,
    ADDRESSES.ponsFeeEscrow,
    ADDRESSES.ponsMemeHook,
    ADDRESSES.swapRouter02,
    ADDRESSES.wrappedNative,
    targetToken,
    treasury,
    poolFee,
  );

  await adapter.waitForDeployment();
  console.log("ClaimToRBLXAdapter:", await adapter.getAddress());
  console.log("Owner:", deployer.address);
  console.log("Treasury:", treasury);
  console.log("Target token:", targetToken);
  console.log("Pool fee:", poolFee);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
