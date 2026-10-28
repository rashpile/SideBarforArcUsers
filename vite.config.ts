import { defineConfig } from 'vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        sidepanel: 'index.html',
        background: resolve(__dirname, 'src/background.ts'),
        switcherOverlay: resolve(__dirname, 'src/switcherOverlay.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) =>
        {
          // Output background.js at root level for service worker, and the
          // switcher script at a fixed name for chrome.scripting and switcher.html
          if (chunkInfo.name === 'background' || chunkInfo.name === 'switcherOverlay')
          {
            return `${chunkInfo.name}.js`;
          }
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
})
