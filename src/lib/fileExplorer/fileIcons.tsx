/**
 * File icons using @react-symbols/icons (VS Code Symbols theme)
 *
 * Uses the FileIcon and FolderIcon components with auto-assign
 * for automatic icon detection based on filename/extension.
 *
 * @see https://github.com/pheralb/react-symbols
 */

import {
  FileIcon,
  FolderIcon,
  getIconForFile,
  getIconForFolder,
  DefaultFileIcon,
  DefaultFolderIcon,
  DefaultFolderOpenedIcon,
} from '@react-symbols/icons/utils'

// Default icon size for file tree
const ICON_SIZE = 16

interface IconProps {
  className?: string
  width?: number
  height?: number
}

/**
 * Get the appropriate icon for a file based on its name
 * Uses VS Code Symbols theme icons with auto-assign
 */
export function getFileIcon(
  filename: string,
  props: IconProps = {}
): React.ReactNode {
  const { className = '', width = ICON_SIZE, height = ICON_SIZE } = props

  return (
    <FileIcon
      fileName={filename}
      autoAssign={true}
      width={width}
      height={height}
      className={`shrink-0 ${className}`}
    />
  )
}

/**
 * Get the appropriate icon for a folder based on its name
 */
export function getFolderIcon(
  folderName: string,
  isOpen: boolean = false,
  props: IconProps = {}
): React.ReactNode {
  const { className = '', width = ICON_SIZE, height = ICON_SIZE } = props

  // Use FolderIcon with folder name for special folders
  // Note: @react-symbols doesn't have an "open" state built-in,
  // so we use the same icon for both states
  return (
    <FolderIcon
      folderName={folderName}
      width={width}
      height={height}
      className={`shrink-0 ${className}`}
    />
  )
}

/**
 * Get the default file icon (for unknown file types)
 */
export function getDefaultFileIcon(props: IconProps = {}): React.ReactNode {
  const { className = '', width = ICON_SIZE, height = ICON_SIZE } = props

  return (
    <DefaultFileIcon
      width={width}
      height={height}
      className={`shrink-0 ${className}`}
    />
  )
}

/**
 * Get the default folder icon
 */
export function getDefaultFolderIcon(
  isOpen: boolean = false,
  props: IconProps = {}
): React.ReactNode {
  const { className = '', width = ICON_SIZE, height = ICON_SIZE } = props

  const Icon = isOpen ? DefaultFolderOpenedIcon : DefaultFolderIcon

  return (
    <Icon
      width={width}
      height={height}
      className={`shrink-0 ${className}`}
    />
  )
}

/**
 * Get the icon component for a file (without rendering)
 * Useful for programmatic access
 */
export function getFileIconComponent(filename: string) {
  return getIconForFile({ fileName: filename })
}

/**
 * Get the icon component for a folder (without rendering)
 */
export function getFolderIconComponent(folderName: string) {
  return getIconForFolder({ folderName })
}

// Re-export types and utilities for convenience
export {
  FileIcon,
  FolderIcon,
  DefaultFileIcon,
  DefaultFolderIcon,
  DefaultFolderOpenedIcon,
}
