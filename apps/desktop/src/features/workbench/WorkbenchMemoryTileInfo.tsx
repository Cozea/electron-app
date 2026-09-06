import { memo, useMemo } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  DEFAULT_PROJECT_MEMORY_RUN,
  buildProjectMemoryKey,
  useProjectMemoryStore,
} from "@/features/project-memory/projectMemoryStore"
import { resolveMemoryPalette } from "@/features/project-memory/memoryPalette"
import { useTheme } from "@/contexts/ThemeContext"
import { useTranslation, type TranslationKey } from "@/lib/i18n"

import { HugeiconsIcon } from "@hugeicons/react"
import { InformationCircleIcon as __InfoHugeIcon } from "@hugeicons/core-free-icons"

/**
 * The map encodes several things at once and none of them is guessable, so the
 * key lives beside the tile's own name rather than buried in settings.
 *
 * Swatches are the real thing: same palette constants, same silhouettes, so the
 * key cannot drift from the canvas. Memory types are read from the graph rather
 * than hardcoded, because the vocabulary belongs to whichever skill built it.
 */

interface WorkbenchMemoryTileInfoProps {
  workspaceId: string | null
  laneId: string | null
}

/** Order only; the colours come from the palette so the legend cannot drift from the canvas. */
const STATE_SWATCH_ORDER = ["new", "changed", "unchanged"] as const

const STATE_LABEL_KEYS = {
  new: "workbench.memory.state.new",
  changed: "workbench.memory.state.changed",
  unchanged: "workbench.memory.state.unchanged",
} as const

/**
 * The shared vocabulary. memory-skill and graphify both emit exactly these six,
 * which is what lets a map built by one be continued by the other.
 */
const TYPE_DESCRIPTION_KEYS: Record<string, TranslationKey> = {
  code: "workbench.memory.info.typeCode",
  document: "workbench.memory.info.typeDocument",
  paper: "workbench.memory.info.typePaper",
  image: "workbench.memory.info.typeImage",
  rationale: "workbench.memory.info.typeRationale",
  concept: "workbench.memory.info.typeConcept",
}

const KNOWN_TYPES = Object.keys(TYPE_DESCRIPTION_KEYS)

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    // A rule between sections rather than more blank space: the gaps inside a
    // section and between sections were close enough that the groups blurred.
    <section className="border-t border-border/60 pt-3 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-1.5 text-[12px] leading-5 text-foreground/90">{children}</div>
    </section>
  )
}

function Row({ marker, children }: { marker: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="flex w-3 shrink-0 justify-center pt-1.5">{marker}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}

export const WorkbenchMemoryTileInfo = memo(function WorkbenchMemoryTileInfo({
  workspaceId,
  laneId,
}: WorkbenchMemoryTileInfoProps) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const palette = resolveMemoryPalette(theme)
  const key = workspaceId ? buildProjectMemoryKey(workspaceId, laneId) : null
  const run =
    useProjectMemoryStore((state) => (key ? state.byKey[key] : undefined)) ??
    DEFAULT_PROJECT_MEMORY_RUN

  // Only describe the types this project actually has; a glossary of types that
  // never appear is noise.
  const presentTypes = useMemo(() => {
    const counts = new Map<string, number>()
    for (const node of run.graph?.nodes ?? []) {
      const type = node.fileType ?? "code"
      counts.set(type, (counts.get(type) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }))
  }, [run.graph])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 rounded-md text-muted-foreground hover:text-foreground"
          aria-label={t("workbench.memory.info.title")}
          title={t("workbench.memory.info.title")}
        >
          <HugeiconsIcon icon={__InfoHugeIcon} className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[70vh] w-80 overflow-y-auto p-3.5"
      >
        <Section title={t("workbench.memory.info.colourTitle")}>
          <p className="pb-0.5 text-muted-foreground">{t("workbench.memory.info.colourLead")}</p>
          {STATE_SWATCH_ORDER.map((swatch) => (
            <Row
              key={swatch}
              marker={
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: palette.state[swatch] }}
                  aria-hidden
                />
              }
            >
              {t(STATE_LABEL_KEYS[swatch])}
            </Row>
          ))}
        </Section>

        <Section title={t("workbench.memory.info.shapeTitle")}>
          <p className="pb-0.5 text-muted-foreground">{t("workbench.memory.info.shapeLead")}</p>
          <Row marker={<span className="size-2 rounded-full bg-foreground/70" aria-hidden />}>
            {t("workbench.memory.info.shapeCode")}
          </Row>
          <Row marker={<span className="size-2 rotate-45 bg-foreground/70" aria-hidden />}>
            {t("workbench.memory.info.shapeDocs")}
          </Row>
        </Section>

        {presentTypes.length > 0 ? (
          <Section title={t("workbench.memory.info.typesTitle")}>
            <p className="pb-0.5 text-muted-foreground">{t("workbench.memory.info.typesLead")}</p>
            {presentTypes.map(({ type, count }) => (
              <Row
                key={type}
                marker={
                  <span
                    className={
                      type === "code"
                        ? "size-2 rounded-full bg-foreground/70"
                        : "size-2 rotate-45 bg-foreground/70"
                    }
                    aria-hidden
                  />
                }
              >
                <span className="font-medium capitalize">{type}</span>{" "}
                <span className="tabular-nums text-muted-foreground">({count})</span>
                <span className="mt-0.5 block text-muted-foreground">
                  {TYPE_DESCRIPTION_KEYS[type]
                    ? t(TYPE_DESCRIPTION_KEYS[type])
                    : t("workbench.memory.info.typeUnknown")}
                </span>
              </Row>
            ))}
            {(() => {
              const absent = KNOWN_TYPES.filter(
                (type) => !presentTypes.some((entry) => entry.type === type),
              )
              if (absent.length === 0) return null
              return (
                <p className="pt-0.5 text-muted-foreground">
                  {t("workbench.memory.info.typesAbsent")} {absent.join(", ")}
                </p>
              )
            })()}
          </Section>
        ) : null}

        <Section title={t("workbench.memory.info.linksTitle")}>
          <p className="pb-0.5 text-muted-foreground">{t("workbench.memory.info.linksLead")}</p>
          <p>{t("workbench.memory.info.linksStructural")}</p>
          <p>{t("workbench.memory.info.linksMeaning")}</p>
          <p>{t("workbench.memory.info.linksSoft")}</p>
          <p className="pt-0.5 text-muted-foreground">
            {t("workbench.memory.info.linksConfidence")}
          </p>
        </Section>

        <Section title={t("workbench.memory.info.hoverTitle")}>
          <Row
            marker={
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: palette.focus }}
                aria-hidden
              />
            }
          >
            {t("workbench.memory.info.hoverFocus")}
          </Row>
          <Row
            marker={
              <span
                className="size-2 rounded-full border-2"
                style={{ borderColor: "rgba(255, 201, 64, 0.95)" }}
                aria-hidden
              />
            }
          >
            {t("workbench.memory.info.hoverNeighbors")}
          </Row>
        </Section>

        <Section title={t("workbench.memory.info.filterTitle")}>
          <p className="text-muted-foreground">{t("workbench.memory.info.filterLead")}</p>
        </Section>

        <Section title={t("workbench.memory.info.buildTitle")}>
          <p className="text-muted-foreground">{t("workbench.memory.info.buildLead")}</p>
        </Section>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

export default WorkbenchMemoryTileInfo
