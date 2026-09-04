import { memo } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview-react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  CpuChargeIcon as __CpuChargeHugeIcon,
  Shield01Icon as __ShieldHugeIcon,
  SparklesIcon as __SparklesHugeIcon,
  Layers01Icon as __LayersHugeIcon,
  FlashIcon as __FlashHugeIcon,
} from "@hugeicons/core-free-icons"

import { DevAppIcon } from "@/features/devapps/components/DevAppIcon"
import { getDevAppById } from "@/features/devapps/registry"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import { Badge } from "@/components/ui/badge"
import type { WorkbenchLlamaTile as WorkbenchLlamaTileRecord } from "@/stores/useProjectWorkbenchStore"

interface WorkbenchLlamaTileProps {
  projectId: string
  laneId: string
  tile: WorkbenchLlamaTileRecord
  workspaceId: string | null
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
}

export const WorkbenchLlamaTile = memo(function WorkbenchLlamaTile(
  props: WorkbenchLlamaTileProps,
) {
  const llamaDevApp = getDevAppById("llama")

  return (
    <WorkbenchTileChrome
      title="Llama"
      panelApi={props.panelApi}
      containerApi={props.containerApi}
      tileType="llama"
      chromeVariant="pill"
      contentClassName="h-full"
    >
      <div className="flex h-full w-full flex-col items-center justify-center overflow-y-auto px-6 py-10 bg-content-surface">
        <div className="relative flex max-w-lg flex-col items-center text-center space-y-6">
          {/* App Icon Container */}
          <div className="relative">
            <div
              className="size-20 overflow-hidden shadow-lg"
              style={{ borderRadius: `${80 * 0.22265625}px` }}
            >
              {llamaDevApp ? (
                <DevAppIcon app={llamaDevApp} />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-white">
                  <HugeiconsIcon icon={__CpuChargeHugeIcon} className="h-10 w-10 text-purple-500" />
                </div>
              )}
            </div>
            <span className="absolute -bottom-1 -right-1 flex h-5 items-center justify-center rounded-full bg-purple-600 px-2 text-[9px] font-semibold uppercase tracking-wider text-white ring-2 ring-content-surface">
              Preview
            </span>
          </div>

          {/* Title & Description */}
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                Llama Local Runtime
              </h2>
              <Badge variant="secondary" className="rounded-full px-2 text-[11px] font-normal">
                Coming soon
              </Badge>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Run open-source Meta Llama models completely on-device. Zero data leaves your machine, providing ultra-private code assistance, fast completions, and custom model weights.
            </p>
          </div>

          {/* Feature Highlight Cards */}
          <div className="grid w-full grid-cols-1 gap-3 pt-2 sm:grid-cols-3">
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-border/50 bg-background/50 p-4 text-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/10 text-purple-500 dark:text-purple-400">
                <HugeiconsIcon icon={__ShieldHugeIcon} className="h-4 w-4" />
              </div>
              <span className="text-xs font-semibold text-foreground">100% Private</span>
              <p className="text-[11px] leading-tight text-muted-foreground">
                Inference runs on your local GPU & CPU hardware.
              </p>
            </div>

            <div className="flex flex-col items-center gap-2 rounded-2xl border border-border/50 bg-background/50 p-4 text-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-500 dark:text-violet-400">
                <HugeiconsIcon icon={__LayersHugeIcon} className="h-4 w-4" />
              </div>
              <span className="text-xs font-semibold text-foreground">Model Choice</span>
              <p className="text-[11px] leading-tight text-muted-foreground">
                Llama 3.3, DeepSeek R1, CodeLlama, and GGUF quants.
              </p>
            </div>

            <div className="flex flex-col items-center gap-2 rounded-2xl border border-border/50 bg-background/50 p-4 text-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500 dark:text-indigo-400">
                <HugeiconsIcon icon={__FlashHugeIcon} className="h-4 w-4" />
              </div>
              <span className="text-xs font-semibold text-foreground">Ollama & vLLM</span>
              <p className="text-[11px] leading-tight text-muted-foreground">
                Native bridge to local Ollama and OpenAI-compatible runners.
              </p>
            </div>
          </div>

          {/* Status Note */}
          <div className="flex items-center gap-2 rounded-full border border-purple-500/20 bg-purple-500/5 px-4 py-1.5 text-xs text-purple-700 dark:text-purple-300">
            <HugeiconsIcon icon={__SparklesHugeIcon} className="h-3.5 w-3.5 shrink-0" />
            <span>Local model host integration will be available in the upcoming release.</span>
          </div>
        </div>
      </div>
    </WorkbenchTileChrome>
  )
})
