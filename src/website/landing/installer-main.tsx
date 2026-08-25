import React from 'react';
import ReactDOM from 'react-dom/client';
import { WebInstallerWizard } from './components/WebInstallerWizard';
import { SiteLocaleProvider } from './lib/siteLocale';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SiteLocaleProvider>
      <WebInstallerWizard />
    </SiteLocaleProvider>
  </React.StrictMode>,
);
