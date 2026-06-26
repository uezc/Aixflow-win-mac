import React from 'react';
import { createRoot } from 'react-dom/client';
import { AdminPage } from './AdminPage';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <AdminPage />
    </React.StrictMode>,
  );
}
