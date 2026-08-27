import { describe, expect, it } from 'vitest'

import {
  parseRepoIdentity,
  repoIdentitiesMatch,
} from '../../apps/desktop/electron/workspaces/repoIdentity.ts'

describe('parseRepoIdentity', () => {
  it('parses https github remotes', () => {
    expect(parseRepoIdentity('https://github.com/acme/widgets')).toEqual({
      provider: 'github',
      fullName: 'acme/widgets',
      url: 'https://github.com/acme/widgets',
    })
  })

  it('parses repo names containing dots', () => {
    expect(parseRepoIdentity('https://github.com/vercel/next.js')).toMatchObject({
      provider: 'github',
      fullName: 'vercel/next.js',
    })
    expect(parseRepoIdentity('git@github.com:socketio/socket.io.git')).toMatchObject({
      provider: 'github',
      fullName: 'socketio/socket.io',
    })
  })

  it('parses ssh and https forms to the same identity', () => {
    const ssh = parseRepoIdentity('git@github.com:acme/widgets.git')
    const https = parseRepoIdentity('https://github.com/acme/widgets')
    expect(ssh).toMatchObject({ provider: 'github', fullName: 'acme/widgets' })
    expect(repoIdentitiesMatch(ssh, https)).toBe(true)
  })

  it('parses gitlab subgroup paths', () => {
    expect(parseRepoIdentity('https://gitlab.com/group/subgroup/repo.git')).toMatchObject({
      provider: 'gitlab',
      fullName: 'group/subgroup/repo',
    })
  })

  it('parses cozea-managed remotes by project id', () => {
    expect(parseRepoIdentity('https://sync.cozea.dev/git/proj_abc123.git')).toMatchObject({
      provider: 'cozea',
      projectId: 'proj_abc123',
    })
  })

  it('classifies GitHub/GitLab remotes whose path contains a git/ segment by host, not cozea', () => {
    // The cozea /git/<name>.git pattern must not shadow a real GitLab subgroup
    // literally named "git" (regression for repo misclassification).
    expect(parseRepoIdentity('https://gitlab.com/myteam/git/tooling.git')).toMatchObject({
      provider: 'gitlab',
      fullName: 'myteam/git/tooling',
    })
    expect(parseRepoIdentity('git@gitlab.com:myteam/git/tooling.git')).toMatchObject({
      provider: 'gitlab',
      fullName: 'myteam/git/tooling',
    })
    expect(parseRepoIdentity('https://github.com/some/git.git')).toMatchObject({
      provider: 'github',
      fullName: 'some/git',
    })
  })

  it('falls back to unknown for self-hosted remotes', () => {
    expect(parseRepoIdentity('git@git.corp.example:team/app.git')).toMatchObject({
      provider: 'unknown',
    })
  })
})

describe('repoIdentitiesMatch', () => {
  it('matches unknown-provider remotes across ssh/https spellings', () => {
    const ssh = parseRepoIdentity('git@git.corp.example:team/app.git')
    const https = parseRepoIdentity('https://git.corp.example/team/app')
    expect(repoIdentitiesMatch(ssh, https)).toBe(true)
  })

  it('does not match different repos', () => {
    const a = parseRepoIdentity('https://github.com/acme/widgets')
    const b = parseRepoIdentity('https://github.com/acme/gadgets')
    expect(repoIdentitiesMatch(a, b)).toBe(false)
  })

  it('is case-insensitive for provider full names', () => {
    const a = parseRepoIdentity('https://github.com/Acme/Widgets')
    const b = parseRepoIdentity('https://github.com/acme/widgets')
    expect(repoIdentitiesMatch(a, b)).toBe(true)
  })
})
