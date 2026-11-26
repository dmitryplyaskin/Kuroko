import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const outDir = fileURLToPath(new URL('../../dist/web', import.meta.url));

export default defineConfig(({ mode }) => {
  const { PORT = '3000', HOST = '127.0.0.1' } = loadEnv(mode, workspaceRoot, ['PORT', 'HOST']);
  const apiHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST === '::' ? '::1' : HOST;
  const proxyHost = apiHost.includes(':') ? `[${apiHost}]` : apiHost;

  return {
    plugins: [react()],
    envDir: workspaceRoot,
    server: {
      port: 5173,
      strictPort: true,
      open: true,
      proxy: {
        '/api': `http://${proxyHost}:${Number(PORT)}`,
      },
    },
    build: {
      outDir,
      emptyOutDir: true,
    },
  };
});
