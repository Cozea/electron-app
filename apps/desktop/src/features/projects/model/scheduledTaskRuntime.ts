export class ScheduledTaskRuntimeUnavailableError extends Error {
  constructor(message = 'Local agent runtime is not ready yet.') {
    super(message)
    this.name = 'ScheduledTaskRuntimeUnavailableError'
  }
}

export function isScheduledTaskRuntimeUnavailableError(
  error: unknown,
): error is ScheduledTaskRuntimeUnavailableError {
  return error instanceof ScheduledTaskRuntimeUnavailableError
}
