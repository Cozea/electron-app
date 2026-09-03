/**
 * Single definition site for the organization accent in the DevApps Store.
 * The tokens themselves live in `index.css` and are redefined per theme, so
 * every store surface must reach them through this constant rather than
 * re-typing the `var(--store-organization-accent…)` pair.
 */
export const STORE_ORGANIZATION_ACCENT_CLASS =
  "bg-[var(--store-organization-accent-surface)] text-[var(--store-organization-accent)]"
