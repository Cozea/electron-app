import type { TerminalProfile } from '@shared/electronApiTypes'

export type ImportTerminalPlatform = 'windows' | 'posix'

export interface ImportTerminalCommandPlan {
  profileId: string
  commandLine: string
  completionMarker: string
}

export const IMPORT_TERMINAL_COMPLETION_MARKER = '__COZEA_IMPORT_DONE__'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function selectImportTerminalProfile(
  platform: ImportTerminalPlatform,
  profiles: TerminalProfile[]
): string {
  const preferredProfiles =
    platform === 'windows'
      ? ['pwsh', 'powershell', 'cmd']
      : ['sh', 'bash', 'zsh']

  for (const profileId of preferredProfiles) {
    if (profiles.some((profile) => profile.id === profileId)) {
      return profileId
    }
  }

  return platform === 'windows' ? 'cmd' : 'sh'
}

export function buildImportTerminalCommand(
  command: string,
  platform: ImportTerminalPlatform,
  profiles: TerminalProfile[]
): ImportTerminalCommandPlan {
  const profileId = selectImportTerminalProfile(platform, profiles)

  if (platform === 'windows') {
    if (profileId === 'cmd') {
      return {
        profileId,
        completionMarker: IMPORT_TERMINAL_COMPLETION_MARKER,
        commandLine: `(${command}) & set COZEA_IMPORT_EXIT_CODE=%ERRORLEVEL% & echo ${IMPORT_TERMINAL_COMPLETION_MARKER}:%COZEA_IMPORT_EXIT_CODE% & exit /b %COZEA_IMPORT_EXIT_CODE%`,
      }
    }

    return {
      profileId,
      completionMarker: IMPORT_TERMINAL_COMPLETION_MARKER,
      commandLine: `& { ${command}; $cozeaImportExitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }; Write-Output '${IMPORT_TERMINAL_COMPLETION_MARKER}:' + $cozeaImportExitCode; exit $cozeaImportExitCode }`,
    }
  }

  return {
    profileId,
    completionMarker: IMPORT_TERMINAL_COMPLETION_MARKER,
    commandLine: `${command}; __cozea_import_exit_code=$?; printf '\\n${IMPORT_TERMINAL_COMPLETION_MARKER}:%s\\n' "$__cozea_import_exit_code"; exit "$__cozea_import_exit_code"`,
  }
}

export function parseImportTerminalCompletionCode(
  output: string,
  completionMarker = IMPORT_TERMINAL_COMPLETION_MARKER
): number | null {
  const match = output.match(new RegExp(`${escapeRegExp(completionMarker)}:(\\d+)`))
  if (!match) return null

  const parsed = Number.parseInt(match[1] ?? '', 10)
  return Number.isFinite(parsed) ? parsed : null
}
