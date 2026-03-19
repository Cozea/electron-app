export interface ProjectDeleteErrorPresentation {
  title: string
  message: string
  detail: string | null
}

export interface ProjectRenameErrorPresentation {
  title: string
  message: string
  detail: string | null
}

interface ProjectMutationErrorData {
  code?: string
  message?: string
}

function extractErrorText(input: unknown, fallback: string): string {
  if (
    input &&
    typeof input === 'object' &&
    'data' in input &&
    input.data &&
    typeof input.data === 'object' &&
    'message' in (input.data as ProjectMutationErrorData) &&
    typeof (input.data as ProjectMutationErrorData).message === 'string'
  ) {
    return (input.data as ProjectMutationErrorData).message || fallback
  }
  if (input instanceof Error) {
    return input.message || fallback
  }
  if (typeof input === 'string' && input.trim().length > 0) {
    return input.trim()
  }
  return fallback
}

function extractErrorCode(input: unknown): string | null {
  if (
    input &&
    typeof input === 'object' &&
    'data' in input &&
    input.data &&
    typeof input.data === 'object' &&
    'code' in (input.data as ProjectMutationErrorData) &&
    typeof (input.data as ProjectMutationErrorData).code === 'string'
  ) {
    return (input.data as ProjectMutationErrorData).code || null
  }

  return null
}

function cleanConvexErrorMessage(message: string): string {
  return message
    .replace(/^\[CONVEX.*?\]\s*/, '')
    .replace(/\s*Called by client$/, '')
    .trim()
}

export function formatProjectDeleteError(input: unknown): ProjectDeleteErrorPresentation {
  const cleaned = cleanConvexErrorMessage(
    extractErrorText(input, 'Failed to delete project')
  )
  const code = extractErrorCode(input)
  const lower = cleaned.toLowerCase()

  if (
    code === 'project_delete_permission_required' ||
    lower.includes('only project creators, managers, or authorized workspace members can delete projects')
  ) {
    return {
      title: 'Delete Permission Required',
      message: 'You do not have permission to delete this project.',
      detail: 'Only project creators, managers, or authorized workspace members can delete projects.',
    }
  }

  if (code === 'project_delete_name_mismatch' || lower.includes('project name does not match')) {
    return {
      title: 'Project Name Confirmation Required',
      message: 'The project name confirmation did not match.',
      detail: 'Type the exact project name to confirm deletion.',
    }
  }

  if (code === 'project_not_found' || lower.includes('project not found')) {
    return {
      title: 'Project Not Found',
      message: 'This project is no longer available.',
      detail: 'It may already have been deleted or you may no longer have access to it.',
    }
  }

  return {
    title: 'Could Not Delete Project',
    message: 'Cozea could not delete this project.',
    detail: cleaned === 'Failed to delete project' ? null : cleaned,
  }
}

export function formatProjectRenameError(input: unknown): ProjectRenameErrorPresentation {
  const cleaned = cleanConvexErrorMessage(
    extractErrorText(input, 'Failed to rename project')
  )
  const lower = cleaned.toLowerCase()

  if (lower.includes('unauthorized to edit project')) {
    return {
      title: 'Rename Permission Required',
      message: 'You do not have permission to rename this project.',
      detail: 'Only project editors or authorized workspace members can rename projects.',
    }
  }

  if (lower.includes('project not found')) {
    return {
      title: 'Project Not Found',
      message: 'This project is no longer available.',
      detail: 'It may already have been deleted or you may no longer have access to it.',
    }
  }

  return {
    title: 'Could Not Rename Project',
    message: 'Cozea could not rename this project.',
    detail: cleaned === 'Failed to rename project' ? null : cleaned,
  }
}
