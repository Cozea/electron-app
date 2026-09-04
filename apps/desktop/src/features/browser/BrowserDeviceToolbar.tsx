import type { PreviewViewportSetting } from "@cozea/contracts/t3/preview"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { BROWSER_DEVICE_TOOLBAR_HEIGHT, resizeFreeformViewport } from "./browserViewportLayout"
import { commitViewportAndAspectRatio } from "./browserDeviceToolbarState"
import {
  PREVIEW_VIEWPORT_MAX_AREA,
  PREVIEW_VIEWPORT_MAX_DIMENSION,
  PREVIEW_VIEWPORT_MIN_DIMENSION,
  PREVIEW_VIEWPORT_PRESETS,
  resolvePreviewViewport,
} from "./previewViewport"
import { ScreenRotationIcon } from "./ScreenRotationIcon"

const RESPONSIVE_VALUE = "responsive"

interface BrowserDeviceToolbarProps {
  readonly setting: Exclude<PreviewViewportSetting, { readonly _tag: "fill" }>
  readonly width: number
  readonly aspectRatio: number | null
  readonly onAspectRatioChange: (aspectRatio: number | null) => void
  readonly onChange: (setting: PreviewViewportSetting) => Promise<void>
}

function LinkIcon({ linked }: { readonly linked: boolean }) {
  return linked ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m2 2 20 20" />
      <path d="M9.5 4.5a5 5 0 0 1 6.5 7.4" />
      <path d="M14.5 19.5A5 5 0 0 1 8 12.1" />
    </svg>
  )
}

export function BrowserDeviceToolbar({
  setting,
  width,
  aspectRatio,
  onAspectRatioChange,
  onChange,
}: BrowserDeviceToolbarProps) {
  const [pending, setPending] = useState(false)
  const [customSize, setCustomSize] = useState<{
    readonly width: string
    readonly height: string
  } | null>(null)
  const presentedSize = customSize ?? {
    width: String(setting.width),
    height: String(setting.height),
  }
  const selectedValue =
    setting._tag === "preset" &&
    PREVIEW_VIEWPORT_PRESETS.some((preset) => preset.id === setting.presetId)
      ? setting.presetId
      : RESPONSIVE_VALUE
  const customWidth = Number(presentedSize.width)
  const customHeight = Number(presentedSize.height)
  const customValid =
    Number.isInteger(customWidth) &&
    Number.isInteger(customHeight) &&
    customWidth >= PREVIEW_VIEWPORT_MIN_DIMENSION &&
    customWidth <= PREVIEW_VIEWPORT_MAX_DIMENSION &&
    customHeight >= PREVIEW_VIEWPORT_MIN_DIMENSION &&
    customHeight <= PREVIEW_VIEWPORT_MAX_DIMENSION &&
    customWidth * customHeight <= PREVIEW_VIEWPORT_MAX_AREA

  const apply = (next: PreviewViewportSetting, nextAspectRatio = aspectRatio) => {
    setPending(true)
    void commitViewportAndAspectRatio(next, nextAspectRatio, onChange, onAspectRatioChange).then(
      () => {
        setPending(false)
        setCustomSize(null)
      },
      () => setPending(false),
    )
  }
  const applyCustomSize = () => {
    if (!customValid || (customWidth === setting.width && customHeight === setting.height)) {
      setCustomSize(null)
      return
    }
    apply({ _tag: "freeform", width: customWidth, height: customHeight })
  }
  const updateCustomDimension = (axis: "width" | "height", value: string) => {
    setCustomSize((current) => {
      const next = {
        width: axis === "width" ? value : (current?.width ?? String(setting.width)),
        height: axis === "height" ? value : (current?.height ?? String(setting.height)),
      }
      const numeric = Number(value)
      if (
        aspectRatio === null ||
        !Number.isInteger(numeric) ||
        numeric < PREVIEW_VIEWPORT_MIN_DIMENSION ||
        numeric > PREVIEW_VIEWPORT_MAX_DIMENSION
      ) {
        return next
      }
      const resized = resizeFreeformViewport(
        setting,
        axis === "width"
          ? { x: numeric - setting.width, y: 0 }
          : { x: 0, y: numeric - setting.height },
        1,
        axis === "width" ? "east" : "south",
        aspectRatio,
      )
      return { width: String(resized.width), height: String(resized.height) }
    })
  }
  const selectViewport = (value: string) => {
    if (value === RESPONSIVE_VALUE) {
      if (setting._tag !== "freeform")
        apply({ _tag: "freeform", width: setting.width, height: setting.height })
      return
    }
    const preset = PREVIEW_VIEWPORT_PRESETS.find((candidate) => candidate.id === value)
    if (!preset) return
    apply(
      resolvePreviewViewport({ mode: "preset", preset: preset.id }),
      aspectRatio === null ? null : preset.width / preset.height,
    )
  }
  const rotate = () => {
    const hasCustomSize =
      customValid && (customWidth !== setting.width || customHeight !== setting.height)
    const source = hasCustomSize
      ? ({ _tag: "freeform", width: customWidth, height: customHeight } as const)
      : setting
    apply(
      { ...source, width: source.height, height: source.width },
      aspectRatio === null ? null : 1 / aspectRatio,
    )
  }

  const dimensionClassName = cn(
    "h-6 rounded-md border border-input bg-background px-1 text-center text-xs tabular-nums outline-none focus:ring-1 focus:ring-ring",
    width >= 360 ? "w-14" : "w-11",
  )
  return (
    <div
      className="sticky left-0 top-0 z-50 flex items-center gap-0.5 overflow-x-auto border-b border-border/70 bg-background/95 px-1.5 shadow-xs backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ width, height: BROWSER_DEVICE_TOOLBAR_HEIGHT }}
      role="toolbar"
      aria-label="Browser device toolbar"
      data-browser-device-toolbar
      onBlur={(event) => {
        const nextTarget = event.relatedTarget
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
        if (nextTarget instanceof HTMLElement && nextTarget.closest('[data-slot="select-content"]'))
          return
        applyCustomSize()
      }}
    >
      {width >= 560 ? (
        <span className="mr-0.5 shrink-0 text-[11px] font-medium text-muted-foreground">
          Dimensions
        </span>
      ) : null}
      <Select value={selectedValue} onValueChange={selectViewport} disabled={pending}>
        <SelectTrigger
          size="sm"
          className={cn("h-6 shrink-0 px-1.5 text-xs font-medium", width >= 440 ? "w-36" : "w-24")}
          aria-label="Browser device preset"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start" className="min-w-64">
          <SelectItem value={RESPONSIVE_VALUE}>Responsive</SelectItem>
          <SelectGroup>
            <SelectLabel>Standard</SelectLabel>
            {PREVIEW_VIEWPORT_PRESETS.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                <span className="flex w-full items-center justify-between gap-5">
                  <span>{preset.label}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {preset.detail}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <form
        className="m-0 flex shrink-0 items-center gap-0.5"
        onSubmit={(event) => {
          event.preventDefault()
          applyCustomSize()
        }}
      >
        <input
          type="number"
          min={PREVIEW_VIEWPORT_MIN_DIMENSION}
          max={PREVIEW_VIEWPORT_MAX_DIMENSION}
          value={presentedSize.width}
          disabled={pending}
          onFocus={() =>
            setCustomSize(
              (current) =>
                current ?? { width: String(setting.width), height: String(setting.height) },
            )
          }
          onChange={(event) => updateCustomDimension("width", event.target.value)}
          aria-label="Viewport width"
          aria-invalid={!customValid}
          className={dimensionClassName}
        />
        <span className="text-xs text-muted-foreground">×</span>
        <input
          type="number"
          min={PREVIEW_VIEWPORT_MIN_DIMENSION}
          max={PREVIEW_VIEWPORT_MAX_DIMENSION}
          value={presentedSize.height}
          disabled={pending}
          onFocus={() =>
            setCustomSize(
              (current) =>
                current ?? { width: String(setting.width), height: String(setting.height) },
            )
          }
          onChange={(event) => updateCustomDimension("height", event.target.value)}
          aria-label="Viewport height"
          aria-invalid={!customValid}
          className={dimensionClassName}
        />
      </form>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={
              aspectRatio === null ? "Lock viewport aspect ratio" : "Unlock viewport aspect ratio"
            }
            aria-pressed={aspectRatio !== null}
            className={cn(aspectRatio !== null && "bg-accent text-foreground")}
            disabled={pending || !customValid}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() =>
              onAspectRatioChange(aspectRatio === null ? customWidth / customHeight : null)
            }
          >
            <LinkIcon linked={aspectRatio !== null} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {aspectRatio === null ? "Lock aspect ratio" : "Unlock aspect ratio"}
        </TooltipContent>
      </Tooltip>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Rotate viewport"
        disabled={pending}
        onClick={rotate}
      >
        <ScreenRotationIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Close device toolbar"
        className="sticky right-0 ml-auto bg-background/95"
        disabled={pending}
        onClick={() => apply({ _tag: "fill" }, null)}
      >
        ×
      </Button>
    </div>
  )
}
