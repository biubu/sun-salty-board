import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['specs/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'dist-electron', 'release'],
    // vitest 4 default pool is `threads`; better-sqlite3's native binding
    // is more stable under `forks` on some platforms (no shared heap).
    pool: 'forks',
  },
})
