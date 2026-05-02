import { memo } from 'react'
import { useTranslation } from '@/lib/i18n'
import { ChangedFilesTree, type ChangedFilesTreeFile } from './ChangedFilesTree'

interface ChangesTreeViewProps {
  visibleFiles: readonly ChangedFilesTreeFile[]
  activeFilesLoaded: boolean
  selectedFilePath: string | null
  onFileFilterChange: (path: string | null) => void
}

export const ChangesTreeView = memo(function ChangesTreeView({
  visibleFiles,
  activeFilesLoaded,
  selectedFilePath,
  onFileFilterChange,
}: ChangesTreeViewProps) {
  const { t } = useTranslation()

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-4">
        {visibleFiles.length > 0 ? (
          <ChangedFilesTree
            files={visibleFiles}
            allDirectoriesExpanded={true}
            onFileFilterChange={onFileFilterChange}
            selectedFilePath={selectedFilePath}
          />
        ) : (
          activeFilesLoaded ? (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              {t('changes.empty.noMatchingFiles')}
            </div>
          ) : null
        )}
      </div>
    </div>
  )
})
