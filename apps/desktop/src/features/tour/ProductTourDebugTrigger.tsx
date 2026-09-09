/**
 * TEMPORARY. Remove before release.
 *
 * A header button that clears the "already seen" record and replays the product
 * tour from step one, so the tutorial can be reviewed without wiping app data
 * or creating a fresh device identity.
 *
 * To remove: delete this file, its entry in `components/layouts/UnifiedHeader.tsx`
 * (search for PRODUCT TOUR DEBUG), and `productTourStore.ts` if nothing else has
 * started using it by then.
 */

import { useProductTourStore } from "./productTourStore"

export function ProductTourDebugTrigger() {
  const requestRestart = useProductTourStore((state) => state.requestRestart)

  return (
    <button
      type="button"
      onClick={requestRestart}
      title="Temporary: replay the first run tutorial"
      className="titlebar-no-drag flex h-6 shrink-0 items-center rounded-md border border-dashed border-amber-500/60 px-2 text-[11px] font-medium text-amber-600 transition-colors hover:bg-amber-500/10 dark:text-amber-400"
    >
      Run tutorial
    </button>
  )
}

export default ProductTourDebugTrigger
