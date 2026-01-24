export interface GeneratedPlanPage {
  id?: string
  name: string
  route?: string
  type?: string
  purpose?: string
  actions?: string[]
}

export interface GeneratedPlanEntity {
  id?: string
  name: string
  fields?: string[]
}

export interface GeneratedPlan {
  pages: GeneratedPlanPage[]
  entities: GeneratedPlanEntity[]
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function ensureId(value?: string): string {
  if (value && value.trim().length > 0) return value
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `id_${Math.random().toString(36).slice(2, 10)}`
}

function ensureRoute(name: string, route?: string): string {
  if (route && route.trim().length > 0) {
    return route.startsWith("/") ? route : `/${route}`
  }
  const base = slugify(name || "page")
  return `/${base || "page"}`
}

export function normalizeGeneratedPlan(plan: GeneratedPlan): GeneratedPlan {
  const pages = (plan.pages || []).map((page) => {
    const name = page.name || "Untitled Page"
    return {
      id: ensureId(page.id),
      name,
      route: ensureRoute(name, page.route),
      type: page.type || "page",
      purpose: page.purpose,
      actions: page.actions,
    }
  })

  const entities = (plan.entities || []).map((entity) => ({
    id: ensureId(entity.id),
    name: entity.name || "Entity",
    fields: entity.fields,
  }))

  return { pages, entities }
}
