import { memo, useMemo } from 'react'
import { QrCode } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;?]*[a-zA-Z]/g
const EXPO_QR_LINE_PATTERN = /^[\s\u2580-\u259f]+$/
const QR_MODULE_SIZE_PX = 6

export function extractExpoQrBlock(serverOutput: string): string | null {
  const cleaned = serverOutput.replace(ANSI_PATTERN, '')
  const lines = cleaned.split(/\r?\n/)

  let bestBlock: string[] = []
  let currentBlock: string[] = []

  for (const line of lines) {
    const trimmedRight = line.replace(/\s+$/, '')
    const isQrLine =
      trimmedRight.length > 0
      && EXPO_QR_LINE_PATTERN.test(trimmedRight)
      && /[\u2580-\u259f]/.test(trimmedRight)

    if (isQrLine) {
      currentBlock.push(trimmedRight)
      continue
    }

    if (currentBlock.length > bestBlock.length) {
      bestBlock = [...currentBlock]
    }
    currentBlock = []
  }

  if (currentBlock.length > bestBlock.length) {
    bestBlock = currentBlock
  }

  return bestBlock.length >= 8 ? bestBlock.join('\n') : null
}

export function decodeQrCell(character: string): { top: boolean; bottom: boolean } {
  switch (character) {
    case ' ':
      return { top: false, bottom: false }
    case '\u2580':
      return { top: true, bottom: false }
    case '\u2584':
      return { top: false, bottom: true }
    case '\u2588':
    case '\u258c':
    case '\u2590':
    case '\u2591':
    case '\u2592':
    case '\u2593':
      return { top: true, bottom: true }
    default:
      return /[\u2580-\u259f]/.test(character)
        ? { top: true, bottom: true }
        : { top: false, bottom: false }
  }
}

interface NativePreviewQrPopoverProps {
  serverOutput: string[]
  serverRunning: boolean
}

export function getExpoQrRows(serverOutput: string[]): Array<Array<{ top: boolean; bottom: boolean }>> | null {
  const qrBlock = extractExpoQrBlock(serverOutput.join(''))
  return qrBlock
    ? qrBlock.split('\n').map((line) => [...line].map((character) => decodeQrCell(character)))
    : null
}

export const NativePreviewQrPopover = memo(function NativePreviewQrPopover({
  serverOutput,
  serverRunning,
}: NativePreviewQrPopoverProps) {
  const qrRows = useMemo(() => getExpoQrRows(serverOutput), [serverOutput])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-full"
          aria-label="Show Expo QR code"
        >
          <QrCode className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" sideOffset={8} className="w-auto rounded-2xl p-3">
        {qrRows ? (
          <div className="rounded-md bg-white p-3" aria-label="Expo QR code">
            <div className="inline-flex flex-col">
              {qrRows.map((row, rowIndex) => (
                <div key={`qr-row-${rowIndex}`} className="flex">
                  {row.map((cell, columnIndex) => (
                    <div
                      key={`qr-cell-${rowIndex}-${columnIndex}`}
                      style={{
                        width: `${QR_MODULE_SIZE_PX}px`,
                        height: `${QR_MODULE_SIZE_PX * 2}px`,
                      }}
                    >
                      <div
                        style={{
                          width: '100%',
                          height: `${QR_MODULE_SIZE_PX}px`,
                          backgroundColor: cell.top ? '#000' : '#fff',
                        }}
                      />
                      <div
                        style={{
                          width: '100%',
                          height: `${QR_MODULE_SIZE_PX}px`,
                          backgroundColor: cell.bottom ? '#000' : '#fff',
                        }}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="px-2 py-1 text-sm text-muted-foreground">
            {serverRunning ? 'Waiting for Expo QR…' : 'Start Metro to show the Expo QR code.'}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
})
