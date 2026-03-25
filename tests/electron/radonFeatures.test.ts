import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RADON_FEATURES,
  decodeRadonTokenPayload,
  isRadonFeatureAvailable,
  resolveRadonFeatures,
} from '../../electron/services/radon/features'

function encodeTokenPayload(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

describe('radon feature helpers', () => {
  it('decodes Radon token payloads', () => {
    const token = encodeTokenPayload({
      cp_plan: 'Starter',
      cp_features: {
        Screenshot: 'AVAILABLE',
      },
    })

    expect(decodeRadonTokenPayload(token)).toEqual({
      cp_plan: 'Starter',
      cp_features: {
        Screenshot: 'AVAILABLE',
      },
    })
  })

  it('merges explicit token features over Radon defaults', () => {
    const token = encodeTokenPayload({
      cp_plan: 'Starter',
      cp_features: {
        Screenshot: 'AVAILABLE',
        ScreenRecording: 'ADMIN_DISABLED',
      },
    })

    const resolved = resolveRadonFeatures(token)
    expect(resolved.plan).toBe('Starter')
    expect(resolved.features.Screenshot).toBe('AVAILABLE')
    expect(resolved.features.ScreenRecording).toBe('ADMIN_DISABLED')
    expect(resolved.features.ReactProfiler).toBe(DEFAULT_RADON_FEATURES.ReactProfiler)
    expect(resolved.missingFeatures).toContain('ScreenRecording')
  })

  it('treats missing feature overrides as default availability', () => {
    expect(isRadonFeatureAvailable(undefined, 'ReduxDevTools')).toBe(true)
    expect(isRadonFeatureAvailable(undefined, 'Screenshot')).toBe(false)
  })
})
