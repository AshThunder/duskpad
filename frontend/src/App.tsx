// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppProvider, useApp } from './state/AppContext';
import { IS_LOCAL } from './lib/config';
import { WalletProvider } from './state/WalletContext';
import { VaultProvider } from './state/VaultContext';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Home } from './pages/Home';
import { Explore } from './pages/Explore';
import { HowItWorks } from './pages/HowItWorks';
import { SaleDetail } from './pages/SaleDetail';
import { SaleReport } from './pages/SaleReport';
import { CreateSale } from './pages/CreateSale';
import { Dashboard } from './pages/Dashboard';
import { Credential } from './pages/Credential';
import { Platform } from './pages/Platform';
import { Setup } from './pages/Setup';

export default function App() {
  return (
    <AppProvider>
      <WalletProvider>
        <VaultProvider>
          <BrowserRouter>
            <Toaster position="top-right" richColors closeButton />
            <Navbar />
            <main className="max-w-page mx-auto px-4 md:px-10 py-10 md:py-14">
              <SetupBanner />
              <Boundary>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/explore" element={<Explore />} />
                <Route path="/how-it-works" element={<HowItWorks />} />
                <Route path="/sale/:address" element={<SaleDetail />} />
                <Route path="/sale/:address/report" element={<SaleReport />} />
                <Route path="/create" element={<CreateSale />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/credential" element={<Credential />} />
                <Route path="/platform" element={<Platform />} />
                <Route path="/setup" element={<Setup />} />
                <Route path="*" element={<div className="text-center py-24"><h1 className="font-display text-display-md">Not found</h1></div>} />
              </Routes>
              </Boundary>
            </main>
            <Footer />
          </BrowserRouter>
        </VaultProvider>
      </WalletProvider>
    </AppProvider>
  );
}

function Boundary({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}

/** Public networks start without a tUSD deployment; point the operator at the one-time setup. */
function SetupBanner() {
  const { network, networkError } = useApp();
  const { pathname } = useLocation();
  if (IS_LOCAL || network || !networkError || pathname === '/setup') return null;
  return (
    <div className="mb-8 rounded-2xl border border-[#c9a74d]/50 bg-butter/60 px-4 py-3 text-[14px] text-[#503d00]" role="status" data-testid="setup-banner">
      DuskPad is not set up on this network yet (no tUSD contract recorded). <Link className="underline font-bold" to="/setup">Open the one-time setup</Link>.
    </div>
  );
}
