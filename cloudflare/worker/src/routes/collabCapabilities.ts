import type { Env } from '../types'
import { COLLAB_PROTOCOL_VERSION, jsonResponse } from '../lib/protocol'

export function getCollabCapabilities(env: Env) {
  return {
    execution: 'vm',
    languageScope: ['typescript', 'javascript', 'json', 'markdown', 'html', 'css', 'yaml', 'shell'],
    preview: true,
    terminal: true,
    deployments: false,
    yjs: true,
    protocolVersion: env.COLLAB_PROTOCOL_VERSION ?? COLLAB_PROTOCOL_VERSION,
  }
}

export function handleCollabCapabilities(env: Env): Response {
  return jsonResponse(getCollabCapabilities(env))
}
