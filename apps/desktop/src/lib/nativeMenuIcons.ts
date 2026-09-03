export type MenuIconId =
  | "open-project"
  | "new-project"
  | "open-folder"
  | "relink"
  | "close"
  | "archive"
  | "restore"
  | "delete"
  | "settings"
  | "package"
  | "rename"
  | "edit"
  | "plus"
  | "move-up"
  | "move-down"
  | "sync"
  | "maximize"
  | "split-right"
  | "split-down"
  | "float"
  | "popout"
  | "dock"
  | "copy"
  | "git-fork"
  | "organizations"
  | "theme"
  | "logout"
  | "shield"
  | "crown"
  | "user-minus"
  | "search"
  | "camera"
  | "record"
  | "smartphone"
  | "volume"
  | "volume-x"
  | "tools"
  | "code"
  | "branch"
  | "check"
  | "filter"
  | "sort"

const ICON_PATHS: Record<MenuIconId, readonly string[]> = {
  "open-project": [
    "M2 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H6a2 2 0 0 0-1.8 1.1L2 17V6z",
    "M22 13v-2H6.2a2 2 0 0 0-1.8 1.1L2 19h16.2a2 2 0 0 0 1.8-1.1L22 13z",
  ],
  "new-project": ["M5 12h14", "M12 5v14"],
  "open-folder": [
    "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
  ],
  relink: [
    "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",
    "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  ],
  close: ["M18 6L6 18", "M6 6l12 12"],
  archive: [
    "M2 3h20v5H2z",
    "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8",
    "M10 12h4",
  ],
  restore: [
    "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
    "M3 3v5h5",
  ],
  delete: [
    "M3 6h18",
    "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
    "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
    "M10 11v6",
    "M14 11v6",
  ],
  settings: [
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  ],
  package: [
    "M16.5 9.4 7.55 4.24",
    "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z",
    "M3.29 7 12 12l8.71-5",
    "M12 22V12",
  ],
  rename: [
    "M12 20h9",
    "M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  ],
  edit: [
    "M12 20h9",
    "M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  ],
  plus: ["M5 12h14", "M12 5v14"],
  "move-up": ["M18 15l-6-6-6 6"],
  "move-down": ["M6 9l6 6 6-6"],
  sync: [
    "M21.5 2v6h-6",
    "M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67",
  ],
  maximize: [
    "M8 3H5a2 2 0 0 0-2 2v3",
    "M21 8V5a2 2 0 0 0-2-2h-3",
    "M3 16v3a2 2 0 0 0 2 2h3",
    "M16 21h3a2 2 0 0 0 2-2v-3",
  ],
  "split-right": [
    "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z",
    "M12 3v18",
  ],
  "split-down": [
    "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z",
    "M3 12h18",
  ],
  float: [
    "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z",
    "M13 11h6v6h-6z",
  ],
  popout: [
    "M15 3h6v6",
    "M10 14L21 3",
    "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  ],
  dock: ["M12 3v12", "M8 11l4 4 4-4", "M3 21h18"],
  copy: [
    "M8 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z",
    "M4 16V4a2 2 0 0 1 2-2h10",
  ],
  "git-fork": [
    "M6 3v12",
    "M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    "M18 9a9 9 0 0 1-9 9",
  ],
  organizations: [
    "M3 21h18",
    "M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16",
    "M9 7h1",
    "M14 7h1",
    "M9 11h1",
    "M14 11h1",
    "M9 15h1",
    "M14 15h1",
    "M10 21v-3h4v3",
  ],
  theme: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"],
  logout: [
    "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",
    "M16 17l5-5-5-5",
    "M21 12H9",
  ],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"],
  crown: ["M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z", "M5 20h14"],
  "user-minus": [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    "M19 11h4",
  ],
  search: [
    "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
    "M21 21l-4.35-4.35",
  ],
  camera: [
    "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z",
    "M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  ],
  record: [
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
    "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  ],
  smartphone: [
    "M5 2h14a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z",
    "M12 18h.01",
  ],
  volume: [
    "M11 5L6 9H2v6h4l5 4V5z",
    "M19.07 4.93a10 10 0 0 1 0 14.14",
    "M15.54 8.46a5 5 0 0 1 0 7.07",
  ],
  "volume-x": [
    "M11 5L6 9H2v6h4l5 4V5z",
    "M23 9l-6 6",
    "M17 9l6 6",
  ],
  tools: [
    "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
  ],
  code: [
    "M16 18l6-6-6-6",
    "M8 6l-6 6 6 6",
  ],
  branch: [
    "M6 3v12",
    "M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    "M18 9a9 9 0 0 1-9 9",
  ],
  check: ["M20 6L9 17l-5-5"],
  filter: [
    "M22 3H2l8 9.46V19l4 2v-8.54L22 3z",
  ],
  sort: [
    "M3 16l4 4 4-4",
    "M7 20V4",
    "M21 8l-4-4-4 4",
    "M17 4v16",
  ],
}

const iconCache = new Map<string, string>()

export function getNativeMenuIcon(iconId: MenuIconId): string | undefined {
  if (typeof document === "undefined") return undefined
  const cached = iconCache.get(iconId)
  if (cached) return cached

  const paths = ICON_PATHS[iconId]
  if (!paths) return undefined

  try {
    const canvas = document.createElement("canvas")
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext("2d")
    if (!ctx) return undefined

    ctx.scale(32 / 24, 32 / 24)
    ctx.strokeStyle = "#000000"
    ctx.fillStyle = "#000000"
    ctx.lineWidth = 1.75
    ctx.lineCap = "round"
    ctx.lineJoin = "round"

    for (const pathStr of paths) {
      ctx.stroke(new Path2D(pathStr))
    }

    const dataUrl = canvas.toDataURL("image/png")
    iconCache.set(iconId, dataUrl)
    return dataUrl
  } catch {
    return undefined
  }
}
