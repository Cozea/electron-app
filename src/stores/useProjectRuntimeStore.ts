const EMPTY_PROJECT_RUNTIME_STATE = Object.freeze({})

export function selectProjectRuntimeState(projectPath: string | null) {
  return (state: { projects?: Record<string, unknown> }) => {
    if (!projectPath) {
      return EMPTY_PROJECT_RUNTIME_STATE
    }

    return state.projects?.[projectPath] ?? EMPTY_PROJECT_RUNTIME_STATE
  }
}
