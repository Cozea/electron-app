import type { GitBranch as NativeGitBranch } from "@cozea/assistant-contracts"

import { readNativeApi } from "@/lib/nativeApi"

export async function loadGitBranchesCompat(projectPath: string): Promise<{
  isRepo: boolean
  hasOriginRemote: boolean
  branches: NativeGitBranch[]
  error?: string
}> {
  const listGitBranches = window.electronAPI.project.listGitBranches
  if (typeof listGitBranches === "function") {
    try {
      return await listGitBranches({ projectPath })
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.toLowerCase().includes("no handler registered")
      ) {
        return {
          isRepo: false,
          hasOriginRemote: false,
          branches: [],
          error: error instanceof Error ? error.message : "Failed to list local branches.",
        }
      }
    }
  }

  const api = readNativeApi()
  if (api?.git?.listBranches) {
    try {
      const result = await api.git.listBranches({ cwd: projectPath })
      return {
        isRepo: result.isRepo,
        hasOriginRemote: result.hasOriginRemote,
        branches: [...result.branches],
      }
    } catch (error) {
      return {
        isRepo: false,
        hasOriginRemote: false,
        branches: [],
        error: error instanceof Error ? error.message : "Failed to list local branches.",
      }
    }
  }

  return {
    isRepo: false,
    hasOriginRemote: false,
    branches: [],
    error: "Git branch controls need a full app restart to load the latest desktop bridge.",
  }
}

export async function checkoutGitBranchCompat(projectPath: string, branch: string): Promise<{
  success: boolean
  branch?: string
  error?: string
}> {
  const checkoutGitBranch = window.electronAPI.project.checkoutGitBranch
  if (typeof checkoutGitBranch === "function") {
    try {
      return await checkoutGitBranch({ projectPath, branch })
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.toLowerCase().includes("no handler registered")
      ) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to switch branches.",
        }
      }
    }
  }

  const api = readNativeApi()
  if (api?.git?.checkout) {
    try {
      await api.git.checkout({ cwd: projectPath, branch })
      const status = await api.git.status({ cwd: projectPath }).catch(() => null)
      return {
        success: true,
        branch: status?.branch ?? branch,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to switch branches.",
      }
    }
  }

  return {
    success: false,
    error: "Git branch switching needs a full app restart to load the latest desktop bridge.",
  }
}

export async function createGitWorktreeCompat(input: {
  projectPath: string
  branch: string
  newBranch?: string
  path?: string | null
}): Promise<{
  success: boolean
  worktree?: {
    path: string
    branch: string
  }
  error?: string
}> {
  const createGitWorktree = window.electronAPI.project.createGitWorktree
  if (typeof createGitWorktree === "function") {
    try {
      return await createGitWorktree(input)
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.toLowerCase().includes("no handler registered")
      ) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to create personal lane.",
        }
      }
    }
  }

  const api = readNativeApi()
  if (api?.git?.createWorktree) {
    try {
      const result = await api.git.createWorktree({
        cwd: input.projectPath,
        branch: input.branch,
        newBranch: input.newBranch,
        path: input.path ?? null,
      })
      return {
        success: true,
        worktree: result.worktree,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create personal lane.",
      }
    }
  }

  return {
    success: false,
    error: "Git worktree creation needs a full app restart to load the latest desktop bridge.",
  }
}

