import { createElement, memo } from 'react'
import { Smartphone, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type NativePreviewLauncher = 'web' | 'simulator'

interface NativePreviewLaunchPillProps {
  onOpenWebPreview?: (() => void) | null
  selectedLauncher: NativePreviewLauncher
  supportsWebPreview: boolean
  onSelectedLauncherChange: (launcher: NativePreviewLauncher) => void
}

export const NativePreviewLaunchPill = memo(function NativePreviewLaunchPill({
  onOpenWebPreview,
  selectedLauncher,
  supportsWebPreview,
  onSelectedLauncherChange,
}: NativePreviewLaunchPillProps) {
  const isWeb = selectedLauncher === 'web' && supportsWebPreview;

  const handleOpenSelected = () => {
    if (isWeb) {
      onOpenWebPreview?.()
    }
  }

  return (
    <div className="inline-flex h-7 items-center overflow-hidden rounded-full border border-border/60 bg-secondary/70 shadow-none" title={isWeb ? 'Open in browser' : 'Simulator active'}>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 rounded-none border-0 bg-transparent px-2 shadow-none hover:bg-secondary"
        onClick={handleOpenSelected}
        disabled={isWeb && !onOpenWebPreview}
      >
        {createElement(isWeb ? Globe : Smartphone, { className: 'h-3.5 w-3.5 text-muted-foreground' })}
      </Button>
      
      {supportsWebPreview && (
        <>
          <div className="h-4 w-px bg-border/60" aria-hidden />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 rounded-none border-0 bg-transparent px-2 shadow-none hover:bg-secondary"
            onClick={() => onSelectedLauncherChange(isWeb ? 'simulator' : 'web')}
            title={isWeb ? 'Switch to Simulator' : 'Switch to Web'}
          >
            {createElement(isWeb ? Smartphone : Globe, { className: 'h-3.5 w-3.5 text-muted-foreground' })}
          </Button>
        </>
      )}
    </div>
  )
})
