import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { HugeiconsIcon } from '@hugeicons/react'
import { ChevronDoubleCloseIcon as __ChevronLeftIconHugeIcon, ChevronDoubleCloseIcon as __ChevronRightIconHugeIcon } from '@hugeicons/core-free-icons'

export function buildPaginationPageNumbers(
  currentPage: number,
  totalPages: number,
): (number | string)[] {
  const pages: (number | string)[] = []
  if (totalPages <= 0) {
    return pages
  }
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i += 1) {

      pages.push(i)
    }
  } else if (currentPage <= 3) {
    pages.push(1, 2, 3, '...', totalPages)
  } else if (currentPage >= totalPages - 2) {
    pages.push(1, '...', totalPages - 2, totalPages - 1, totalPages)
  } else {
    pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages)
  }
  return pages
}

export interface TablePaginationControlsProps {
  currentPage: number
  totalCount: number
  pageSize: number
  onPageChange: (page: number) => void
  className?: string
  /** When set, the right chevron invokes this instead of advancing one page. */
  onNextClick?: () => void
  /** When `onNextClick` is set, this controls whether the right chevron is disabled. */
  isNextDisabled?: boolean
  /** When false, only page controls are shown (e.g. dialog footer). Default true. */
  showEntryCount?: boolean
}

export function TablePaginationControls({
  currentPage,
  totalCount,
  pageSize,
  onPageChange,
  className,
  onNextClick,
  isNextDisabled,
  showEntryCount = true,
}: TablePaginationControlsProps) {
  if (totalCount === 0) {
    return null
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = Math.min(startIndex + pageSize, totalCount)
  const pageNumbers = buildPaginationPageNumbers(currentPage, totalPages)

  const defaultNextDisabled = currentPage >= totalPages || totalPages === 0
  const nextDisabled = isNextDisabled ?? defaultNextDisabled

  return (
    <div
      className={cn(
        showEntryCount
          ? 'mt-3 flex items-center justify-between gap-3'
          : 'flex items-center gap-1',
        className,
      )}
    >
      {showEntryCount ? (
        <div className="text-sm text-muted-foreground">
          Showing {startIndex + 1}-{endIndex} of {totalCount} entries
        </div>
      ) : null}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-7 w-7 rounded-full"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
        >
          <HugeiconsIcon icon={__ChevronLeftIconHugeIcon} className="h-4 w-4" />
        </Button>
        {pageNumbers.map((page, index) =>
          typeof page === 'number' ? (
            <Button
              type="button"
              key={index}
              variant={currentPage === page ? 'default' : 'secondary'}
              size="icon"
              className="h-7 w-7 rounded-full text-xs"
              onClick={() => onPageChange(page)}
            >
              {page}
            </Button>
          ) : (
            <span key={index} className="px-2 text-muted-foreground">
              ...
            </span>
          ),
        )}
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-7 w-7 rounded-full"
          onClick={() => {
            if (onNextClick) {
              onNextClick()
              return
            }
            onPageChange(Math.min(totalPages, currentPage + 1))
          }}
          disabled={nextDisabled}
        >
          <HugeiconsIcon icon={__ChevronRightIconHugeIcon} className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
