import { describe, expect, it } from 'vitest'

describe('stripe routes module', () => {
  it('loads the stripe routes plugin', async () => {
    const module = await import('../../server/src/routes/stripe')

    expect(typeof module.stripeRoutes).toBe('function')
  })
})
