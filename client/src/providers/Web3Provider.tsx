import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import type { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import {
  REOWN_PROJECT_ID,
  robinhoodNetwork,
  wagmiAdapter,
  wagmiConfig,
} from "@/lib/web3";

const queryClient = new QueryClient();

// Initialise Reown AppKit once at module load. It owns the connect modal,
// wallet discovery, and WalletConnect session while wagmi holds the state.
createAppKit({
  adapters: [wagmiAdapter],
  networks: [robinhoodNetwork],
  defaultNetwork: robinhoodNetwork,
  projectId: REOWN_PROJECT_ID,
  metadata: {
    name: "Museblox",
    description:
      "Launch tokens on Pons V2 with a native ETH pair and loop creator fees into Robux.",
    url: typeof window !== "undefined" ? window.location.origin : "https://museblox.app",
    icons: ["/images/museblox-logo.png"],
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
  themeMode: "dark",
  themeVariables: {
    "--w3m-accent": "#ff7a1f",
    "--w3m-border-radius-master": "2px",
  },
});

export function Web3Provider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
