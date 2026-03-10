// AI Gateway base endpoint:
// - Default to the hosted gateway unless explicitly overridden.
// - Localhost should only be used for services intentionally run locally.
// Compatibility: if VITE_AI_API_URL ends with /chat, normalize it to /ai base.
const DEFAULT_AI_BASE_URL = 'https://api.cozea.app/ai'

const RAW_AI_API_URL = import.meta.env.VITE_AI_API_URL || DEFAULT_AI_BASE_URL

export const AI_BASE_URL = RAW_AI_API_URL.replace(/\/chat\/?$/, '')
