import React from "react"
import { cn } from "@/lib/utils"
import {
  PROJECT_ICON_SETS,
  useProjectIconSetsStore,
  type ProjectIconSetId,
} from "@/stores/useProjectIconSetsStore"

import { HugeiconsIcon } from "@hugeicons/react"
import { Folder01Icon as __FolderHugeIcon } from "@hugeicons/core-free-icons"

/**
 * Every sprite carries a stable id: it selects the sprite's own idle animation
 * (`.cozea-sprite-<id>` in index.css) when the project is executing something.
 */
export interface ProjectSpriteDefinition {
  id: string
  rows: readonly string[]
}

const SPRITES_BY_SET: Record<ProjectIconSetId, readonly ProjectSpriteDefinition[]> = {
  invaders: [
    {
      id: "crab",
      rows: [
        "x.....x",
        ".xxxxx.",
        "xx.x.xx",
        "xxxxxxx",
        ".x.x.x.",
        "x.....x",
      ],
    },
    {
      id: "squid",
      rows: [
        "..xxx..",
        ".xxxxx.",
        "xx.x.xx",
        "xxxxxxx",
        ".x.x.x.",
        "x.x.x.x",
      ],
    },
    {
      id: "octopus",
      rows: [
        ".xxxxx.",
        "xxxxxxx",
        "x.xxx.x",
        "xxxxxxx",
        ".x.x.x.",
        "x.....x",
      ],
    },
  ],
  pacman: [
    {
      id: "pacman",
      rows: [
        "..xxxx..",
        ".xxxxxx.",
        "xxxxxxxx",
        "xxxxxx..",
        "xxxx....",
        "xxxxxx..",
        ".xxxxxx.",
        "..xxxx..",
      ],
    },
    {
      id: "ghost",
      rows: [
        "..xxxx..",
        ".xxxxxx.",
        "xx.xx.xx",
        "xx.xx.xx",
        "xxxxxxxx",
        "xxxxxxxx",
        "xxxxxxxx",
        "x.x..x.x",
      ],
    },
    {
      id: "cherry",
      rows: [
        ".....xx.",
        "....xx..",
        "..xxx...",
        ".x..xx..",
        "xx..xx..",
        "xxxx.xxx",
        "xxxx.xxx",
        ".xx...xx",
      ],
    },
  ],
  tetris: [
    {
      id: "tetris-t",
      rows: [
        "xxx.xxx.xxx",
        "x.x.x.x.x.x",
        "xxx.xxx.xxx",
        "...........",
        "....xxx....",
        "....x.x....",
        "....xxx....",
      ],
    },
    {
      id: "tetris-l",
      rows: [
        "xxx........",
        "x.x........",
        "xxx........",
        "...........",
        "xxx.xxx.xxx",
        "x.x.x.x.x.x",
        "xxx.xxx.xxx",
      ],
    },
    {
      id: "tetris-z",
      rows: [
        "xxx.xxx....",
        "x.x.x.x....",
        "xxx.xxx....",
        "...........",
        "....xxx.xxx",
        "....x.x.x.x",
        "....xxx.xxx",
      ],
    },
    {
      id: "tetris-o",
      rows: [
        "xxx.xxx",
        "x.x.x.x",
        "xxx.xxx",
        ".......",
        "xxx.xxx",
        "x.x.x.x",
        "xxx.xxx",
      ],
    },
    {
      id: "tetris-s",
      rows: [
        "....xxx.xxx",
        "....x.x.x.x",
        "....xxx.xxx",
        "...........",
        "xxx.xxx....",
        "x.x.x.x....",
        "xxx.xxx....",
      ],
    },
  ],
  adventure: [
    {
      id: "starfighter",
      rows: [
        "...xx...",
        "...xx...",
        "..xxxx..",
        ".xxxxxx.",
        "xxxxxxxx",
        "xx.xx.xx",
        "x..xx..x",
      ],
    },
    {
      id: "heart",
      rows: [
        ".xx..xx.",
        "xxxxxxxx",
        "xxxxxxxx",
        "xxxxxxxx",
        ".xxxxxx.",
        "..xxxx..",
        "...xx...",
      ],
    },
    {
      id: "star",
      rows: [
        "...xx...",
        "...xx...",
        "xxxxxxxx",
        ".xxxxxx.",
        "..xxxx..",
        ".xx..xx.",
        "xx....xx",
      ],
    },
    {
      id: "mushroom",
      rows: [
        "..xxxx..",
        ".xxxxxx.",
        "xx.xx.xx",
        "xxxxxxxx",
        "..xxxx..",
        "..xxxx..",
      ],
    },
    {
      id: "key",
      rows: [
        "..xxxx..",
        ".xx..xx.",
        "..xxxx..",
        "...xx...",
        "...xxxx.",
        "...xx...",
        "...xxxx.",
      ],
    },
    {
      id: "gem",
      rows: [
        "...xx...",
        "..xxxx..",
        ".xxxxxx.",
        "xxxxxxxx",
        ".xxxxxx.",
        "..xxxx..",
        "...xx...",
      ],
    },
    {
      id: "potion",
      rows: [
        "...xx...",
        "...xx...",
        "..xxxx..",
        ".xxxxxx.",
        "xxxxxxxx",
        "xxxxxxxx",
        ".xxxxxx.",
      ],
    },
    {
      id: "skull",
      rows: [
        "..xxxx..",
        ".xxxxxx.",
        "xx.xx.xx",
        ".xxxxxx.",
        "..xxxx..",
        "..x..x..",
      ],
    },
    {
      id: "sword",
      rows: [
        "......xx",
        ".....xx.",
        "....xx..",
        "...xx...",
        "..xx....",
        ".xxxx...",
        "x..xx...",
      ],
    },
  ],
}

export const RETRO_ARCADE_COLORS: readonly string[] = [
  // Theme-aware: each token is vivid on the dark themes and muted under
  // `.light`, where the vivid set is unreadable. See index.css.
  "var(--cozea-arcade-1)", // Emerald green
  "var(--cozea-arcade-2)", // Cyan
  "var(--cozea-arcade-3)", // Bright orange
  "var(--cozea-arcade-4)", // Sky blue
  "var(--cozea-arcade-5)", // Mint green
  "var(--cozea-arcade-6)", // Pink / magenta
  "var(--cozea-arcade-7)", // Amber / warm gold
  "var(--cozea-arcade-8)", // Lime green
  "var(--cozea-arcade-9)", // Teal / sage
  "var(--cozea-arcade-10)", // Lavender
  "var(--cozea-arcade-11)", // Purple
  "var(--cozea-arcade-12)", // Yellow
]

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

interface PrecomputedSprite {
  id: string
  path: string
  viewBox: string
}

function precomputeSprite(sprite: ProjectSpriteDefinition): PrecomputedSprite {
  const height = sprite.rows.length
  const width = sprite.rows[0].length
  let path = ""
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < sprite.rows[y].length; x++) {
      if (sprite.rows[y][x] === "x") {
        path += `M${x + 1} ${y + 1}h1v1h-1z `
      }
    }
  }
  return {
    id: sprite.id,
    path: path.trim(),
    viewBox: `0 0 ${width + 2} ${height + 2}`,
  }
}

const PRECOMPUTED_BY_SET: Record<ProjectIconSetId, readonly PrecomputedSprite[]> = {
  invaders: SPRITES_BY_SET.invaders.map(precomputeSprite),
  pacman: SPRITES_BY_SET.pacman.map(precomputeSprite),
  tetris: SPRITES_BY_SET.tetris.map(precomputeSprite),
  adventure: SPRITES_BY_SET.adventure.map(precomputeSprite),
}

/**
 * Fixed iteration order. Flattening `enabledSets` with `Object.entries` would key
 * the sprite lookup off the persisted JSON's key order, so a project's icon could
 * change identity between launches.
 */
const ICON_SET_ORDER: readonly ProjectIconSetId[] = PROJECT_ICON_SETS.map((set) => set.id)

export interface ProjectPixelInvaderIconProps {
  name: string
  className?: string
  colorOverride?: string
  /** Forces rendering from a specific set (used for settings preview) */
  forceSetId?: ProjectIconSetId
  /** Sample index within the set */
  sampleIndex?: number
  /** Whether the project is actively executing a process (triggers the sprite's animation) */
  isActive?: boolean
}

export const ProjectPixelInvaderIcon = React.memo(function ProjectPixelInvaderIcon({
  name,
  className,
  colorOverride,
  forceSetId,
  sampleIndex,
  isActive,
}: ProjectPixelInvaderIconProps) {
  const enabledSets = useProjectIconSetsStore((state) => state.enabledSets)

  const sprites = React.useMemo(() => {
    if (forceSetId) return PRECOMPUTED_BY_SET[forceSetId]
    const gathered: PrecomputedSprite[] = []
    for (const setId of ICON_SET_ORDER) {
      if (enabledSets[setId]) gathered.push(...PRECOMPUTED_BY_SET[setId])
    }
    return gathered
  }, [enabledSets, forceSetId])

  const hash = React.useMemo(() => hashString(name || "project"), [name])

  // Every set disabled: fall back to the plain library folder icon. The folder
  // deliberately stays still even while the project is executing — the row's
  // name shimmer carries the signal on its own.
  if (sprites.length === 0) {
    return (
      <HugeiconsIcon
        icon={__FolderHugeIcon}
        className={cn("size-4 shrink-0 text-muted-foreground/75", className)}
        aria-hidden="true"
      />
    )
  }

  const spriteIndex = (forceSetId ? (sampleIndex ?? 0) : hash) % sprites.length
  const sprite = sprites[spriteIndex]
  const colorIndex = forceSetId
    ? spriteIndex % RETRO_ARCADE_COLORS.length
    : Math.floor(hash / sprites.length) % RETRO_ARCADE_COLORS.length
  const color = colorOverride ?? RETRO_ARCADE_COLORS[colorIndex]

  // `style.color` exists for the keyframes: the glow and flare steps reach for
  // currentColor, which would otherwise resolve to the row's text colour.
  return (
    <svg
      viewBox={sprite.viewBox}
      fill={color}
      style={{ color }}
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={cn(
        "size-4.5 shrink-0 overflow-visible",
        isActive && `cozea-sprite-active cozea-sprite-${sprite.id}`,
        className,
      )}
    >
      <path d={sprite.path} />
    </svg>
  )
})
