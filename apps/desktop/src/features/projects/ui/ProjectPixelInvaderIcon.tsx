import React from "react"
import { cn } from "@/lib/utils"

const SPRITES: readonly (readonly string[])[] = [
  // 0: Classic Crab (like monocode)
  [
    "..x.....x..",
    "...x...x...",
    "..xxxxxxx..",
    ".xx.xxx.xx.",
    "xxxxxxxxxxx",
    "x.xxxxxxx.x",
    "x.x.....x.x",
    "...xx.xx...",
  ],
  // 1: Squid / Jellyfish (like roxy, murdock-studio)
  [
    "....xxx....",
    "...xxxxx...",
    "..xxxxxxx..",
    ".xx.xxx.xx.",
    ".xxxxxxxxx.",
    "...x.x.x...",
    "..x.....x..",
    ".x.......x.",
  ],
  // 2: Octopus (like oss)
  [
    "...xxxxx...",
    ".xxxxxxxxx.",
    "xxxxxxxxxxx",
    "xx..xxx..xx",
    "xxxxxxxxxxx",
    "..xx.x.xx..",
    ".xx.....xx.",
    "x.x.....x.x",
  ],
  // 3: Robot / Bug (like counter-craft-strike)
  [
    "..xxxxxxx..",
    ".xxxxxxxxx.",
    ".xx.xxx.xx.",
    ".xxxxxxxxx.",
    "..xxxxxxx..",
    "..xx.x.xx..",
    ".xx.....xx.",
    "x.........x",
  ],
  // 4: Antenna Alien (like agent-os, tiny-files)
  [
    "x.........x",
    "..xxxxxxx..",
    ".xxxxxxxxx.",
    ".xx.xxx.xx.",
    ".xxxxxxxxx.",
    "..xxxxxxx..",
    "..x.....x..",
    ".xx.....xx.",
  ],
  // 5: Saucer / Beetle (like fun, bloomspace)
  [
    "...xxxxx...",
    ".xxxxxxxxx.",
    "xxxxxxxxxxx",
    "xx..xxx..xx",
    "xxxxxxxxxxx",
    ".x.xxxxx.x.",
    "x.........x",
    ".xx.....xx.",
  ],
  // 6: Winged Alien (like cbkai-orbit, clipface)
  [
    "x.........x",
    ".x.......x.",
    "..xxxxxxx..",
    ".xx.xxx.xx.",
    ".xxxxxxxxx.",
    "..x.xxx.x..",
    ".x.......x.",
    "x.........x",
  ],
  // 7: Star Alien (like tuis)
  [
    "..x.....x..",
    "...x...x...",
    "..xxxxxxx..",
    ".xx.xxx.xx.",
    "xxxxxxxxxxx",
    "..xx.x.xx..",
    ".x.......x.",
    "..x.....x..",
  ],
]

export const RETRO_INVADER_COLORS: readonly string[] = [
  "#22c55e", // Emerald green (like monocode)
  "#06b6d4", // Cyan (like roxy)
  "#f97316", // Vivid orange (like oss)
  "#38bdf8", // Sky blue (like counter-craft-strike)
  "#34d399", // Mint green (like formshare)
  "#ec4899", // Pink / magenta (like agent-os)
  "#f59e0b", // Amber / warm gold
  "#84cc16", // Lime green (like tuis)
  "#10b981", // Teal / sage (like bloomspace)
  "#c084fc", // Lavender (like cbkai-orbit)
  "#a855f7", // Purple (like clipface)
  "#eab308", // Yellow (like tiny-files)
]

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function spriteToSvgPath(sprite: readonly string[]): string {
  let path = ""
  for (let y = 0; y < sprite.length; y++) {
    for (let x = 0; x < sprite[y].length; x++) {
      if (sprite[y][x] === "x") {
        path += `M${x + 1} ${y + 1}h1v1h-1z `
      }
    }
  }
  return path.trim()
}

const PRECOMPUTED_PATHS = SPRITES.map(spriteToSvgPath)

export interface ProjectPixelInvaderIconProps {
  name: string
  className?: string
  colorOverride?: string
}

export const ProjectPixelInvaderIcon = React.memo(function ProjectPixelInvaderIcon({
  name,
  className,
  colorOverride,
}: ProjectPixelInvaderIconProps) {
  const hash = React.useMemo(() => hashString(name || "project"), [name])
  const spriteIndex = hash % SPRITES.length
  const colorIndex = Math.floor(hash / SPRITES.length) % RETRO_INVADER_COLORS.length

  const path = PRECOMPUTED_PATHS[spriteIndex]
  const color = colorOverride ?? RETRO_INVADER_COLORS[colorIndex]

  return (
    <svg
      viewBox="0 0 13 10"
      fill={color}
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={cn("size-4 shrink-0 overflow-visible", className)}
    >
      <path d={path} />
    </svg>
  )
})
