import { useCallback, useEffect, useRef } from "react";
import { ArrowPathIcon as Loader2, ArrowTopRightOnSquareIcon as ExternalLink, CheckCircleIcon as CheckCircle2, CheckIcon as Check, ChevronLeftIcon as ChevronLeft, ChevronRightIcon as ChevronRight, MinusIcon as Minus, PlusIcon as Plus, XCircleIcon as XCircle } from "@heroicons/react/24/outline"

import { featureFlags } from "@/lib/featureFlags";
import { cn } from "@/lib/utils";
import { openExternalUrl } from "@/lib/electron/shellClient";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BillingController } from "./useBillingController";
import {
  BILLING_CYCLE_OPTIONS,
  type BillingCycle,
  ENTERPRISE_PLAN_CARD,
  formatBillingCycleLabel,
  formatDate,
  getPlanBadge,
  getPlanCtaLabel,
  getPlanDisplayName,
  STARTUP_MAX_SEATS,
  STARTUP_MIN_SEATS,
  STARTUP_PLAN_CARD,
} from "./billingShared";

interface BillingContentProps {
  controller: BillingController;
  surface: "page" | "drawer" | "content";
}

interface SlidingSegmentedControlProps<Value extends string> {
  value: Value;
  options: Array<{ value: Value; label: string; ariaLabel?: string; title?: string }>;
  onChange: (value: Value) => void;
  ariaLabel: string;
  className?: string;
  indicatorClassName?: string;
  buttonClassName?: string;
}

function SlidingSegmentedControl<Value extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  indicatorClassName,
  buttonClassName,
}: SlidingSegmentedControlProps<Value>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const updateIndicator = useCallback(() => {
    const selectedIndex = options.findIndex((option) => option.value === value);
    const selectedNode = selectedIndex >= 0 ? itemRefs.current[selectedIndex] : null;
    const indicatorNode = indicatorRef.current;

    if (!selectedNode || !indicatorNode) {
      if (indicatorNode) {
        indicatorNode.style.opacity = "0";
      }
      return;
    }

    indicatorNode.style.width = `${selectedNode.offsetWidth}px`;
    indicatorNode.style.transform = `translateX(${selectedNode.offsetLeft}px)`;
    indicatorNode.style.opacity = "1";
  }, [options, value]);

  useEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(() => {
      updateIndicator();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    itemRefs.current.forEach((node) => {
      if (node) {
        resizeObserver.observe(node);
      }
    });

    return () => {
      resizeObserver.disconnect();
    };
  }, [options.length, updateIndicator]);

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "relative inline-grid grid-flow-col auto-cols-fr items-center gap-1 overflow-hidden rounded-full border border-border/60 bg-muted/70 p-1",
        className,
      )}
    >
      <div
        ref={indicatorRef}
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1 bottom-1 left-0 rounded-full border border-border/70 bg-background opacity-0 shadow-sm transition-[transform,width,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          indicatorClassName,
        )}
      />
      {options.map((option, index) => {
        const selected = option.value === value;

        return (
          <button
            key={option.value}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            className={cn(
              "relative z-10 flex items-center justify-center whitespace-nowrap rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors duration-200 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-0",
              selected && "text-foreground",
              buttonClassName,
            )}
            onClick={() => onChange(option.value)}
            aria-label={option.ariaLabel}
            aria-pressed={selected}
            title={option.title ?? option.label}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function BillingContent({ controller, surface }: BillingContentProps) {
  const renderCycleToggle = () => (
    <SlidingSegmentedControl
      value={controller.checkoutCycle}
      options={BILLING_CYCLE_OPTIONS}
      onChange={controller.setCheckoutCycle as (value: BillingCycle) => void}
      ariaLabel="Billing cycle"
      className="border-border/60 bg-background/70 p-0.5"
      indicatorClassName="top-0.5 bottom-0.5 border-border/60"
      buttonClassName="h-6 min-w-8 px-2.5 text-[11px] leading-none"
    />
  );

  return (
    <>
      {controller.successType && (
        <Alert className="mb-6 border-green-500/50 bg-green-500/10">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <AlertTitle className="text-green-500">Subscription Updated</AlertTitle>
          <AlertDescription>Billing details were updated successfully.</AlertDescription>
        </Alert>
      )}

      {controller.wasCanceled && (
        <Alert className="mb-6 border-amber-500/50 bg-amber-500/10">
          <XCircle className="h-4 w-4 text-amber-500" />
          <AlertTitle className="text-amber-500">Checkout Canceled</AlertTitle>
          <AlertDescription>Your checkout was canceled. No charges were made.</AlertDescription>
        </Alert>
      )}

      {controller.entitlement && controller.entitlement.source === "legacy" && (
        <Alert className="mb-6">
          <AlertTitle>Legacy workspace billing compatibility mode</AlertTitle>
          <AlertDescription>
            Legacy workspace subscriptions still work. Move to account subscriptions for canonical Pro,
            Max, and Startup billing.
          </AlertDescription>
        </Alert>
      )}

      {controller.seatMutationError && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>Seat assignment failed</AlertTitle>
          <AlertDescription>{controller.seatMutationError}</AlertDescription>
        </Alert>
      )}

      {controller.hasPastDueEntitlement && (
        <Alert variant="destructive" className="mb-6">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Payment failed</AlertTitle>
          <AlertDescription>
            Your latest Stripe payment was declined. Update your payment method in Manage Billing to
            restore hosted AI access and included usage.
          </AlertDescription>
        </Alert>
      )}

      {controller.scheduledCycleChangeForCurrentPlan && (
        <Alert className="mb-6 border-sky-500/50 bg-sky-500/10">
          <AlertTitle className="text-sky-600 dark:text-sky-400">Billing cycle change scheduled</AlertTitle>
          <AlertDescription>
            {`${getPlanDisplayName(controller.scheduledCycleChangeForCurrentPlan.plan)} stays on ${formatBillingCycleLabel(controller.currentSubscriptionCycle).toLowerCase()} billing until ${formatDate(controller.scheduledCycleChangeForCurrentPlan.effectiveAt)}, then switches to ${formatBillingCycleLabel(controller.scheduledCycleChangeForCurrentPlan.cycle).toLowerCase()}.`}
          </AlertDescription>
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void controller.handleCancelScheduledCycleChange()}
              disabled={
                controller.isCancelScheduledCycleChangePending ||
                controller.isPortalPending ||
                controller.isCycleChangePending ||
                controller.isCheckoutPending
              }
            >
              {controller.isCancelScheduledCycleChangePending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Cancel scheduled change
            </Button>
          </div>
        </Alert>
      )}

      <div
        className={[
          featureFlags.contentVisibility ? "perf-contain-auto" : "",
          surface === "drawer" ? "space-y-6 px-6 py-6" : "space-y-6",
        ].join(" ").trim()}
      >
        <Card className="border-none shadow-none bg-transparent">
          <CardHeader className={controller.hasBillingOverviewContent ? "pt-0 px-0" : "pt-0 px-0 pb-2"}>
            <div className="min-w-0 flex items-center gap-2">
              <CardTitle className="truncate text-3xl font-semibold tracking-tight">
                {controller.currentPlanHeading}
              </CardTitle>
              <Badge variant="secondary">{controller.entitlementStatusLabel}</Badge>
            </div>
            <CardDescription>
              {controller.workspaceScoped
                ? controller.hasNoActivePlan
                  ? "No paid workspace plan is active. Start Startup or contact sales for Enterprise here."
                  : "Workspace billing is centralized and seat-based. Manage Startup or Enterprise access, seat assignment, and included AI usage here."
                : controller.hasNoActivePlan
                  ? "No paid plan is active. Start Pro or Max here."
                  : "Billing is personal and account-scoped. Manage your plan, included AI usage, and invoices here."}
            </CardDescription>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={controller.handleManageBilling}
                disabled={!controller.canOpenCheckout || controller.isPortalPending}
              >
                {controller.isPortalPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Manage Billing
              </Button>
              <Button
                variant="outline"
                onClick={() => controller.setShowUpgradeOptions((current) => !current)}
              >
                {controller.showUpgradeOptions
                  ? "Hide Plans"
                  : controller.hasNoActivePlan
                    ? "View Plans"
                    : "Change Plan"}
              </Button>
            </div>
          </CardHeader>

          {controller.hasBillingOverviewContent ? (
            <CardContent className="space-y-5 px-0">
              {!controller.workspaceScoped &&
                (controller.currentPlanIdForCards === "startup" || controller.currentPlanIdForCards === "enterprise") && (
                  <Alert className="bg-primary/5 border-primary/20">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <AlertTitle>Covered by Workspace Plan</AlertTitle>
                    <AlertDescription>
                      Your personal workspace is automatically upgraded because you manage an active{" "}
                      <strong>{controller.currentPlanIdForCards === "enterprise" ? "Enterprise" : "Startup"}</strong>{" "}
                      subscription. You have full access to all Pro features here at no additional cost.
                    </AlertDescription>
                  </Alert>
                )}

              {controller.showPaidSeatSummary && (
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2 rounded-2xl bg-secondary/80 p-4 dark:bg-secondary/40">
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>Paid seats</span>
                      <span>{`${controller.paidSeatAssigned} / ${controller.paidSeatTotal || "-"}`}</span>
                    </div>
                    {controller.seatManagedEntitlement && controller.paidSeatTotal > 0 ? (
                      <Progress value={controller.paidSeatProgress} className="h-2" />
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        {controller.seatManagedEntitlement
                          ? "No paid seat pool active"
                          : "Pro and Max do not use seat assignments"}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {controller.seatManagedEntitlement
                        ? controller.paidSeatTotal > 0
                          ? `${controller.paidSeatAvailable} seats available`
                          : "Assign seats after starting Startup"
                        : "Seat assignment is only used for Startup and Enterprise"}
                    </div>
                  </div>
                </div>
              )}

              {controller.seatManagedEntitlement && controller.seatManagement?.billingUser ? (
                <div className="flex w-fit items-center gap-3 rounded-xl border border-border/60 bg-background/70 p-3">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={controller.seatManagement.billingUser.profileImageUrl || undefined} />
                    <AvatarFallback>
                      {(controller.seatManagement.billingUser.email || "?").slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-xs text-muted-foreground">Billing owner</p>
                    <p className="text-sm font-medium">{controller.seatManagement.billingUser.email}</p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          ) : null}
        </Card>

        {controller.showUpgradeOptions && (
          <Card className="-mt-4 border-none bg-transparent shadow-none">
            <CardContent className="px-0 pt-0">
              {!controller.workspaceScoped ? (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  {controller.individualPlanCards.map((planCard, index) => {
                    const isCurrentPlan = controller.currentPlanIdForCards === planCard.id;
                    const isReactivatableCurrentPlan = isCurrentPlan && controller.currentPlanIsCanceled;
                    const isSamePlanCycleSwitch =
                      controller.currentSelfServePlan === planCard.id &&
                      controller.currentSubscriptionCycle !== controller.checkoutCycle;
                    const isCycleSwitchScheduled =
                      controller.scheduledCycleChange?.plan === planCard.id &&
                      controller.scheduledCycleChange.cycle === controller.checkoutCycle;
                    const isExactCurrentSelection =
                      isCurrentPlan && !isSamePlanCycleSwitch && !isReactivatableCurrentPlan;
                    const badge = getPlanBadge(planCard.id, controller.currentPlanIdForCards);
                    const planCardCtaLabel =
                      isSamePlanCycleSwitch
                        ? isCycleSwitchScheduled
                          ? `${formatBillingCycleLabel(controller.checkoutCycle)} Scheduled`
                          : `Switch to ${formatBillingCycleLabel(controller.checkoutCycle)}`
                        : getPlanCtaLabel(
                            planCard.id,
                            controller.currentPlanIdForCards,
                            planCard.name,
                            controller.entitlement?.status,
                          );
                    const showTrialText = Boolean(planCard.trial) && planCard.id === "max" && controller.maxTrialEligible;
                    const planCardFooterText =
                      planCard.id === "max" && !(controller.maxTrialEligible || controller.hasActiveMaxTrial)
                        ? ""
                        : planCard.footerText;

                    return (
                      <div
                        key={planCard.id}
                        className={`relative flex h-full flex-col rounded-2xl border border-transparent bg-secondary/80 p-5 transition-all duration-300 dark:bg-secondary/40 ${
                          isCurrentPlan ? "border-primary/30" : ""
                        }`}
                        style={{ transitionDelay: `${index * 50}ms` }}
                      >
                        {badge ? (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                            {badge}
                          </div>
                        ) : null}

                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="text-lg font-semibold text-foreground">{planCard.name}</h3>
                          </div>
                          {renderCycleToggle()}
                        </div>
                        {planCard.description ? (
                          <p className="mt-2 text-sm text-muted-foreground">{planCard.description}</p>
                        ) : null}
                        <div className="mt-4 flex items-baseline gap-1">
                          <span className="text-3xl font-bold text-foreground">{planCard.price}</span>
                          {planCard.period ? <span className="text-muted-foreground">{planCard.period}</span> : null}
                        </div>
                        {planCard.yearlySavingsLabel ? (
                          <p className="mt-1 text-xs text-muted-foreground">{planCard.yearlySavingsLabel}</p>
                        ) : null}
                        {showTrialText ? (
                          <p className="mt-1 text-sm text-green-600 dark:text-green-400">{planCard.trial}</p>
                        ) : null}

                        {planCard.featuresHeading ? (
                          <p className="mt-4 text-sm font-medium text-foreground">{planCard.featuresHeading}</p>
                        ) : null}
                        <ul className="mt-5 flex-1 space-y-2.5">
                          {planCard.features.map((feature, featureIndex) => (
                            <li key={`${planCard.id}-${featureIndex}`} className="flex items-center gap-2 text-sm text-muted-foreground">
                              {feature.included ? (
                                <Check className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                              ) : (
                                <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                              )}
                              <span>{feature.text}</span>
                            </li>
                          ))}
                        </ul>

                        {planCard.conclusion ? (
                          <p className="mt-4 text-sm text-muted-foreground">{planCard.conclusion}</p>
                        ) : null}

                        {planCardFooterText ? (
                          <p className="mt-5 text-center text-xs text-muted-foreground">{planCardFooterText}</p>
                        ) : null}

                        <Button
                          className="mt-5 w-full rounded-full"
                          variant={isExactCurrentSelection || isCycleSwitchScheduled ? "secondary" : "default"}
                          onClick={() => controller.handlePlanCtaClick(planCard.id)}
                          disabled={
                            !controller.canOpenCheckout ||
                            isExactCurrentSelection ||
                            controller.isPlanActionPending ||
                            controller.isPortalPending ||
                            isCycleSwitchScheduled
                          }
                        >
                          {controller.isPlanActionPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          {planCardCtaLabel}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="relative flex h-full flex-col rounded-2xl bg-secondary/80 p-5 transition-all duration-300 dark:bg-secondary/40">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-lg font-semibold text-foreground">{STARTUP_PLAN_CARD.name}</h3>
                      </div>
                      {renderCycleToggle()}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{STARTUP_PLAN_CARD.description}</p>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-foreground">{controller.startupSelectedTotalPrice}</span>
                      <span className="text-muted-foreground">{controller.startupSelectedPeriodLabel}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{controller.startupPerSeatPriceLabel}</p>
                    {controller.startupYearlySavingsLabel ? (
                      <p className="mt-1 text-xs text-muted-foreground">{controller.startupYearlySavingsLabel}</p>
                    ) : null}
                    <div className="mt-4 rounded-2xl border border-border/60 bg-background/70 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-foreground">Paid seats</p>
                          <p className="text-xs text-muted-foreground">
                            {controller.currentPlanIdForCards === "startup" && !controller.currentPlanIsCanceled
                              ? `${controller.currentSeatQuantity} seats currently purchased`
                              : `Choose ${STARTUP_MIN_SEATS}-${STARTUP_MAX_SEATS} paid seats`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="icon-sm"
                            className="rounded-full"
                            onClick={() =>
                              controller.setCheckoutSeatQuantity((current) => current - 1)
                            }
                            disabled={controller.selectedStartupSeatQuantity <= STARTUP_MIN_SEATS || controller.isPlanActionPending}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                          <Input
                            type="number"
                            min={STARTUP_MIN_SEATS}
                            max={STARTUP_MAX_SEATS}
                            value={controller.selectedStartupSeatQuantity}
                            onChange={(event) => {
                              const parsedValue = Number.parseInt(event.target.value, 10);
                              if (!Number.isFinite(parsedValue)) {
                                controller.setCheckoutSeatQuantity(STARTUP_MIN_SEATS);
                                return;
                              }
                              controller.setCheckoutSeatQuantity(parsedValue);
                            }}
                            className="h-9 w-20 rounded-full bg-background text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="icon-sm"
                            className="rounded-full"
                            onClick={() =>
                              controller.setCheckoutSeatQuantity((current) => current + 1)
                            }
                            disabled={controller.selectedStartupSeatQuantity >= STARTUP_MAX_SEATS || controller.isPlanActionPending}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                    <ul className="mt-5 flex-1 space-y-2.5">
                      {STARTUP_PLAN_CARD.features.map((feature, featureIndex) => (
                        <li key={`startup-${featureIndex}`} className="flex items-center gap-2 text-sm text-muted-foreground">
                          {feature.included ? (
                            <Check className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                          ) : (
                            <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                          )}
                          <span>{feature.text}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      className="mt-5 w-full rounded-full"
                      variant={controller.startupExactCurrentSelection || controller.startupCycleSwitchScheduled ? "secondary" : "default"}
                      onClick={() => {
                        if (controller.startupSeatQuantityChanged) {
                          void controller.handleUpdateSeatQuantity();
                          return;
                        }
                        controller.handlePlanCtaClick("startup");
                      }}
                      disabled={
                        !controller.canOpenCheckout ||
                        controller.isPlanActionPending ||
                        controller.isPortalPending ||
                        controller.startupExactCurrentSelection ||
                        controller.startupCycleSwitchScheduled
                      }
                    >
                      {controller.isPlanActionPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      {controller.startupPrimaryActionLabel}
                    </Button>
                  </div>

                  <div className="relative flex h-full flex-col rounded-2xl bg-secondary/80 p-5 transition-all duration-300 dark:bg-secondary/40">
                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold text-foreground">{ENTERPRISE_PLAN_CARD.name}</h3>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{ENTERPRISE_PLAN_CARD.description}</p>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-foreground">{ENTERPRISE_PLAN_CARD.priceLabel}</span>
                    </div>
                    <p className="mt-4 text-sm font-medium text-foreground">{ENTERPRISE_PLAN_CARD.featuresHeading}</p>
                    <ul className="mt-5 flex-1 space-y-2.5">
                      {ENTERPRISE_PLAN_CARD.features.map((feature, featureIndex) => (
                        <li key={`enterprise-${featureIndex}`} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Check className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      className="mt-5 w-full rounded-full"
                      onClick={() => controller.handlePlanCtaClick("enterprise")}
                      disabled={controller.isPlanActionPending}
                    >
                      {controller.enterprisePlanCtaLabel}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Dialog
          open={controller.pendingDowngradeTargetPlanId !== null}
          onOpenChange={(open) => {
            if (!open) {
              controller.setPendingDowngradeTargetPlanId(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Downgrade plan</DialogTitle>
              <DialogDescription>
                {controller.pendingDowngradeTargetPlanName
                  ? `You are about to switch to ${controller.pendingDowngradeTargetPlanName}.`
                  : "You are about to downgrade your plan."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {controller.pendingDowngradeLostBenefits.length > 0 ? (
                controller.pendingDowngradeLostBenefits.map((benefit) => (
                  <div key={benefit} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <span>{benefit}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No specific feature differences were detected.</p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => controller.setPendingDowngradeTargetPlanId(null)}
                disabled={controller.isPlanActionPending || controller.isPortalPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={controller.handleConfirmDowngrade}
                disabled={controller.isPlanActionPending || controller.isPortalPending}
              >
                {controller.isPlanActionPending || controller.isPortalPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Lose all my benefits
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {controller.showSeatAssignmentsTable && (
          <Card className="border-none shadow-none bg-transparent">
            <CardHeader className="pt-0 px-0 pb-4">
              <CardTitle>Seat Assignments</CardTitle>
              <CardDescription>
                Purchased seats cap workspace access. Select which workspace members receive a paid seat.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40">
                <Table className="[&_th]:px-4 [&_td]:px-4">
                  <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                    <TableRow>
                      <TableHead className="w-[42%]">Member</TableHead>
                      <TableHead className="w-[18%]">Role</TableHead>
                      <TableHead className="w-[40%] text-right">Paid Seat</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                    {controller.members === undefined ? (
                      <TableRow>
                        <TableCell colSpan={3} className="h-16 text-center text-muted-foreground">
                          Loading workspace members...
                        </TableCell>
                      </TableRow>
                    ) : controller.paginatedSeatAssignmentRows.length > 0 ? (
                      controller.paginatedSeatAssignmentRows.map((member) => {
                        const isBillingOwner =
                          controller.billingOwnerId !== null &&
                          controller.billingOwnerId === String(member.userId);
                        const hasSeat =
                          isBillingOwner || controller.activeAssignmentsByUserId.has(String(member.userId));
                        const isBusy = controller.seatMutationUserId === String(member.userId);
                        const canToggle = controller.canManageSeats && !isBillingOwner;
                        const hasAvailableSeat = hasSeat || controller.paidSeatAvailable > 0;
                        const displayName =
                          member.user?.firstName
                            ? `${member.user.firstName} ${member.user.lastName || ""}`.trim()
                            : member.user?.email || "Unknown";

                        return (
                          <TableRow key={member._id}>
                            <TableCell className="overflow-hidden">
                              <div className="flex min-w-0 items-center gap-3">
                                <Avatar className="h-8 w-8">
                                  <AvatarImage src={member.user?.profileImageUrl || undefined} />
                                  <AvatarFallback>
                                    {(displayName || "?").slice(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium">{displayName}</p>
                                  <p className="truncate text-xs text-muted-foreground">{member.user?.email || "-"}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="overflow-hidden">
                              <Badge className="max-w-full shrink justify-start border-0 bg-primary/10 text-primary">
                                <span className="truncate">
                                  {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                                </span>
                              </Badge>
                            </TableCell>
                            <TableCell className="overflow-hidden text-right">
                              <div className="flex min-w-0 items-center justify-end gap-3 overflow-hidden">
                                <span className="truncate text-xs text-muted-foreground">
                                  {isBillingOwner ? "Always included" : hasSeat ? "Assigned" : "Not assigned"}
                                </span>
                                {isBusy ? (
                                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                                ) : (
                                  <Checkbox
                                    checked={hasSeat}
                                    disabled={!canToggle || !hasAvailableSeat}
                                    className="shrink-0"
                                    onCheckedChange={(checked) => {
                                      const nextActive = checked === true;
                                      if (nextActive === hasSeat) return;
                                      void controller.handleSeatToggle(member.userId, nextActive);
                                    }}
                                  />
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={3} className="h-16 text-center text-muted-foreground">
                          No workspace members found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {controller.seatAssignmentRows.length > 0 ? (
                <div className="mt-4 flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Showing{" "}
                    <span className="font-medium">
                      {controller.seatAssignmentsStartIndex + 1}-
                      {Math.min(controller.seatAssignmentsEndIndex, controller.seatAssignmentRows.length)}
                    </span>{" "}
                    of <span className="font-medium">{controller.seatAssignmentRows.length}</span> members
                  </div>
                  {controller.seatAssignmentsTotalPages > 1 ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="secondary"
                        size="icon"
                        className="h-8 w-8 rounded-full"
                        onClick={() => controller.setSeatAssignmentsPage((current) => Math.max(1, current - 1))}
                        disabled={controller.seatAssignmentsPage === 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      {controller.seatAssignmentsPageNumbers.map((pageNumber, index) => (
                        typeof pageNumber === "number" ? (
                          <Button
                            key={`${pageNumber}-${index}`}
                            variant={controller.seatAssignmentsPage === pageNumber ? "default" : "secondary"}
                            size="icon"
                            className="h-8 w-8 rounded-full"
                            onClick={() => controller.setSeatAssignmentsPage(pageNumber)}
                          >
                            {pageNumber}
                          </Button>
                        ) : (
                          <span key={`ellipsis-${index}`} className="px-2 text-muted-foreground">
                            ...
                          </span>
                        )
                      ))}
                      <Button
                        variant="secondary"
                        size="icon"
                        className="h-8 w-8 rounded-full"
                        onClick={() =>
                          controller.setSeatAssignmentsPage((current) =>
                            Math.min(controller.seatAssignmentsTotalPages, current + 1),
                          )
                        }
                        disabled={controller.seatAssignmentsPage === controller.seatAssignmentsTotalPages}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}

        <Card className="border-none shadow-none bg-transparent">
          <CardHeader className="pt-0 px-0 pb-4">
            <CardTitle className="flex items-center gap-2">
              <span>Invoice History</span>
              {controller.invoicesLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : null}
            </CardTitle>
            <CardDescription>{controller.invoiceHistoryDescription}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 px-0">
            <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40">
              <Table className="[&_th]:px-4 [&_td]:px-4">
                <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Invoice</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                  {controller.visibleStripeInvoices.length > 0 ? (
                    controller.visibleStripeInvoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell>{formatDate(invoice.date)}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{invoice.description}</TableCell>
                        <TableCell>${(invoice.amountPaid / 100).toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge
                            variant={invoice.status === "paid" ? "secondary" : "outline"}
                            className="capitalize"
                          >
                            {invoice.status || "unknown"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {invoice.hostedInvoiceUrl ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1"
                              onClick={() => {
                                void openExternalUrl(invoice.hostedInvoiceUrl!);
                              }}
                            >
                              View
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="h-16 text-center text-muted-foreground">
                        {controller.emptyInvoiceHistoryLabel}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
