export function buildProjectBasePath(projectId: string): string {
  return `/projects/p/${encodeURIComponent(projectId)}`
}

export function buildProjectPath(projectId: string, segment?: string): string {
  const base = buildProjectBasePath(projectId)
  if (!segment) return base
  const normalized = segment.replace(/^\/+/, "")
  return normalized.length > 0 ? `${base}/${normalized}` : base
}

export function buildLegacyProjectPath(slug: string, segment?: string): string {
  const base = `/projects/${encodeURIComponent(slug)}`
  if (!segment) return base
  const normalized = segment.replace(/^\/+/, "")
  return normalized.length > 0 ? `${base}/${normalized}` : base
}

export function parseProjectRoute(pathname: string): {
  projectId: string | null
  slug: string | null
} {
  const canonical = pathname.match(/^\/projects\/p\/([^/]+)/)
  if (canonical) {
    return {
      projectId: decodeURIComponent(canonical[1]),
      slug: null,
    }
  }

  const legacy = pathname.match(/^\/projects\/([^/]+)/)
  if (legacy && legacy[1] !== "new" && legacy[1] !== "join") {
    return {
      projectId: null,
      slug: decodeURIComponent(legacy[1]),
    }
  }

  return { projectId: null, slug: null }
}
