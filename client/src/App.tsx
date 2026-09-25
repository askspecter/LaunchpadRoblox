import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { Web3Provider } from "./providers/Web3Provider";
import Home from "./pages/Home";

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <Web3Provider>
          <TooltipProvider>
            <Home />
            <Toaster position="bottom-right" richColors />
          </TooltipProvider>
        </Web3Provider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
