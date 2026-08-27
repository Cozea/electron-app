import type { RuntimeKind } from './runtimeTypes'

const NATIVE_COMMAND_PATTERNS: RegExp[] = [
  /\belectron\b/i,
  /\belectron-builder\b/i,
  /\breact-native\b/i,
  /\bexpo\b/i,
  /\bxcodebuild\b/i,
  /\bfastlane\b/i,
  /\bandroid\b/i,
  /\bgradle\b/i,
  /\bflutter\b/i,
  /\bswift\b/i,
]

export type CommandClassification = 'supported' | 'unsupported' | 'unknown'

export interface CommandIntent {
  classification: CommandClassification
  runtime: RuntimeKind | 'unknown'
  token: string
  reason: string
}

const TOKEN_TO_RUNTIME: Record<string, RuntimeKind> = {
  node: 'node',
  npm: 'npm',
  npx: 'npm',
  corepack: 'corepack',
  pnpm: 'pnpm',
  yarn: 'yarn',
  bun: 'bun',
  python: 'python',
  python3: 'python',
  pip: 'python',
  pip3: 'python',
  cargo: 'rust',
  rustc: 'rust',
  go: 'go',
}

function extractCommandToken(command: string): string {
  return command.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
}

export function resolveCommandIntent(command: string): CommandIntent {
  const trimmed = command.trim()
  if (!trimmed) {
    return {
      classification: 'unknown',
      runtime: 'unknown',
      token: '',
      reason: 'Empty command.',
    }
  }

  if (NATIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return {
      classification: 'unsupported',
      runtime: 'unknown',
      token: extractCommandToken(trimmed),
      reason: 'Current release supports web projects only; native desktop/mobile commands are blocked.',
    }
  }

  const token = extractCommandToken(trimmed)
  const runtime = TOKEN_TO_RUNTIME[token]
  if (!runtime) {
    return {
      classification: 'unknown',
      runtime: 'unknown',
      token,
      reason: 'Command is not in the known runtime catalog.',
    }
  }

  return {
    classification: 'supported',
    runtime,
    token,
    reason: 'Command token mapped to known runtime.',
  }
}

