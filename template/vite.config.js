import { defineConfig } from 'vite'

// `dist` is what wrangler.jsonc's assets.directory points at — keep them equal.
export default defineConfig({ build: { outDir: 'dist' } })
