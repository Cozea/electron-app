import { useYjsProject } from '@/contexts/YjsProjectContextValue'
import {

  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

import { HugeiconsIcon } from '@hugeicons/react'
import { Alert01Icon as __AlertTriangleHugeIcon, DocumentAttachmentIcon as __FileCheckHugeIcon, DocumentAttachmentIcon as __FileXHugeIcon } from '@hugeicons/core-free-icons'

/**
 * DeleteConflictDialog - Shows a dialog when delete-vs-edit conflicts are detected.
 *
 * This occurs when:
 * - User A deletes a file
 * - User B (offline) edits the same file
 * - User B comes back online and has conflicting local changes
 *
 * The dialog lets User B choose to:
 * - Keep their local version (restore the file)
 * - Accept the deletion (discard local changes)
 */
export function DeleteConflictDialog() {
  const { deleteConflicts, resolveDeleteConflict } = useYjsProject()

  if (deleteConflicts.length === 0) return null

  const conflict = deleteConflicts[0] // Handle one at a time
  const remainingCount = deleteConflicts.length - 1

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleString()
  }

  const handleKeepLocal = async () => {
    await resolveDeleteConflict(conflict.filePath, true)
  }

  const handleAcceptDelete = async () => {
    await resolveDeleteConflict(conflict.filePath, false)
  }

  return (
    <Dialog open={true}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <HugeiconsIcon icon={__AlertTriangleHugeIcon} className="w-5 h-5" />
            File Conflict Detected
          </DialogTitle>
          <DialogDescription>
            A file you edited was deleted by someone else while you were offline.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File info */}
          <div className="p-3 bg-muted rounded-lg">
            <p className="font-mono text-sm font-medium">{conflict.filePath}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Deleted by {conflict.deletedBy ?? 'unknown'} on{' '}
              {formatTime(conflict.deletedAt)}
            </p>
          </div>

          {/* Preview of local content */}
          <div>
            <p className="text-sm font-medium mb-2">Your local changes:</p>
            <ScrollArea className="h-32 w-full rounded border bg-muted/50">
              <pre className="p-2 text-xs font-mono whitespace-pre-wrap">
                {conflict.localContent.slice(0, 500)}
                {conflict.localContent.length > 500 && '...'}
              </pre>
            </ScrollArea>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleAcceptDelete}
            >
              <HugeiconsIcon icon={__FileXHugeIcon} className="w-4 h-4 mr-2" />
              Accept Deletion
            </Button>
            <Button className="flex-1" onClick={handleKeepLocal}>
              <HugeiconsIcon icon={__FileCheckHugeIcon} className="w-4 h-4 mr-2" />
              Keep My Version
            </Button>
          </div>

          {remainingCount > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              {remainingCount} more conflict{remainingCount > 1 ? 's' : ''} to
              resolve
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
