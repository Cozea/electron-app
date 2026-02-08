import { Fragment, useCallback, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { useTerminalStore, useTerminalActions } from "@/stores/useTerminalStore"
import type { TerminalGroup } from "@/stores/useTerminalStore"
import { TerminalInstance } from "./TerminalInstance"

interface TerminalSplitViewProps {
    group: TerminalGroup
}

export function TerminalSplitView({ group }: TerminalSplitViewProps) {
    const terminals = useTerminalStore((s) => s.terminals)
    const { setActiveTerminal } = useTerminalActions()
    const { terminalIds, splitDirection, activeTerminalId } = group

    // Split sizes (as percentages)
    const [splitSizes, setSplitSizes] = useState<number[]>(
        () => terminalIds.map(() => 100 / terminalIds.length)
    )

    // Drag state
    const [isDragging, setIsDragging] = useState(false)
    const [dragIndex, setDragIndex] = useState<number | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const dragStartRef = useRef({ position: 0, sizes: [] as number[] })

    // Handle drag start
    const handleDragStart = useCallback((e: React.PointerEvent, index: number) => {
        e.preventDefault()
        setIsDragging(true)
        setDragIndex(index)

        const container = containerRef.current
        if (!container) return

        const rect = container.getBoundingClientRect()
        const position = splitDirection === 'horizontal'
            ? (e.clientX - rect.left) / rect.width * 100
            : (e.clientY - rect.top) / rect.height * 100

        dragStartRef.current = {
            position,
            sizes: [...splitSizes],
        }

        e.currentTarget.setPointerCapture(e.pointerId)
    }, [splitDirection, splitSizes])

    // Handle drag move
    const handleDragMove = useCallback((e: React.PointerEvent) => {
        if (!isDragging || dragIndex === null) return

        const container = containerRef.current
        if (!container) return

        const rect = container.getBoundingClientRect()
        const currentPosition = splitDirection === 'horizontal'
            ? (e.clientX - rect.left) / rect.width * 100
            : (e.clientY - rect.top) / rect.height * 100

        const delta = currentPosition - dragStartRef.current.position
        const { sizes } = dragStartRef.current

        // Calculate new sizes
        const minSize = 15 // Minimum 15% per terminal
        const newSizes = [...sizes]

        // Adjust the sizes of the two panels adjacent to the divider
        const leftSize = Math.max(minSize, sizes[dragIndex] + delta)
        const rightSize = Math.max(minSize, sizes[dragIndex + 1] - delta)

        // Only update if both sides maintain minimum size
        if (leftSize >= minSize && rightSize >= minSize) {
            newSizes[dragIndex] = leftSize
            newSizes[dragIndex + 1] = rightSize
            setSplitSizes(newSizes)
        }
    }, [isDragging, dragIndex, splitDirection])

    // Handle drag end
    const handleDragEnd = useCallback(() => {
        setIsDragging(false)
        setDragIndex(null)
    }, [])

    // If only one terminal, just render it directly
    if (terminalIds.length === 1) {
        return <TerminalInstance terminalId={terminalIds[0]} className="h-full w-full" shouldAutoFocus />
    }

    // No split direction set - render active terminal only
    if (!splitDirection) {
        const terminalId = activeTerminalId || terminalIds[0]
        return <TerminalInstance terminalId={terminalId} className="h-full w-full" shouldAutoFocus />
    }

    return (
        <div
            ref={containerRef}
            className={cn(
                "flex w-full h-full",
                splitDirection === 'horizontal' ? "flex-row" : "flex-col"
            )}
        >
            {terminalIds.map((terminalId, index) => {
                const terminal = terminals[terminalId]
                if (!terminal) return null

                const isActive = terminalId === activeTerminalId
                const size = splitSizes[index] || (100 / terminalIds.length)

                return (
                    <Fragment key={terminalId}>
                        {/* Divider (between terminals) */}
                        {index > 0 && (
                            <div
                                className={cn(
                                    "shrink-0 bg-border hover:bg-primary/50 transition-colors",
                                    splitDirection === 'horizontal'
                                        ? "w-1 cursor-col-resize"
                                        : "h-1 cursor-row-resize",
                                    isDragging && dragIndex === index - 1 && "bg-primary/50"
                                )}
                                onPointerDown={(e) => handleDragStart(e, index - 1)}
                                onPointerMove={handleDragMove}
                                onPointerUp={handleDragEnd}
                                onPointerCancel={handleDragEnd}
                            />
                        )}

                        {/* Terminal panel */}
                        <div
                            className={cn(
                                "min-w-0 min-h-0 relative",
                                isActive && "ring-1 ring-primary/50 ring-inset"
                            )}
                            style={{
                                [splitDirection === 'horizontal' ? 'width' : 'height']: `${size}%`,
                                flexShrink: 0,
                            }}
                        >
                            <TerminalInstance
                                terminalId={terminalId}
                                className="h-full w-full"
                                onFocus={() => setActiveTerminal(terminalId)}
                                shouldAutoFocus={isActive}
                            />
                        </div>
                    </Fragment>
                )
            })}
        </div>
    )
}
