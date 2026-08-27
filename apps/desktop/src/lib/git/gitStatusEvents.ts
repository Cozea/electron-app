export const GIT_STATUS_EVENT_NAME = 'cozea:git-status-changed'

export type GitStatusEventKind =
  | 'dirty'
  | 'synced'
  | 'pulled'
  | 'restored'
  | 'published'

export interface GitStatusEventDetail {
  projectId: string
  projectPath: string
  kind: GitStatusEventKind
}

export function dispatchGitStatusEvent(detail: GitStatusEventDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<GitStatusEventDetail>(GIT_STATUS_EVENT_NAME, { detail }))
}
