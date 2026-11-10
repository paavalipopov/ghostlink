import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const local = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  root: local('./src/prototype'),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@renderer': local('./src/renderer/src') } },
  server: { host: 'localhost', port: 1420, strictPort: true },
  build: {
    outDir: local('./dist/tauri-prototype-ui'),
    emptyOutDir: true,
    rollupOptions: {
      input: [
        local('./src/prototype/index.html'),
        local('./src/prototype/overlay.html'),
        local('./src/prototype/picker.html'),
        local('./src/prototype/test-pad.html'),
        local('./src/prototype/pick-marker.html')
      ]
    }
  }
})
