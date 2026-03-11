export interface YjsWritebackScope {
  projectId: string | null
  projectPath: string | null
  yjsDoc: object | null
}

export function hasYjsWritebackScopeChanged(
  previous: YjsWritebackScope | null,
  next: YjsWritebackScope
): boolean {
  return (
    previous === null ||
    previous.projectId !== next.projectId ||
    previous.projectPath !== next.projectPath ||
    previous.yjsDoc !== next.yjsDoc
  )
}
