import React from 'react';
import ReactDOM from 'react-dom/client';
import { AixflowDotCanvas } from './components/AixflowDotCanvas';
import { SiteHeader } from './components/SiteHeader';
import { CopyrightBar, Footer } from './components/Footer';
import { RechargePackagesSection } from './components/RechargePackagesSection';
import { SiteLocaleProvider } from './lib/siteLocale';
import './index.css';

function RechargePage() {
  return (
    <>
      <AixflowDotCanvas />
      <SiteHeader />
      <div className="relative z-10 pb-16 pt-16 md:pt-20">
        <RechargePackagesSection />
        <Footer />
        <CopyrightBar />
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SiteLocaleProvider>
      <RechargePage />
    </SiteLocaleProvider>
  </React.StrictMode>,
);
