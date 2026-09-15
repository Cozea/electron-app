import { describe, expect, it } from 'vitest'

import {
  isSentryDsnLike,
  resolveSampleRate,
  resolveSentryEnvironment,
  scrubSentryEvent,
  scrubSentryText,
  scrubSentryUrl,
} from '@shared/sentryCommon'

describe('Sentry privacy scrubbing', () => {
  it('collapses home directories to ~', () => {
    expect(scrubSentryText("ENOENT: no such file '/Users/kelyan/Developer/Cozea/x'")).toBe(
      "ENOENT: no such file '~/Developer/Cozea/x'",
    )
    expect(scrubSentryText('Failed at C:\\Users\\kelyan\\AppData\\x')).toBe('Failed at ~\\AppData\\x')
    expect(scrubSentryText('plain message without paths')).toBe('plain message without paths')
  })

  it('redacts credential-like query pairs but keeps the URL shape', () => {
    expect(scrubSentryUrl('https://api.cozea.app/ai?model=m1&token=abc123')).toBe(
      'https://api.cozea.app/ai?model=m1&token=[redacted]',
    )
    expect(scrubSentryUrl('https://x.test/cb?code=authcode&state=zzz')).toBe(
      'https://x.test/cb?code=[redacted]&state=[redacted]',
    )
    expect(scrubSentryUrl('https://x.test/a?b=c')).toBe('https://x.test/a?b=c')
    expect(scrubSentryUrl('https://x.test/?monkey=business&postcode=123')).toBe(
      'https://x.test/?monkey=business&postcode=123',
    )
    expect(scrubSentryUrl('https://x.test/?clientCode=abc')).toBe('https://x.test/?clientCode=[redacted]')
  })

  it('drops token-bearing hash fragments but keeps route hashes', () => {
    expect(scrubSentryUrl('file:///app/index.html#/settings/appearance')).toBe(
      'file:///app/index.html#/settings/appearance',
    )
    expect(scrubSentryUrl('https://x.test/cb#access_token=abc')).toBe('https://x.test/cb#[redacted]')
  })

  it('scrubs event messages, exceptions, filenames, requests, and breadcrumbs', () => {
    const event = scrubSentryEvent({
      message: "crash at /Users/kelyan/a",
      exception: {
        values: [
          {
            value: 'bad key=secret',
            stacktrace: { frames: [{ filename: '/Users/kelyan/b.js' }, { lineno: 3 }] },
          },
        ],
      },
      request: { url: 'https://x.test/?api_key=k' },
      breadcrumbs: [{ message: 'open /Users/kelyan/c', data: { url: 'https://x.test/?token=t' } }],
    })
    expect(event.message).toBe('crash at ~/a')
    const value = (
      event.exception as { values: Array<{ value: string; stacktrace: { frames: Array<{ filename?: string }> } }> }
    ).values[0]
    expect(value?.value).toBe('bad key=[redacted]')
    expect(value?.stacktrace.frames[0]?.filename).toBe('~/b.js')
    expect((event.request as { url: string }).url).toBe('https://x.test/?api_key=[redacted]')
    const crumb = (event.breadcrumbs as Array<{ message: string; data: { url: string } }>)[0]
    expect(crumb?.message).toBe('open ~/c')
    expect(crumb?.data.url).toBe('https://x.test/?token=[redacted]')
  })

  it('tolerates malformed event shapes without throwing', () => {
    expect(() => scrubSentryEvent({})).not.toThrow()
    expect(() => scrubSentryEvent({ exception: { values: [null, 42, {}] } })).not.toThrow()
    expect(() => scrubSentryEvent({ breadcrumbs: [null] })).not.toThrow()
  })
})

describe('Sentry configuration helpers', () => {
  it('validates DSN shape', () => {
    expect(isSentryDsnLike('https://abc@o123.ingest.sentry.io/456')).toBe(true)
    for (const bad of [undefined, '', 'not-a-url', 'http://x@y/1', 'https://no-at-sign/1']) {
      expect(isSentryDsnLike(bad)).toBe(false)
    }
  })

  it('clamps sample rates with dev/prod defaults', () => {
    expect(resolveSampleRate(undefined, true, 1, 0.1)).toBe(1)
    expect(resolveSampleRate('', false, 1, 0.1)).toBe(0.1)
    expect(resolveSampleRate('0.5', false, 1, 0.1)).toBe(0.5)
    expect(resolveSampleRate('2', true, 1, 0.1)).toBe(1)
    expect(resolveSampleRate('nope', false, 1, 0.1)).toBe(0.1)
  })

  it('prefers explicit environment labels', () => {
    expect(resolveSentryEnvironment('canary', false)).toBe('canary')
    expect(resolveSentryEnvironment(undefined, true)).toBe('development')
    expect(resolveSentryEnvironment('  ', false)).toBe('production')
  })
})
