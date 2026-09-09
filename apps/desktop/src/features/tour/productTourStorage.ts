/**
 * Local persistence for the first-run product tour.
 *
 * LOCAL ONLY, DELIBERATELY. The durable home for this flag is the device
 * principal in Convex, next to `presentationConfiguredAt`, so that a reinstall
 * or a cleared cache does not replay the tour. That move was deferred to avoid
 * a schema change and a production deploy. See `.agent/TODO-tour-persistence.md`.
 *
 * Every access is guarded: storage throws outright in some embedded contexts,
 * and returns nothing in a fresh profile. A tour that cannot read its own
 * progress must fail closed and stay silent rather than replay on every launch.
 */

const STORAGE_KEY = "cozea:product-tour:v1";

export type ProductTourStatus = "pending" | "completed" | "skipped";

export interface ProductTourProgress {
  status: ProductTourStatus;
  /** Zero based index of the step the user should resume at. */
  stepIndex: number;
  updatedAt: number;
}

const PENDING_AT_START: ProductTourProgress = {
  status: "pending",
  stepIndex: 0,
  updatedAt: 0,
};

function isStatus(value: unknown): value is ProductTourStatus {
  return value === "pending" || value === "completed" || value === "skipped";
}

/**
 * Reads saved progress. Any unreadable or malformed record is treated as a
 * fresh start, which is the safe direction: a new user still sees the tour.
 */
export function readProductTourProgress(): ProductTourProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return PENDING_AT_START;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return PENDING_AT_START;

    const record = parsed as Partial<ProductTourProgress>;
    if (!isStatus(record.status)) return PENDING_AT_START;

    const stepIndex =
      typeof record.stepIndex === "number" &&
      Number.isFinite(record.stepIndex) &&
      record.stepIndex >= 0
        ? Math.floor(record.stepIndex)
        : 0;

    return {
      status: record.status,
      stepIndex,
      updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
    };
  } catch {
    return PENDING_AT_START;
  }
}

/**
 * Persists progress. A failed write is not an error the user should ever see:
 * the worst outcome is that the tour is offered again on the next launch.
 */
export function writeProductTourProgress(progress: Omit<ProductTourProgress, "updatedAt">): void {
  try {
    const record: ProductTourProgress = { ...progress, updatedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage is unavailable or full. Nothing actionable here.
  }
}

/** True once the tour has been completed or explicitly skipped. */
export function isProductTourFinished(progress: ProductTourProgress): boolean {
  return progress.status === "completed" || progress.status === "skipped";
}

/** Test and support seam. Not wired to any user facing control. */
export function resetProductTourProgress(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing actionable here either.
  }
}
