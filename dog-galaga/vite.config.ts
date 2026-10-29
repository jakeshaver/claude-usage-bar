import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { target: 'es2020', assetsInlineLimit: 100000000, chunkSizeWarningLimit: 600 },
  server: { port: 5173, host: '127.0.0.1' },
  test: { environment: 'node', include: ['tests/**/*.test.ts', 'src/**/*.test.ts'], testTimeout: 600000 },
} as any);
