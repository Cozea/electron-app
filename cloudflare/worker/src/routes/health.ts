import { jsonResponse } from '../lib/protocol'

export function handleHealth(origin?: string | null): Response {
  return jsonResponse({
    ok: true,
    service: 'cozea-collab-worker',
    now: Date.now(),
  }, undefined, origin)
}
