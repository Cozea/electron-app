import { describe, expect, it } from 'vitest'

import {
  applyDevServerPortOverride,
  applyDevServerPortPlaceholder,
} from '../../apps/desktop/electron/services/devServerCommandPortOverride'

describe('dev-server command port brokerage', () => {
  it('substitutes every case-insensitive port placeholder', () => {
    expect(
      applyDevServerPortPlaceholder(
        'python3 -m http.server {port} --bind 127.0.0.1 --label {PORT}',
        4312,
      ),
    ).toBe('python3 -m http.server 4312 --bind 127.0.0.1 --label 4312')
  })

  it.each([
    ['npm run dev', 'npm run dev -- --port 5199'],
    ['pnpm run dev', 'pnpm run dev --port 5199'],
    ['bun run dev', 'bun run dev --port 5199'],
    ['yarn dev', 'yarn dev --port 5199'],
  ])('forwards framework arguments correctly for %s', (command, expected) => {
    expect(applyDevServerPortOverride({
      command: applyDevServerPortPlaceholder(command, 5199),
      framework: 'vite-react',
      port: 5199,
    })).toBe(expected)
  })

  it('replaces a stale pnpm separator instead of forwarding it to Next', () => {
    expect(applyDevServerPortOverride({
      command: 'pnpm run dev -- --port 3000',
      framework: 'nextjs',
      port: 5199,
    })).toBe('pnpm run dev --port 5199')
  })
})
