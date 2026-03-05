// AI Gateway base endpoint:
// - In development, default to local server for easy testing.
// - In production builds, default to hosted gateway if not explicitly configured.
// Compatibility: if VITE_AI_API_URL ends with /chat, normalize it to /ai base.
const DEFAULT_AI_BASE_URL = import.meta.env.DEV
  ? 'http://localhost:3001/ai'
  : 'https://api.cozea.app/ai'

const RAW_AI_API_URL = import.meta.env.VITE_AI_API_URL || DEFAULT_AI_BASE_URL

export const AI_BASE_URL = RAW_AI_API_URL.replace(/\/chat\/?$/, '')
