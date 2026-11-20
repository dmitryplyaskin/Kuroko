import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const outDir = fileURLToPath(new URL('../../dist/web', import.meta.url));

export default defineConfig(({ mode }) => {
  const { PORT = '3000' } = loadEnv(mode, workspaceRoot, 'PORT');

  return {
    plugins: [react()],
    envDir: workspaceRoot,
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': `http://localhost:${Number(PORT)}`,
      },
    },
    build: {
      outDir,
      emptyOutDir: true,
    },
  };
});
