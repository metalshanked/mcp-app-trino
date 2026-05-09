import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  root: 'src/preview',
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: '../../dist/preview',
    emptyOutDir: true,
    assetsInlineLimit: 100000000
  }
});
