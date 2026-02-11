// AI Gateway endpoint:
// - In development, default to local server for easy testing.
// - In production builds, default to hosted gateway if not explicitly configured.
const DEV_DEFAULT_AI_API_URL = '/ai/chat'
const PROD_DEFAULT_AI_API_URL = 'https://crosscode-auth-gateway-production.up.railway.app/ai/chat'

const configuredAiApiUrl = import.meta.env.VITE_AI_API_URL

// If explicitly configured, always use it (Railway is primary in this app).
const resolvedDevAiApiUrl = configuredAiApiUrl || DEV_DEFAULT_AI_API_URL

export const AI_API_URL = import.meta.env.DEV
  ? resolvedDevAiApiUrl
  : (configuredAiApiUrl || PROD_DEFAULT_AI_API_URL)
export const AI_BASE_URL = AI_API_URL.replace(/\/chat$/, '')
