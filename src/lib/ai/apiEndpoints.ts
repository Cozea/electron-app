// AI Gateway endpoint:
// - In development, default to local server for easy testing.
// - In production builds, default to hosted gateway if not explicitly configured.
const DEFAULT_AI_API_URL = import.meta.env.DEV
  ? 'http://localhost:3001/ai/chat'
  : 'https://api.cozea.app/ai/chat'

export const AI_API_URL = import.meta.env.VITE_AI_API_URL || DEFAULT_AI_API_URL
export const AI_BASE_URL = AI_API_URL.replace(/\/chat$/, '')
