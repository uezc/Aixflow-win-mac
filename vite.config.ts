import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/** 与主进程 `VITE_DEV_SERVER_PORT` 默认一致；Windows 上 5173 常落入保留段导致 EACCES */
const DEFAULT_VITE_DEV_PORT = 5274;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const devPort = Number(env.VITE_DEV_SERVER_PORT) || DEFAULT_VITE_DEV_PORT;

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@pricing': path.resolve(__dirname, './pricing'),
      },
    },
    base: './',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          aixflowAdmin: path.resolve(__dirname, 'manage-my-aixflow-content.html'),
          /** 静态官网落地页（public/index.html） */
          aixflowLanding: path.resolve(__dirname, 'public/index.html'),
          /** 充值套餐公示页（支付宝电脑网站支付合规） */
          aixflowRecharge: path.resolve(__dirname, 'public/recharge.html'),
        },
      },
    },
    server: {
      port: devPort,
      strictPort: false, // 若仍不可用则自动尝试下一端口（主进程轮询同一默认端口）
    },
  };
});
