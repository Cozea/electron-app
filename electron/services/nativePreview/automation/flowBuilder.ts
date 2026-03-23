interface BuildDefaultLaunchVerificationFlowOptions {
  appId?: string
  selectorId?: string
}

export function buildDefaultLaunchVerificationFlow(options: BuildDefaultLaunchVerificationFlowOptions = {}): string {
  const lines = []
  if (options.appId) {
    lines.push(`appId: ${options.appId}`)
  }
  lines.push('---')
  lines.push('- launchApp')
  if (options.selectorId) {
    lines.push('- assertVisible:')
    lines.push(`    id: "${options.selectorId}"`)
  }
  return lines.join('\n')
}
