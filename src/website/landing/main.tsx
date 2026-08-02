import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { SiteLocaleProvider } from './lib/siteLocale';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SiteLocaleProvider>
      <App />
    </SiteLocaleProvider>
  </React.StrictMode>,
);
