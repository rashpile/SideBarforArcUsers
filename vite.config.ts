import { defineConfig } from 'vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'

const FIXED_NAME_ENTRIES = ['background', 'switcherOverlay', 'searchPopupFrame'];

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        sidepanel: 'index.html',
        note: 'note.html',
        search: 'search.html',
        background: resolve(__dirname, 'src/background.ts'),
        switcherOverlay: resolve(__dirname, 'src/switcherOverlay.ts'),
        searchPopupFrame: resolve(__dirname, 'src/searchPopupFrame.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) =>
        {
          // Output background.js at root level for service worker, and the
          // switcher and search frame scripts at fixed names for chrome.scripting
          // and switcher.html
          if (FIXED_NAME_ENTRIES.includes(chunkInfo.name))
          {
            return `${chunkInfo.name}.js`;
          }
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
})
