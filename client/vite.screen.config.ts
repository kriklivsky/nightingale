import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: path.resolve(__dirname, 'screen'),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../screen-dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        sender: path.resolve(__dirname, 'screen/index.html'),
      },
    },
  },
});
