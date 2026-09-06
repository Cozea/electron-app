export interface AppAgentRuntimeSchedulerGateInput {
  readonly enableScheduledTasks: boolean
  readonly rpcChatEnabled: boolean
  readonly transportLoading: boolean
  readonly hasShadowStatus: boolean
  readonly primaryExpected: boolean
  readonly substrateActive: boolean
  readonly cutoverActive: boolean
}

/**
 * Background scheduled work must only start when its renderer-level agent
 * runtime is usable. Primary T3 mode requires the full cutover to be active;
 * legacy mode can use the already-supported NativeApi transport.
 */
export function shouldStartScheduledTaskRunner(
  input: AppAgentRuntimeSchedulerGateInput,
): boolean {
  if (!input.enableScheduledTasks || input.transportLoading) return false
  if (input.rpcChatEnabled && !input.hasShadowStatus) return false
  if (input.primaryExpected || input.substrateActive) return input.cutoverActive
  return true
}
