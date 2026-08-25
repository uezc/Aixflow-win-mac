import React from 'react';
import ReactDOM from 'react-dom/client';
import { GlassInstallerApp } from './GlassInstallerApp';
import '../../website/landing/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GlassInstallerApp />
  </React.StrictMode>,
);
