import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// O electron-vite compila três alvos com convenções de pasta:
//   src/main      -> out/main      (processo principal, Node.js)
//   src/preload   -> out/preload   (ponte segura entre Node e a interface)
//   src/renderer  -> out/renderer  (interface React, roda no Chromium)
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
    // O electron-vite não minifica por padrão. Minificar reduz o JS que o
    // Chromium precisa ler e compilar a cada abertura do app.
    build: { minify: 'esbuild' },
  },
})
