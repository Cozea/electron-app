/**
 * ExplorerItem model for file tree - adapted from VS Code
 *
 * Key features:
 * - Lazy resolution: directories only load children when expanded
 * - Parent-child relationships for tree traversal
 * - Merge support: preserves UI state during refresh
 */

export interface ExplorerItemData {
  resource: string           // Full path
  name: string               // File/folder name
  isDirectory: boolean
  isSymbolicLink?: boolean
  mtime?: number             // Last modified time
  size?: number              // File size in bytes
}

export class ExplorerItem {
  readonly resource: string
  readonly name: string
  readonly isDirectory: boolean
  readonly isSymbolicLink: boolean
  readonly mtime: number
  readonly size: number

  private _parent: ExplorerItem | null = null
  private _children: Map<string, ExplorerItem> = new Map()
  private _isDirectoryResolved: boolean = false

  constructor(data: ExplorerItemData) {
    this.resource = data.resource
    this.name = data.name
    this.isDirectory = data.isDirectory
    this.isSymbolicLink = data.isSymbolicLink ?? false
    this.mtime = data.mtime ?? 0
    this.size = data.size ?? 0
  }

  // Getters
  get parent(): ExplorerItem | null {
    return this._parent
  }

  get children(): Map<string, ExplorerItem> {
    return this._children
  }

  get isDirectoryResolved(): boolean {
    return this._isDirectoryResolved
  }

  get isRoot(): boolean {
    return this._parent === null
  }

  // Get sorted children as array
  get sortedChildren(): ExplorerItem[] {
    return Array.from(this._children.values()).sort((a, b) => {
      // Directories first
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1
      }
      // Then alphabetical (case-insensitive)
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    })
  }

  // Methods
  addChild(child: ExplorerItem): void {
    child._parent = this
    this._children.set(child.name.toLowerCase(), child)
  }

  removeChild(child: ExplorerItem): void {
    this._children.delete(child.name.toLowerCase())
    child._parent = null
  }

  getChild(name: string): ExplorerItem | undefined {
    return this._children.get(name.toLowerCase())
  }

  hasChild(name: string): boolean {
    return this._children.has(name.toLowerCase())
  }

  clearChildren(): void {
    this._children.clear()
    this._isDirectoryResolved = false
  }

  markResolved(): void {
    this._isDirectoryResolved = true
  }

  // Get the path from root to this item
  getPath(): ExplorerItem[] {
    const path: ExplorerItem[] = []
    let current: ExplorerItem | null = this
    while (current) {
      path.unshift(current)
      current = current._parent
    }
    return path
  }

  // Find a descendant by resource path
  find(resourcePath: string): ExplorerItem | undefined {
    if (this.resource === resourcePath) {
      return this
    }

    for (const child of this._children.values()) {
      const found = child.find(resourcePath)
      if (found) {
        return found
      }
    }

    return undefined
  }

  /**
   * Merge local state with disk state (preserves UI state during refresh)
   * This prevents losing expanded state and local modifications when refreshing from disk
   */
  static mergeLocalWithDisk(disk: ExplorerItem, local: ExplorerItem): void {
    if (!disk.isDirectoryResolved || !local.isDirectoryResolved) {
      return
    }

    // Remove items that no longer exist on disk
    for (const [name, localChild] of local.children) {
      if (!disk.children.has(name)) {
        local.removeChild(localChild)
      }
    }

    // Add/update items from disk
    for (const [name, diskChild] of disk.children) {
      const localChild = local.children.get(name)
      if (localChild) {
        // Update metadata
        // Note: In a full implementation, we'd update mtime, size, etc.

        // Recursively merge if both are resolved directories
        if (diskChild.isDirectory && localChild.isDirectory) {
          ExplorerItem.mergeLocalWithDisk(diskChild, localChild)
        }
      } else {
        // New item from disk - add it
        local.addChild(new ExplorerItem({
          resource: diskChild.resource,
          name: diskChild.name,
          isDirectory: diskChild.isDirectory,
          isSymbolicLink: diskChild.isSymbolicLink,
          mtime: diskChild.mtime,
          size: diskChild.size,
        }))
      }
    }
  }

  /**
   * Create a shallow clone (for React state updates)
   */
  clone(): ExplorerItem {
    const cloned = new ExplorerItem({
      resource: this.resource,
      name: this.name,
      isDirectory: this.isDirectory,
      isSymbolicLink: this.isSymbolicLink,
      mtime: this.mtime,
      size: this.size,
    })
    cloned._parent = this._parent
    cloned._children = this._children
    cloned._isDirectoryResolved = this._isDirectoryResolved
    return cloned
  }
}
