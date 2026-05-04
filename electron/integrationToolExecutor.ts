/**
 * Integration Tool Executor
 *
 * Executes CLI tools for connected integrations with credentials
 * injected as environment variables.
 */

import { spawn, type SpawnOptions } from 'node:child_process'
import * as integrationKeys from './integrationKeys'
import * as integrationCrypto from './integrationCrypto'
import { createRuntimeEnv } from './runtime/runtimeEnv'
import { getRuntimePathPrefixes } from './runtime/runtimeResolver'
import { resolveAuthorizedWorkspaceAccess, type CwdSpec } from './workspaces/authorization.ts'

// ============================================
// Types
// ============================================

interface IntegrationToolDefinition {
  /** Integration provider ID */
  provider: string
  /** Tool name as exposed to agents */
  name: string
  /** Display name */
  displayName: string
  /** CLI command to execute */
  command: string
  /** Description of what the tool does */
  description: string
  /** Credential field to env var mapping */
  envMapping: Record<string, string>
}

interface ExecuteIntegrationToolRequest {
  toolName: string
  args: string[]
  workingDir: string
  credentials: Record<string, string>
  timeout?: number
}

interface ExecuteIntegrationToolResult {
  success: boolean
  stdout?: string
  stderr?: string
  exitCode?: number | null
  timedOut?: boolean
  error?: string
}

// ============================================
// Tool Definitions
// ============================================

/**
 * Defines CLI tools available for each integration.
 * These map integration credentials to environment variables
 * that the CLI tools expect.
 */
export const INTEGRATION_TOOLS: IntegrationToolDefinition[] = [
  // GitHub
  {
    provider: 'github',
    name: 'github_cli',
    displayName: 'GitHub CLI',
    command: 'gh',
    description: 'Run GitHub CLI commands (gh)',
    envMapping: {
      accessToken: 'GH_TOKEN',
    },
  },

  // Supabase
  {
    provider: 'supabase',
    name: 'supabase_cli',
    displayName: 'Supabase CLI',
    command: 'supabase',
    description: 'Run Supabase CLI commands',
    envMapping: {
      accessToken: 'SUPABASE_ACCESS_TOKEN',
      projectUrl: 'SUPABASE_URL',
      anonKey: 'SUPABASE_ANON_KEY',
    },
  },

  // Vercel
  {
    provider: 'vercel',
    name: 'vercel_cli',
    displayName: 'Vercel CLI',
    command: 'vercel',
    description: 'Run Vercel CLI commands',
    envMapping: {
      accessToken: 'VERCEL_TOKEN',
    },
  },

  // Firebase
  {
    provider: 'firebase',
    name: 'firebase_cli',
    displayName: 'Firebase CLI',
    command: 'firebase',
    description: 'Run Firebase CLI commands',
    envMapping: {
      // Firebase uses service account JSON, needs special handling
      serviceAccountKey: 'GOOGLE_APPLICATION_CREDENTIALS_JSON',
    },
  },

  // Netlify
  {
    provider: 'netlify',
    name: 'netlify_cli',
    displayName: 'Netlify CLI',
    command: 'netlify',
    description: 'Run Netlify CLI commands',
    envMapping: {
      accessToken: 'NETLIFY_AUTH_TOKEN',
    },
  },

  // Railway
  {
    provider: 'railway',
    name: 'railway_cli',
    displayName: 'Railway CLI',
    command: 'railway',
    description: 'Run Railway CLI commands',
    envMapping: {
      apiToken: 'RAILWAY_TOKEN',
    },
  },

  // Stripe
  {
    provider: 'stripe',
    name: 'stripe_cli',
    displayName: 'Stripe CLI',
    command: 'stripe',
    description: 'Run Stripe CLI commands',
    envMapping: {
      secretKey: 'STRIPE_API_KEY',
    },
  },

  // Fly.io
  {
    provider: 'fly',
    name: 'fly_cli',
    displayName: 'Fly CLI',
    command: 'fly',
    description: 'Run Fly.io CLI commands (flyctl)',
    envMapping: {
      accessToken: 'FLY_ACCESS_TOKEN',
    },
  },

  // PlanetScale
  {
    provider: 'planetscale',
    name: 'planetscale_cli',
    displayName: 'PlanetScale CLI',
    command: 'pscale',
    description: 'Run PlanetScale CLI commands',
    envMapping: {
      serviceToken: 'PLANETSCALE_SERVICE_TOKEN',
      serviceTokenId: 'PLANETSCALE_SERVICE_TOKEN_ID',
      orgName: 'PLANETSCALE_ORG',
    },
  },

  // Neon
  {
    provider: 'neon',
    name: 'neon_cli',
    displayName: 'Neon CLI',
    command: 'neon',
    description: 'Run Neon CLI commands',
    envMapping: {
      apiKey: 'NEON_API_KEY',
    },
  },

  // AWS (for S3 and other services)
  {
    provider: 'aws',
    name: 'aws_cli',
    displayName: 'AWS CLI',
    command: 'aws',
    description: 'Run AWS CLI commands',
    envMapping: {
      accessKeyId: 'AWS_ACCESS_KEY_ID',
      secretAccessKey: 'AWS_SECRET_ACCESS_KEY',
      region: 'AWS_DEFAULT_REGION',
    },
  },

  // Cloudflare
  {
    provider: 'cloudflare',
    name: 'wrangler_cli',
    displayName: 'Wrangler CLI',
    command: 'wrangler',
    description: 'Run Cloudflare Wrangler CLI commands',
    envMapping: {
      apiToken: 'CLOUDFLARE_API_TOKEN',
      accountId: 'CLOUDFLARE_ACCOUNT_ID',
    },
  },

  // Linear
  {
    provider: 'linear',
    name: 'linear_api',
    displayName: 'Linear API',
    command: 'curl', // Linear doesn't have a CLI, so we use curl for API calls
    description: 'Make Linear API calls',
    envMapping: {
      apiKey: 'LINEAR_API_KEY',
    },
  },

  // Work OS - API-based tools (use curl for REST API calls)

  // Notion
  {
    provider: 'notion',
    name: 'notion_api',
    displayName: 'Notion API',
    command: 'curl',
    description: 'Make Notion API calls',
    envMapping: {
      apiKey: 'NOTION_API_KEY',
    },
  },

  // Airtable
  {
    provider: 'airtable',
    name: 'airtable_api',
    displayName: 'Airtable API',
    command: 'curl',
    description: 'Make Airtable API calls',
    envMapping: {
      apiKey: 'AIRTABLE_API_KEY',
      baseId: 'AIRTABLE_BASE_ID',
    },
  },

  // Monday.com
  {
    provider: 'monday',
    name: 'monday_api',
    displayName: 'Monday.com API',
    command: 'curl',
    description: 'Make Monday.com API calls',
    envMapping: {
      apiKey: 'MONDAY_API_KEY',
    },
  },

  // Asana
  {
    provider: 'asana',
    name: 'asana_api',
    displayName: 'Asana API',
    command: 'curl',
    description: 'Make Asana API calls',
    envMapping: {
      accessToken: 'ASANA_ACCESS_TOKEN',
    },
  },

  // ClickUp
  {
    provider: 'clickup',
    name: 'clickup_api',
    displayName: 'ClickUp API',
    command: 'curl',
    description: 'Make ClickUp API calls',
    envMapping: {
      apiKey: 'CLICKUP_API_KEY',
    },
  },

  // Coda
  {
    provider: 'coda',
    name: 'coda_api',
    displayName: 'Coda API',
    command: 'curl',
    description: 'Make Coda API calls',
    envMapping: {
      apiKey: 'CODA_API_KEY',
    },
  },
]

// ============================================
// Helper Functions
// ============================================

/**
 * Check if a tool name is an integration tool
 */
export function isIntegrationTool(toolName: string): boolean {
  return INTEGRATION_TOOLS.some((t) => t.name === toolName)
}

/**
 * Get tool definition by name
 */
export function getIntegrationToolDefinition(toolName: string): IntegrationToolDefinition | undefined {
  return INTEGRATION_TOOLS.find((t) => t.name === toolName)
}

/**
 * Get all tools for a specific integration provider
 */
export function getToolsForProvider(provider: string): IntegrationToolDefinition[] {
  return INTEGRATION_TOOLS.filter((t) => t.provider === provider)
}

/**
 * Build environment variables from credentials based on tool's env mapping
 */
function buildEnvFromCredentials(
  credentials: Record<string, string>,
  envMapping: Record<string, string>
): Record<string, string> {
  const env: Record<string, string> = {}

  for (const [credField, envVar] of Object.entries(envMapping)) {
    const value = credentials[credField]
    if (value !== undefined && value !== null) {
      env[envVar] = value
    }
  }

  return env
}

// ============================================
// Decrypt Credentials
// ============================================

/**
 * Decrypt integration credentials using the local keychain
 */
export async function decryptIntegrationCredentials(
  encryptedCredentials: string,
  keyId: string
): Promise<{ success: boolean; credentials?: Record<string, string>; error?: string }> {
  // Get the encryption key from keychain
  const keyResult = integrationKeys.getEncryptionKey(keyId)
  if (!keyResult.success || !keyResult.keyData) {
    return { success: false, error: keyResult.error || 'Encryption key not found in keychain' }
  }

  // Decrypt credentials
  const decryptResult = integrationCrypto.decryptCredentials(encryptedCredentials, keyResult.keyData)
  if (!decryptResult.success || !decryptResult.credentials) {
    return { success: false, error: decryptResult.error || 'Failed to decrypt credentials' }
  }

  return { success: true, credentials: decryptResult.credentials as Record<string, string> }
}

// ============================================
// Execute Tool
// ============================================

const MAX_OUTPUT_LENGTH = 60_000
const TRUNCATION_MESSAGE = '\n...output truncated...\n'

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_LENGTH) return output
  const tailLength = Math.max(0, MAX_OUTPUT_LENGTH - TRUNCATION_MESSAGE.length)
  return `${TRUNCATION_MESSAGE}${output.slice(-tailLength)}`
}

/**
 * Execute an integration CLI tool with credentials injected
 */
export async function executeIntegrationTool(
  request: ExecuteIntegrationToolRequest
): Promise<ExecuteIntegrationToolResult> {
  const toolDef = getIntegrationToolDefinition(request.toolName)
  if (!toolDef) {
    return { success: false, error: `Unknown integration tool: ${request.toolName}` }
  }

  // Build environment with credentials mapped to proper env vars
  const credEnv = buildEnvFromCredentials(request.credentials, toolDef.envMapping)

  // Merge with process env (credentials take precedence)
  const env = createRuntimeEnv(getRuntimePathPrefixes(), {
    ...process.env as Record<string, string>,
    ...credEnv,
  }) as Record<string, string>

  // Handle special case for Firebase service account JSON
  // The service account key needs to be written to a temp file
  if (toolDef.provider === 'firebase' && credEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const os = await import('node:os')

    const tempDir = os.tmpdir()
    const credPath = path.join(tempDir, `firebase-sa-${Date.now()}.json`)

    try {
      fs.writeFileSync(credPath, credEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON, 'utf-8')
      env.GOOGLE_APPLICATION_CREDENTIALS = credPath
      delete env.GOOGLE_APPLICATION_CREDENTIALS_JSON

      // Clean up temp file after a delay
      setTimeout(() => {
        try {
          fs.unlinkSync(credPath)
        } catch {
          // Ignore cleanup errors
        }
      }, 60_000) // 60 seconds
    } catch (err) {
      return {
        success: false,
        error: `Failed to write Firebase credentials: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }
    }
  }

  // Build command
  const command = toolDef.command
  const args = request.args

  const timeoutMs = request.timeout || 120_000 // Default 2 minutes

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let timeoutHandle: NodeJS.Timeout | undefined

    const spawnOptions: SpawnOptions = {
      cwd: request.workingDir,
      env,
      shell: true,
    }

    const child = spawn(command, args, spawnOptions)

    const finish = (code: number | null) => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      resolve({
        success: code === 0,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        exitCode: code,
        timedOut,
      })
    }

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => finish(code))

    child.on('error', (err) => {
      stderr += `Error: ${err.message}\n`
      finish(-1)
    })

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true
        try {
          child.kill('SIGTERM')
        } catch {
          // Ignore kill errors
        }
      }, timeoutMs)
    }
  })
}

/**
 * Execute an integration tool with encrypted credentials
 * This is the main entry point for agent tool calls
 */
export async function runIntegrationTool(params: {
  toolName: string
  args: string[]
  workspaceId: string
  laneId: string
  cwd?: { kind: 'projectRoot' } | { kind: 'relative'; path: string }
  encryptedCredentials: string
  keyId: string
  timeout?: number
}): Promise<ExecuteIntegrationToolResult> {
  // Decrypt credentials
  const decryptResult = await decryptIntegrationCredentials(params.encryptedCredentials, params.keyId)
  if (!decryptResult.success || !decryptResult.credentials) {
    return { success: false, error: decryptResult.error || 'Failed to decrypt credentials' }
  }

  // Resolve working directory
  let workingDir = ''
  try {
    const access = await resolveAuthorizedWorkspaceAccess({
      workspaceId: params.workspaceId,
      laneId: params.laneId,
      operation: 'integration-tool',
      cwd: params.cwd as CwdSpec | undefined
    })
    workingDir = access.cwd ?? access.projectRootPath
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to resolve workspace path' }
  }
  }

  // Execute the tool
  return executeIntegrationTool({
    toolName: params.toolName,
    args: params.args,
    workingDir,
    credentials: decryptResult.credentials,
    timeout: params.timeout,
  })
}
