require("@nomicfoundation/hardhat-toolbox");

const networks = {};
if (process.env.ROBINHOOD_RPC_URL && process.env.DEPLOYER_PRIVATE_KEY) {
  networks.robinhood = {
    url: process.env.ROBINHOOD_RPC_URL,
    chainId: 4663,
    accounts: [process.env.DEPLOYER_PRIVATE_KEY],
  };
}

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 500 },
      viaIR: true,
    },
  },
  networks,
};
