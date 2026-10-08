// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppProvider } from './state/AppContext';
import { WalletProvider } from './state/WalletContext';
import { VaultProvider } from './state/VaultContext';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { Home } from './pages/Home';
import { Explore } from './pages/Explore';
import { HowItWorks } from './pages/HowItWorks';
import { SaleDetail } from './pages/SaleDetail';
import { SaleReport } from './pages/SaleReport';
import { CreateSale } from './pages/CreateSale';
import { Dashboard } from './pages/Dashboard';
import { Credential } from './pages/Credential';
import { Platform } from './pages/Platform';

export default function App() {
  return (
    <AppProvider>
      <WalletProvider>
        <VaultProvider>
          <BrowserRouter>
            <Toaster position="top-right" richColors closeButton />
            <Navbar />
            <main className="max-w-page mx-auto px-4 md:px-10 py-10 md:py-14">
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
                <Route path="*" element={<div className="text-center py-24"><h1 className="font-display text-display-md">Not found</h1></div>} />
              </Routes>
            </main>
            <Footer />
          </BrowserRouter>
        </VaultProvider>
      </WalletProvider>
    </AppProvider>
  );
}
