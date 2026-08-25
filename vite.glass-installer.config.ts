import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname),
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist-glass-installer/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'glass-installer.html'),
    },
  },
  server: {
    port: Number(process.env.VITE_GLASS_INSTALLER_PORT) || 5288,
    strictPort: true,
  },
});
