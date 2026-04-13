import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";

import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { fetchWithAbort } from "@/lib/abort";
import { NO_ACTIVE_PLAN_LABEL } from "@/lib/billing/planLabels";
import { useScopedBillingData } from "@/hooks/useScopedBillingData";
import { useQueryCache } from "@/stores/useQueryCache";
import { openExternalUrl } from "@/lib/electron/shellClient";
import {
  AUTH_SERVER_URL,
  type BillingCycle,
  type CheckoutPlan,
  ENTERPRISE_PLAN_CARD,
  ENTERPRISE_SALES_MAILTO,
  formatBillingCycleLabel,
  formatDate,
  formatDisplayCurrencyFromCents,
  formatEntitlementStatus,
  getPageNumbers,
  getPlanCtaLabel,
  getPlanDisplayName,
  getPlanIncludedFeatures,
  INACTIVE_PLAN_STATUS_LABEL,
  INVOICE_CACHE_MAX_AGE_MS,
  INDIVIDUAL_PLAN_CARDS,
  isAbortError,
  isSeatManagedEntitlement,
  normalizeCurrentPlanForCards,
  normalizeSeatQuantity,
  type PlanTierId,
  PLAN_TIER_RANK,
  planLabel,
  resolvePlanAmountCents,
  resolvePlanCurrency,
  resolvePlanPricing,
  SEAT_ASSIGNMENTS_PAGE_SIZE,
  type ScheduledCycleChange,
  STARTUP_MIN_SEATS,
  STARTUP_PLAN_CARD,
  type StripeCatalogResponse,
  type StripeInvoice,
} from "./billingShared";

interface UseBillingControllerOptions {
  surface: "page" | "drawer" | "content";
  route?: string;
}

export function useBillingController({ surface, route }: UseBillingControllerOptions) {
  const {
    convexUserId,
    accessToken,
    settingsPage,
    convexOrg,
    workspaceScoped,
    canManageWorkspaceBilling,
    billingOrganizationId,
    billingRoute,
    members,
    seatManagement,
    hasResolvedMembers,
    isRefreshingMembers,
  } = useScopedBillingData({ route });

  const setSeatAssignment = useMutation(api.billing.setSeatAssignment);

  const [stripeInvoices, setStripeInvoices] = useState<StripeInvoice[] | null>(null);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [hasResolvedInvoices, setHasResolvedInvoices] = useState(false);
  const [pricingCatalog, setPricingCatalog] = useState<StripeCatalogResponse | null>(null);
  const [scheduledCycleChange, setScheduledCycleChange] = useState<ScheduledCycleChange | null>(null);
  const [, setIsCatalogLoading] = useState(false);
  const [isCheckoutPending, setIsCheckoutPending] = useState(false);
  const [isCycleChangePending, setIsCycleChangePending] = useState(false);
  const [isCancelScheduledCycleChangePending, setIsCancelScheduledCycleChangePending] = useState(false);
  const [isPortalPending, setIsPortalPending] = useState(false);
  const [isSeatQuantityUpdating, setIsSeatQuantityUpdating] = useState(false);
  const [showUpgradeOptions, setShowUpgradeOptions] = useState(false);
  const [pendingDowngradeTargetPlanId, setPendingDowngradeTargetPlanId] = useState<PlanTierId | null>(null);
  const [seatMutationUserId, setSeatMutationUserId] = useState<string | null>(null);
  const [seatMutationError, setSeatMutationError] = useState<string | null>(null);
  const [seatAssignmentsPage, setSeatAssignmentsPage] = useState(1);

  const [checkoutCycle, setCheckoutCycle] = useState<BillingCycle>("monthly");
  const [checkoutSeatQuantity, setCheckoutSeatQuantity] = useState<number>(STARTUP_MIN_SEATS);

  const invoiceCacheKey = useMemo(() => {
    const scopeKey = workspaceScoped ? "workspace" : "personal";
    return `billing-invoices-${scopeKey}-${billingOrganizationId ?? "pending"}`;
  }, [billingOrganizationId, workspaceScoped]);

  const cachedStripeInvoices = useQueryCache(
    useCallback((state) => {
      const entry = state.cache[invoiceCacheKey];
      if (!entry) return undefined;
      if (Date.now() - entry.timestamp > INVOICE_CACHE_MAX_AGE_MS) return undefined;
      return entry.data as StripeInvoice[];
    }, [invoiceCacheKey]),
  );

  const visibleStripeInvoices = stripeInvoices ?? cachedStripeInvoices ?? [];
  const shouldShowInvoiceLoading =
    invoicesLoading || (!hasResolvedInvoices && visibleStripeInvoices.length === 0);

  useEffect(() => {
    setStripeInvoices(null);
    setInvoicesLoading(false);
    setHasResolvedInvoices(false);
  }, [invoiceCacheKey]);

  useEffect(() => {
    if (!seatManagement) return;

    const cycle =
      seatManagement.accountSubscription?.cycle === "yearly" ? "yearly" : "monthly";
    const subscriptionSeats =
      typeof seatManagement.accountSubscription?.seatQuantity === "number"
        ? seatManagement.accountSubscription.seatQuantity
        : undefined;
    const entitlementSeats =
      typeof seatManagement.entitlement?.seatCounts?.total === "number"
        ? seatManagement.entitlement.seatCounts.total
        : undefined;

    const syncedSeatQuantity = normalizeSeatQuantity(
      subscriptionSeats ?? entitlementSeats ?? STARTUP_MIN_SEATS,
    );

    setCheckoutCycle(cycle);
    setCheckoutSeatQuantity((current) => (
      current === syncedSeatQuantity ? current : syncedSeatQuantity
    ));
  }, [
    seatManagement,
    seatManagement?.accountSubscription?.cycle,
    seatManagement?.accountSubscription?.seatQuantity,
    seatManagement?.accountSubscription?.updatedAt,
    seatManagement?.entitlement?.seatCounts?.total,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const fetchScheduledCycleChange = async () => {
      if (!billingOrganizationId || !accessToken) {
        if (!cancelled) {
          setScheduledCycleChange(null);
        }
        return;
      }

      try {
        const response = await fetchWithAbort(
          `${AUTH_SERVER_URL}/stripe/scheduled-cycle-change?organizationId=${billingOrganizationId}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            signal: controller.signal,
          },
          { signal: controller.signal, timeoutMs: 15000 },
        );

        if (!response.ok) {
          if (!cancelled) {
            setScheduledCycleChange(null);
          }
          return;
        }

        const data = (await response.json()) as {
          pendingChange?: ScheduledCycleChange | null;
        };
        if (!cancelled) {
          setScheduledCycleChange(data.pendingChange ?? null);
        }
      } catch (err) {
        if (isAbortError(err)) return;
        console.error("Failed to fetch scheduled cycle change:", err);
        if (!cancelled) {
          setScheduledCycleChange(null);
        }
      }
    };

    void fetchScheduledCycleChange();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [billingOrganizationId, accessToken]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const fetchCatalog = async () => {
      setIsCatalogLoading(true);
      try {
        const headers: Record<string, string> = {};
        if (accessToken) {
          headers.Authorization = `Bearer ${accessToken}`;
        }

        const response = await fetchWithAbort(
          `${AUTH_SERVER_URL}/stripe/catalog`,
          {
            method: "GET",
            headers,
            signal: controller.signal,
          },
          { signal: controller.signal, timeoutMs: 10000 },
        );

        if (!response.ok) return;
        const data = (await response.json().catch(() => null)) as StripeCatalogResponse | null;
        if (!cancelled && data) {
          setPricingCatalog(data);
        }
      } catch (err) {
        if (isAbortError(err)) return;
        console.error("Failed to load Stripe catalog:", err);
      } finally {
        if (!cancelled) {
          setIsCatalogLoading(false);
        }
      }
    };

    void fetchCatalog();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accessToken]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const fetchInvoices = async () => {
      if (!billingOrganizationId || !accessToken) return;

      setInvoicesLoading(true);
      try {
        const response = await fetchWithAbort(
          `${AUTH_SERVER_URL}/stripe/invoices?organizationId=${billingOrganizationId}&limit=10`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            signal: controller.signal,
          },
          { signal: controller.signal, timeoutMs: 15000 },
        );
        const data = (await response.json().catch(() => null)) as
          | {
              invoices?: StripeInvoice[];
              error?: string;
            }
          | null;

        if (response.ok) {
          const nextInvoices = data?.invoices ?? [];
          if (!cancelled) {
            setStripeInvoices(nextInvoices);
            setHasResolvedInvoices(true);
          }
          useQueryCache.getState().set(invoiceCacheKey, nextInvoices);
        } else if (!cancelled) {
          setHasResolvedInvoices(true);
        }
      } catch (err) {
        if (isAbortError(err)) return;
        console.error("Failed to fetch invoices:", err);
        if (!cancelled) {
          setHasResolvedInvoices(true);
        }
      } finally {
        if (!cancelled) {
          setInvoicesLoading(false);
        }
      }
    };

    void fetchInvoices();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accessToken, billingOrganizationId, invoiceCacheKey]);

  const entitlement = seatManagement?.entitlement;
  const currentPlanName = planLabel({
    source: entitlement?.source,
    plan: entitlement?.plan,
    workspaceScoped,
  });
  const paidSeatTotal = entitlement?.seatCounts.total ?? 0;
  const paidSeatAssigned = entitlement?.seatCounts.assigned ?? 0;
  const paidSeatAvailable = entitlement?.seatCounts.available ?? 0;
  const paidSeatProgress =
    paidSeatTotal > 0 ? Math.min((paidSeatAssigned / paidSeatTotal) * 100, 100) : 0;

  const activeAssignmentsByUserId = useMemo(() => {
    const map = new Set<string>();
    for (const assignment of seatManagement?.seatAssignments ?? []) {
      map.add(String(assignment.assignedUserId));
    }
    return map;
  }, [seatManagement?.seatAssignments]);

  const billingOwnerId = seatManagement?.billingAccount?.billingUserId
    ? String(seatManagement.billingAccount.billingUserId)
    : null;
  const canManageSeats = seatManagement?.canManageSeats ?? false;
  const canOpenCheckout = workspaceScoped ? canManageWorkspaceBilling : true;
  const hasPastDueEntitlement = entitlement?.status === "past_due";
  const seatManagedEntitlement = isSeatManagedEntitlement({
    source: entitlement?.source,
    plan: entitlement?.plan,
    workspaceScoped,
  });
  const showPaidSeatSummary = seatManagedEntitlement || paidSeatTotal > 0;
  const hasBillingOverviewContent =
    showPaidSeatSummary || (seatManagedEntitlement && Boolean(seatManagement?.billingUser));
  const currentPlanIdForCards = normalizeCurrentPlanForCards(
    entitlement?.source,
    entitlement?.plan,
    workspaceScoped,
  );
  const hasNoActivePlan = currentPlanIdForCards === "free";
  const currentPlanHeading = hasNoActivePlan ? NO_ACTIVE_PLAN_LABEL : `${currentPlanName} plan`;
  const entitlementStatusLabel = hasNoActivePlan
    ? INACTIVE_PLAN_STATUS_LABEL
    : formatEntitlementStatus(entitlement?.status);
  const currentPlanIsCanceled =
    entitlement?.status === "canceled" && currentPlanIdForCards !== "free";
  const currentSubscriptionCycle: BillingCycle =
    seatManagement?.accountSubscription?.cycle === "yearly" ? "yearly" : "monthly";
  const currentSeatQuantity =
    typeof seatManagement?.accountSubscription?.seatQuantity === "number"
      ? normalizeSeatQuantity(seatManagement.accountSubscription.seatQuantity)
      : typeof entitlement?.seatCounts?.total === "number" && entitlement.seatCounts.total > 0
        ? normalizeSeatQuantity(entitlement.seatCounts.total)
        : STARTUP_MIN_SEATS;
  const currentSelfServePlan =
    currentPlanIdForCards === "pro" ||
    currentPlanIdForCards === "max" ||
    currentPlanIdForCards === "startup"
      ? currentPlanIdForCards
      : null;
  const scheduledCycleChangeForCurrentPlan =
    currentSelfServePlan && scheduledCycleChange?.plan === currentSelfServePlan
      ? scheduledCycleChange
      : null;
  const isPlanActionPending =
    isCheckoutPending ||
    isCycleChangePending ||
    isCancelScheduledCycleChangePending ||
    isSeatQuantityUpdating;
  const hasConsumedMaxTrial = Boolean(
    seatManagement?.accountSubscription?.trialStart &&
    seatManagement?.accountSubscription?.stripeSubscriptionId,
  );
  const maxTrialEligible = hasNoActivePlan && !hasConsumedMaxTrial;
  const hasActiveMaxTrial = Boolean(
    entitlement?.source === "account" &&
    entitlement?.plan === "max" &&
    entitlement?.status === "trialing" &&
    entitlement?.trialActive,
  );

  const invoiceHistoryDescription = workspaceScoped
    ? "Review recent Stripe invoices billed to this workspace."
    : "Review recent Stripe invoices for your personal plan.";
  const emptyInvoiceHistoryLabel = shouldShowInvoiceLoading
    ? "Loading invoices..."
    : workspaceScoped
      ? "No workspace invoices yet"
      : "No personal invoices yet";
  const pendingDowngradeTargetPlanName = pendingDowngradeTargetPlanId
    ? getPlanDisplayName(pendingDowngradeTargetPlanId)
    : null;
  const pendingDowngradeLostBenefits = useMemo(() => {
    if (!pendingDowngradeTargetPlanId) return [];

    const currentFeatures = getPlanIncludedFeatures(currentPlanIdForCards);
    const targetFeatures = getPlanIncludedFeatures(pendingDowngradeTargetPlanId);
    const targetSet = new Set(targetFeatures.map((feature) => feature.trim().toLowerCase()));

    return currentFeatures.filter((feature) => !targetSet.has(feature.trim().toLowerCase()));
  }, [currentPlanIdForCards, pendingDowngradeTargetPlanId]);
  const individualPlanCards = useMemo(() => {
    return INDIVIDUAL_PLAN_CARDS.map((card) => {
      const resolvedPricing = resolvePlanPricing({
        catalog: pricingCatalog,
        plan: card.id,
        cycle: checkoutCycle,
      });
      return {
        ...card,
        ...resolvedPricing,
        trial: resolvedPricing.trial ?? card.trial,
      };
    });
  }, [checkoutCycle, pricingCatalog]);
  const startupPlanCtaLabel = getPlanCtaLabel(
    "startup",
    currentPlanIdForCards,
    STARTUP_PLAN_CARD.name,
    entitlement?.status,
  );
  const selectedStartupSeatQuantity = normalizeSeatQuantity(checkoutSeatQuantity);
  const startupSeatQuantityChanged =
    workspaceScoped &&
    currentPlanIdForCards === "startup" &&
    !currentPlanIsCanceled &&
    selectedStartupSeatQuantity !== currentSeatQuantity;
  const startupCycleSwitchRequested =
    currentSelfServePlan === "startup" && currentSubscriptionCycle !== checkoutCycle;
  const startupCycleSwitchScheduled =
    scheduledCycleChange?.plan === "startup" && scheduledCycleChange.cycle === checkoutCycle;
  const startupExactCurrentSelection =
    currentPlanIdForCards === "startup" &&
    !currentPlanIsCanceled &&
    !startupSeatQuantityChanged &&
    !startupCycleSwitchRequested;
  const startupSeatUnitAmountCents = resolvePlanAmountCents(pricingCatalog, "startup", checkoutCycle);
  const startupSeatCurrency = resolvePlanCurrency(pricingCatalog, "startup", checkoutCycle);
  const startupSelectedTotalPrice = formatDisplayCurrencyFromCents(
    startupSeatUnitAmountCents * selectedStartupSeatQuantity,
    startupSeatCurrency,
  );
  const startupSelectedPeriodLabel = `/ ${selectedStartupSeatQuantity} seat${selectedStartupSeatQuantity === 1 ? "" : "s"} / ${checkoutCycle === "yearly" ? "year" : "month"}`;
  const startupPerSeatPriceLabel = `${formatDisplayCurrencyFromCents(startupSeatUnitAmountCents, startupSeatCurrency)} / seat / ${checkoutCycle === "yearly" ? "year" : "month"}`;
  const startupYearlySavingsCents = Math.max(
    0,
    resolvePlanAmountCents(pricingCatalog, "startup", "monthly") * 12 * selectedStartupSeatQuantity -
      resolvePlanAmountCents(pricingCatalog, "startup", "yearly") * selectedStartupSeatQuantity,
  );
  const startupYearlySavingsLabel =
    checkoutCycle === "yearly" && startupYearlySavingsCents > 0
      ? `Save ${formatDisplayCurrencyFromCents(startupYearlySavingsCents, startupSeatCurrency)}`
      : undefined;
  const startupPrimaryActionLabel =
    startupSeatQuantityChanged
      ? "Update Seats"
      : startupCycleSwitchRequested
        ? startupCycleSwitchScheduled
          ? `${formatBillingCycleLabel(checkoutCycle)} Scheduled`
          : `Switch to ${formatBillingCycleLabel(checkoutCycle)}`
        : startupPlanCtaLabel;
  const enterprisePlanCtaLabel = getPlanCtaLabel(
    "enterprise",
    currentPlanIdForCards,
    ENTERPRISE_PLAN_CARD.name,
    entitlement?.status,
  );
  const seatAssignmentRows = useMemo(() => {
    const workspaceMembers = [...(members ?? [])];

    return workspaceMembers.sort((left, right) => {
      const leftIsBillingOwner = billingOwnerId !== null && billingOwnerId === String(left.userId);
      const rightIsBillingOwner = billingOwnerId !== null && billingOwnerId === String(right.userId);
      if (leftIsBillingOwner !== rightIsBillingOwner) {
        return leftIsBillingOwner ? -1 : 1;
      }

      const leftHasSeat = leftIsBillingOwner || activeAssignmentsByUserId.has(String(left.userId));
      const rightHasSeat = rightIsBillingOwner || activeAssignmentsByUserId.has(String(right.userId));
      if (leftHasSeat !== rightHasSeat) {
        return leftHasSeat ? -1 : 1;
      }

      const leftName = left.user?.firstName
        ? `${left.user.firstName} ${left.user.lastName || ""}`.trim()
        : left.user?.email || "";
      const rightName = right.user?.firstName
        ? `${right.user.firstName} ${right.user.lastName || ""}`.trim()
        : right.user?.email || "";

      return leftName.localeCompare(rightName);
    });
  }, [activeAssignmentsByUserId, billingOwnerId, members]);
  const seatAssignmentsTotalPages = Math.max(
    1,
    Math.ceil(seatAssignmentRows.length / SEAT_ASSIGNMENTS_PAGE_SIZE),
  );
  const seatAssignmentsStartIndex = (seatAssignmentsPage - 1) * SEAT_ASSIGNMENTS_PAGE_SIZE;
  const seatAssignmentsEndIndex = seatAssignmentsStartIndex + SEAT_ASSIGNMENTS_PAGE_SIZE;
  const paginatedSeatAssignmentRows = useMemo(
    () => seatAssignmentRows.slice(seatAssignmentsStartIndex, seatAssignmentsEndIndex),
    [seatAssignmentRows, seatAssignmentsEndIndex, seatAssignmentsStartIndex],
  );
  const seatAssignmentsPageNumbers = useMemo(
    () => getPageNumbers(seatAssignmentsPage, seatAssignmentsTotalPages),
    [seatAssignmentsPage, seatAssignmentsTotalPages],
  );
  const showSeatAssignmentsTable =
    workspaceScoped &&
    entitlement?.source !== "legacy" &&
    seatManagedEntitlement &&
    paidSeatTotal > 0 &&
    entitlement?.status !== "canceled";

  useEffect(() => {
    setSeatAssignmentsPage((current) => Math.min(current, seatAssignmentsTotalPages));
  }, [seatAssignmentsTotalPages]);

  const handleManageBilling = useCallback(async () => {
    if (!billingOrganizationId || !accessToken) return;

    setIsPortalPending(true);
    try {
      const response = await fetchWithAbort(
        `${AUTH_SERVER_URL}/stripe/create-portal`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            organizationId: billingOrganizationId,
            returnUrl: `${window.location.origin}${billingRoute}`,
          }),
        },
        { timeoutMs: 15000 },
      );

      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        throw new Error(error.error || "Failed to open billing portal");
      }

      const { url } = (await response.json()) as { url?: string };
      if (url) {
        await openExternalUrl(url);
      }
    } catch (err) {
      console.error("Billing portal error:", err);
      alert(err instanceof Error ? err.message : "Failed to open billing portal");
    } finally {
      setIsPortalPending(false);
    }
  }, [accessToken, billingOrganizationId, billingRoute]);

  const handleUpdateSeatQuantity = useCallback(async () => {
    if (!billingOrganizationId || !accessToken) return;

    const normalizedSeatQuantity = normalizeSeatQuantity(checkoutSeatQuantity);
    if (normalizedSeatQuantity === currentSeatQuantity) return;

    setIsSeatQuantityUpdating(true);
    try {
      const response = await fetchWithAbort(
        `${AUTH_SERVER_URL}/stripe/update-seat-quantity`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            organizationId: billingOrganizationId,
            seatQuantity: normalizedSeatQuantity,
          }),
        },
        { timeoutMs: 15000 },
      );

      const data = (await response.json().catch(() => null)) as
        | { message?: string; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(data?.message || data?.error || "Failed to update paid seat quantity");
      }

      alert(`Paid seats updated to ${normalizedSeatQuantity}.`);
    } catch (err) {
      console.error("Seat quantity update error:", err);
      alert(err instanceof Error ? err.message : "Failed to update paid seat quantity");
    } finally {
      setIsSeatQuantityUpdating(false);
    }
  }, [accessToken, billingOrganizationId, checkoutSeatQuantity, currentSeatQuantity]);

  const handleCheckout = useCallback(async (requestedPlan: CheckoutPlan) => {
    if (!billingOrganizationId || !accessToken) return;

    const checkoutSeatManaged = requestedPlan === "startup";
    const normalizedSeats = checkoutSeatManaged
      ? normalizeSeatQuantity(checkoutSeatQuantity)
      : 1;
    const payload: {
      organizationId: string;
      type: "subscription";
      plan: CheckoutPlan;
      cycle: BillingCycle;
      seatQuantity?: number;
      successUrl: string;
      cancelUrl: string;
    } = {
      organizationId: billingOrganizationId,
      type: "subscription",
      plan: requestedPlan,
      cycle: checkoutCycle,
      successUrl: "cozea://billing/success?type=subscription",
      cancelUrl: "cozea://billing/canceled",
    };

    if (checkoutSeatManaged) {
      payload.seatQuantity = normalizedSeats;
    }

    setIsCheckoutPending(true);
    try {
      const response = await fetchWithAbort(
        `${AUTH_SERVER_URL}/stripe/create-checkout`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(payload),
        },
        { timeoutMs: 15000 },
      );

      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        throw new Error(error.error || "Failed to start checkout");
      }

      const { url } = (await response.json()) as { url?: string };
      if (url) {
        await openExternalUrl(url);
      }
    } catch (err) {
      console.error("Checkout error:", err);
      alert(err instanceof Error ? err.message : "Failed to start checkout");
    } finally {
      setIsCheckoutPending(false);
    }
  }, [
    accessToken,
    billingOrganizationId,
    checkoutCycle,
    checkoutSeatQuantity,
  ]);

  const handleScheduleCycleChange = useCallback(async (requestedPlan: CheckoutPlan) => {
    if (!billingOrganizationId || !accessToken) return;

    setIsCycleChangePending(true);
    try {
      const response = await fetchWithAbort(
        `${AUTH_SERVER_URL}/stripe/schedule-cycle-change`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            organizationId: billingOrganizationId,
            plan: requestedPlan,
            cycle: checkoutCycle,
          }),
        },
        { timeoutMs: 15000 },
      );

      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as {
          message?: string;
          error?: string;
        } | null;
        if (response.status === 404) {
          throw new Error(
            `The billing server at ${AUTH_SERVER_URL} does not support scheduled cycle changes yet. Restart or deploy that auth gateway, then try again.`,
          );
        }
        throw new Error(error?.message || error?.error || "Failed to schedule billing cycle change");
      }

      const data = (await response.json()) as {
        pendingChange?: ScheduledCycleChange | null;
      };
      const pendingChange = data.pendingChange ?? null;
      setScheduledCycleChange(pendingChange);

      const effectiveAt =
        pendingChange?.effectiveAt ??
        seatManagement?.accountSubscription?.currentPeriodEnd;
      const effectiveDateLabel = formatDate(effectiveAt);
      alert(
        `${getPlanDisplayName(requestedPlan)} will switch to ${formatBillingCycleLabel(checkoutCycle)} billing on ${effectiveDateLabel}.`,
      );
    } catch (err) {
      console.error("Schedule cycle change error:", err);
      alert(err instanceof Error ? err.message : "Failed to schedule billing cycle change");
    } finally {
      setIsCycleChangePending(false);
    }
  }, [
    accessToken,
    billingOrganizationId,
    checkoutCycle,
    seatManagement?.accountSubscription?.currentPeriodEnd,
  ]);

  const handleCancelScheduledCycleChange = useCallback(async () => {
    if (!billingOrganizationId || !accessToken) return;

    setIsCancelScheduledCycleChangePending(true);
    try {
      const response = await fetchWithAbort(
        `${AUTH_SERVER_URL}/stripe/cancel-scheduled-cycle-change`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            organizationId: billingOrganizationId,
          }),
        },
        { timeoutMs: 15000 },
      );

      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as {
          message?: string;
          error?: string;
        } | null;
        throw new Error(error?.message || error?.error || "Failed to cancel scheduled billing cycle change");
      }

      setScheduledCycleChange(null);
      alert("Scheduled billing cycle change canceled. Your current plan will continue on its existing cycle.");
    } catch (err) {
      console.error("Cancel scheduled cycle change error:", err);
      alert(err instanceof Error ? err.message : "Failed to cancel scheduled billing cycle change");
    } finally {
      setIsCancelScheduledCycleChangePending(false);
    }
  }, [accessToken, billingOrganizationId]);

  const handlePlanCardCheckout = useCallback(
    (planId: CheckoutPlan) => {
      void handleCheckout(planId);
    },
    [handleCheckout],
  );

  const executePlanAction = useCallback(
    (targetPlanId: PlanTierId) => {
      if (targetPlanId === "free") {
        void handleManageBilling();
        return;
      }

      if (targetPlanId === "enterprise") {
        void openExternalUrl(ENTERPRISE_SALES_MAILTO);
        return;
      }

      if (
        (targetPlanId === "pro" || targetPlanId === "max" || targetPlanId === "startup") &&
        currentSelfServePlan === targetPlanId &&
        currentSubscriptionCycle !== checkoutCycle
      ) {
        void handleScheduleCycleChange(targetPlanId);
        return;
      }

      handlePlanCardCheckout(targetPlanId);
    },
    [
      checkoutCycle,
      currentSelfServePlan,
      currentSubscriptionCycle,
      handleManageBilling,
      handlePlanCardCheckout,
      handleScheduleCycleChange,
    ],
  );

  const handlePlanCtaClick = useCallback(
    (targetPlanId: PlanTierId) => {
      const isDowngradeFromPaidPlan =
        currentPlanIdForCards !== "free" &&
        PLAN_TIER_RANK[targetPlanId] < PLAN_TIER_RANK[currentPlanIdForCards];

      if (isDowngradeFromPaidPlan) {
        setPendingDowngradeTargetPlanId(targetPlanId);
        return;
      }

      executePlanAction(targetPlanId);
    },
    [currentPlanIdForCards, executePlanAction],
  );

  const handleConfirmDowngrade = useCallback(() => {
    if (!pendingDowngradeTargetPlanId) return;
    const targetPlanId = pendingDowngradeTargetPlanId;
    setPendingDowngradeTargetPlanId(null);
    executePlanAction(targetPlanId);
  }, [executePlanAction, pendingDowngradeTargetPlanId]);

  const handleSeatToggle = useCallback(
    async (assignedUserId: Id<"users">, nextActive: boolean) => {
      if (!convexOrg?._id || !convexUserId) return;

      setSeatMutationError(null);
      setSeatMutationUserId(String(assignedUserId));
      try {
        await setSeatAssignment({
          organizationId: convexOrg._id,
          actorUserId: convexUserId,
          assignedUserId,
          active: nextActive,
        });
      } catch (err) {
        setSeatMutationError(
          err instanceof Error ? err.message : "Failed to update seat assignment",
        );
      } finally {
        setSeatMutationUserId(null);
      }
    },
    [convexOrg?._id, convexUserId, setSeatAssignment],
  );

  const search =
    surface === "drawer"
      ? route?.split("?")[1] ?? ""
      : typeof window !== "undefined"
        ? window.location.search.replace(/^\?/, "")
        : "";

  const urlParams = new URLSearchParams(search);
  const successType = urlParams.get("success");
  const wasCanceled = urlParams.get("canceled");
  const shouldExpandPlansFromUrl = urlParams.get("plans") === "1";

  useEffect(() => {
    if (!shouldExpandPlansFromUrl) return;
    setShowUpgradeOptions(true);
  }, [shouldExpandPlansFromUrl]);

  return {
    accessToken,
    activeAssignmentsByUserId,
    billingOrganizationId,
    billingOwnerId,
    canManageSeats,
    canOpenCheckout,
    checkoutCycle,
    currentPlanHeading,
    currentPlanIdForCards,
    currentPlanIsCanceled,
    currentSeatQuantity,
    currentSelfServePlan,
    currentSubscriptionCycle,
    emptyInvoiceHistoryLabel,
    enterprisePlanCtaLabel,
    entitlement,
    entitlementStatusLabel,
    hasActiveMaxTrial,
    hasBillingOverviewContent,
    hasNoActivePlan,
    hasPastDueEntitlement,
    handleCancelScheduledCycleChange,
    handleConfirmDowngrade,
    handleManageBilling,
    handlePlanCtaClick,
    handleSeatToggle,
    handleUpdateSeatQuantity,
    hasResolvedInvoices,
    individualPlanCards,
    invoiceHistoryDescription,
    invoicesLoading,
    isCancelScheduledCycleChangePending,
    isCheckoutPending,
    isCycleChangePending,
    isPlanActionPending,
    isPortalPending,
    isRefreshingMembers,
    isSeatQuantityUpdating,
    maxTrialEligible,
    members,
    hasResolvedMembers,
    paidSeatAssigned,
    paidSeatAvailable,
    paidSeatProgress,
    paidSeatTotal,
    paginatedSeatAssignmentRows,
    pendingDowngradeLostBenefits,
    pendingDowngradeTargetPlanId,
    pendingDowngradeTargetPlanName,
    pricingCatalog,
    scheduledCycleChange,
    scheduledCycleChangeForCurrentPlan,
    seatAssignmentsEndIndex,
    seatAssignmentsPage,
    seatAssignmentsPageNumbers,
    seatAssignmentsStartIndex,
    seatAssignmentsTotalPages,
    seatAssignmentRows,
    seatManagedEntitlement,
    seatManagement,
    seatMutationError,
    seatMutationUserId,
    selectedStartupSeatQuantity,
    settingsPage,
    setCheckoutCycle,
    setCheckoutSeatQuantity,
    setPendingDowngradeTargetPlanId,
    setSeatAssignmentsPage,
    setShowUpgradeOptions,
    shouldShowInvoiceLoading,
    showPaidSeatSummary,
    showSeatAssignmentsTable,
    showUpgradeOptions,
    startupCycleSwitchRequested,
    startupCycleSwitchScheduled,
    startupExactCurrentSelection,
    startupPerSeatPriceLabel,
    startupPlanCtaLabel,
    startupPrimaryActionLabel,
    startupSeatQuantityChanged,
    startupSelectedPeriodLabel,
    startupSelectedTotalPrice,
    startupYearlySavingsLabel,
    successType,
    visibleStripeInvoices,
    wasCanceled,
    workspaceScoped,
  };
}

export type BillingController = ReturnType<typeof useBillingController>;
