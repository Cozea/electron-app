/**
 * File Explorer library - VS Code-inspired file tree implementation
 *
 * Usage:
 * ```typescript
 * import { useFileExplorer } from '@/hooks/useFileExplorer'
 * import { ExplorerItem, FileService } from '@/lib/fileExplorer'
 * ```
 */

export { ExplorerItem, type ExplorerItemData } from './explorerModel'
export {
  FileService,
  createCancellationTokenSource,
  type FileServiceOptions,
  type CancellationToken,
} from './fileService'
export { ExplorerDataSource } from './explorerDataSource'
export {
  LRUCache,
  globToRegex,
  matchGlob,
  matchAnyGlob,
  parseGitignorePattern,
} from './globCache'
export {
  getFileIcon,
  getFolderIcon,
  getDefaultFileIcon,
  getDefaultFolderIcon,
  getFileIconComponent,
  getFolderIconComponent,
  FileIcon,
  FolderIcon,
} from './fileIcons'
