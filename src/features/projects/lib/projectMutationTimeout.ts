const DEFAULT_PROJECT_MUTATION_TIMEOUT_MS = 30_000

export function withProjectMutationTimeout<T>(
  operation: Promise<T>,
  timeoutMessage: string,
  timeoutMs = DEFAULT_PROJECT_MUTATION_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage))
    }, timeoutMs)
  })

  return Promise.race([
    operation.finally(() => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
    }),
    timeout,
  ])
}
