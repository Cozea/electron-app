/**
 * First-run product tour.
 *
 * Runs once, immediately after device onboarding completes, and never again
 * once it is finished or skipped. Progress is saved on every step so quitting
 * halfway resumes in place rather than replaying from the beginning.
 *
 * Most steps cannot be clicked past. There is no Next button on them: the user
 * advances by clicking the highlighted control, or by actually creating a
 * project or an organization. A pointing arrow marks the control to press.
 * Skipping is always available, and is the only way out.
 *
 * Mounted once, near the root, so it survives the route changes it drives.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { driver, type Driver, type PopoverDOM } from "driver.js";
import { useQuery } from "convex/react";

import "driver.js/dist/driver.css";
import "./productTour.css";

import { api } from "../../../../../convex/_generated/api";
import { useAuth } from "@/contexts/AuthContext";
import { buildProjectPath } from "@/contexts/project/projectRoutes";
import { useCreateProjectDialogStore } from "@/lib/createProjectDialogStore";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { useTranslation } from "@/lib/i18n";

import {
  isActionStep,
  isSectionIntro,
  resolveProductTourSteps,
  resolveSectionProgress,
  type ProductTourStep,
} from "./productTourSteps";
import { useProductTourStore } from "./productTourStore";
import {
  isProductTourFinished,
  readProductTourProgress,
  writeProductTourProgress,
  type ProductTourStatus,
} from "./productTourStorage";

/** How long driver.js waits for a step's anchor after a route change. */
const ANCHOR_WAIT_MS = 4000;
/** Room reserved between an anchor and its popover, so the arrow fits. */
const POPOVER_OFFSET = 48;
/** Marks an anchor the user may look at but not use. See productTour.css. */
const FROZEN_CLASS = "cozea-tour-frozen";

/**
 * Takes the freeze off everything, rather than off whatever element a ref
 * happens to still point at. A stale or lost reference must never be able to
 * leave part of the interface unclickable.
 */
function unfreezeAll(): void {
  for (const element of document.querySelectorAll(`.${FROZEN_CLASS}`)) {
    element.classList.remove(FROZEN_CLASS);
  }
}

/** Matches `.cozea-tour-blade` in productTour.css. */
const BLADE_SIZE = 16;
/** Clearance between the control and the ring around it. */
const RING_GAP = 6;
const RING_PAD = BLADE_SIZE + RING_GAP;

const CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true">' +
  // Two chevrons, the trailing one faint, so the blade reads as travel toward
  // the control rather than as a static marker.
  '<path d="M12 5 L5 12 L12 19" stroke-width="2.25" />' +
  '<path d="M19 5 L12 12 L19 19" stroke-width="2" opacity="0.4" />' +
  "</svg>";

/**
 * The corners are brackets, not chevrons. A chevron is a right angle, so at 45
 * degrees its arms go flat and it reads as a bracket anyway. Drawing it as one
 * on purpose gives a clean frame instead of a muddy arrow.
 */
const BRACKET_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M5 13 L5 5 L13 5" stroke-width="2.25" />' +
  "</svg>";

/** Eight blades, placed and angled entirely by CSS from these positions. */
const RING_MARKUP = (
  [
    ["n", "side"],
    ["ne", "corner"],
    ["e", "side"],
    ["se", "corner"],
    ["s", "side"],
    ["sw", "corner"],
    ["w", "side"],
    ["nw", "corner"],
  ] as const
)
  .map(
    ([at, kind]) =>
      `<span class="cozea-tour-blade" data-at="${at}" data-kind="${kind}">` +
      `${kind === "side" ? CHEVRON_SVG : BRACKET_SVG}</span>`,
  )
  .join("");

/** Wraps the ring's box around the control it points at. */
function placeRing(ring: HTMLElement, rect: DOMRect): void {
  ring.style.left = `${Math.round(rect.left - RING_PAD)}px`;
  ring.style.top = `${Math.round(rect.top - RING_PAD)}px`;
  ring.style.width = `${Math.round(rect.width + RING_PAD * 2)}px`;
  ring.style.height = `${Math.round(rect.height + RING_PAD * 2)}px`;
}

export function ProductTour() {
  const { principalId, isAuthenticated, isLoading, needsOnboarding } = useAuth();
  const { t } = useTranslation();
  const navigate = useViewTransitionNavigate();

  const projects = useQuery(
    api.projects.listSummariesForCurrentUser,
    principalId ? { principalId } : "skip",
  );
  const organizations = useQuery(api.organizations.listMine, principalId ? {} : "skip");
  const isCreateDialogOpen = useCreateProjectDialogStore((state) => state.isOpen);
  const setTourActive = useProductTourStore((state) => state.setActive);

  // `undefined` means the query has not resolved. Starting the tour before it
  // resolves would decide the memory step against an unknown project list.
  const projectsResolved = projects !== undefined;
  const firstProjectId = projects?.[0]?._id ?? null;
  const hasProject = Boolean(firstProjectId);
  const projectCount = projects?.length ?? 0;
  const organizationCount = organizations?.length ?? 0;

  const driverRef = useRef<Driver | null>(null);
  const startedRef = useRef(false);
  /** True only while a tour is on screen, so the ring loop can stop. */
  const [isRunning, setIsRunning] = useState(false);
  /** Steps the running tour was built from. Fixed for the life of one run. */
  const activeStepsRef = useRef<ProductTourStep[]>([]);
  /** The pointing ring, and the element it currently surrounds. */
  const arrowRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<Element | null>(null);
  /** Removes the click listener that completes a `click` step. */
  const detachClickRef = useRef<(() => void) | null>(null);
  /** The element currently frozen, so the class is always taken back off. */
  const frozenRef = useRef<Element | null>(null);
  /** Last measured anchor box, to notice when the page has moved under us. */
  const anchorBoxRef = useRef("");
  /**
   * Whether an `element` step's condition was already true when it opened.
   *
   * Such a step has nothing left to do, so it must not advance the instant it
   * appears. It offers a way on instead. A user who had already activated their
   * default build still gets to read what a build is.
   */
  const alreadySatisfiedRef = useRef(false);
  /**
   * The step we are on. Owned here rather than read back from driver.js, whose
   * own index is not yet updated inside its highlight callback. Reading it
   * there returned the previous step, so a gated step never recorded its
   * baseline and could never complete.
   */
  const activeIndexRef = useRef(0);
  /**
   * Counts captured when a creation-gated step opened. The step completes when
   * the count rises above this, which is what makes it a real creation rather
   * than credit for something that already existed. One baseline per gate: a
   * shared one let the project step's value block the organization step.
   */
  const projectBaselineRef = useRef(0);
  const organizationBaselineRef = useRef(0);
  const projectCountRef = useRef(0);
  const organizationCountRef = useRef(0);
  projectCountRef.current = projectCount;
  organizationCountRef.current = organizationCount;

  const steps = useMemo(() => resolveProductTourSteps({ hasProject }), [hasProject]);

  /**
   * Records that a step is starting: its index, its saved progress, and the
   * baseline for whatever it is waiting to be created.
   */
  const beginStep = useCallback((index: number) => {
    activeIndexRef.current = index;
    const step = activeStepsRef.current[index];
    if (!step) return;

    writeProductTourProgress({ status: "pending", stepIndex: index });
    alreadySatisfiedRef.current = Boolean(
      step.advance === "element" && step.awaitSelector && document.querySelector(step.awaitSelector),
    );
    if (step.advance === "project") projectBaselineRef.current = projectCountRef.current;
    if (step.advance === "organization") {
      organizationBaselineRef.current = organizationCountRef.current;
    }
  }, []);

  /** Drops the ring and any pending click listener between steps. */
  const clearStepBindings = useCallback(() => {
    detachClickRef.current?.();
    detachClickRef.current = null;
    unfreezeAll();
    frozenRef.current = null;
    anchorRef.current = null;
    anchorBoxRef.current = "";
    if (arrowRef.current) arrowRef.current.style.display = "none";
  }, []);

  /** Ends the tour and records why, so it is never offered again. */
  const finish = useCallback(
    (status: Exclude<ProductTourStatus, "pending">) => {
      writeProductTourProgress({ status, stepIndex: 0 });
      setIsRunning(false);
      clearStepBindings();
      const instance = driverRef.current;
      driverRef.current = null;
      instance?.destroy();
    },
    [clearStepBindings],
  );

  /**
   * Prepares the surface a step needs before driver.js looks for its anchor.
   * The memory step is the one route that cannot be written down in advance,
   * because it lives inside whichever project the user just created.
   */
  const prepareStep = useCallback(
    (index: number) => {
      const step = activeStepsRef.current[index];
      if (!step) return;

      const route =
        step.routeToProject && firstProjectId
          ? buildProjectPath(firstProjectId, "workbench")
          : step.route;

      if (route) navigate(route);
    },
    [firstProjectId, navigate],
  );

  /** Moves forward, or finishes when the last step is the one just completed. */
  const advance = useCallback(
    (from: number) => {
      const instance = driverRef.current;
      if (!instance) return;

      // A stale closure must not advance a step the tour has already left.
      if (from !== activeIndexRef.current) return;

      clearStepBindings();

      // The final step is an action step, so it has no Done button to press.
      if (from >= activeStepsRef.current.length - 1) {
        finish("completed");
        return;
      }

      beginStep(from + 1);
      prepareStep(from + 1);
      instance.moveNext();
    },
    [beginStep, clearStepBindings, finish, prepareStep],
  );

  // Start the tour once, as soon as onboarding is behind us.
  useEffect(() => {
    if (startedRef.current) return;
    if (!isAuthenticated || isLoading || needsOnboarding) return;
    if (!projectsResolved) return;
    if (steps.length === 0) return;

    const progress = readProductTourProgress();
    if (isProductTourFinished(progress)) return;

    startedRef.current = true;
    activeStepsRef.current = steps;

    const ring = document.createElement("div");
    ring.className = "cozea-tour-ring";
    ring.style.display = "none";
    ring.innerHTML = RING_MARKUP;
    document.body.appendChild(ring);
    arrowRef.current = ring;

    // Numbered within each section, so the counter reads against the part of
    // the tour the user is actually in.
    const sectionProgress = resolveSectionProgress(steps);

    const instance = driver({
      animate: true,
      // Off globally, on per step. driver.js resolves this as
      // `step.showProgress || config.showProgress`, so a global `true` makes a
      // per-step `false` impossible and every section opening would carry a
      // counter it has no business showing.
      showProgress: false,
      // Leaving must be a deliberate choice, so the backdrop cannot end the
      // tour and the keyboard cannot step past a gate that has not been met.
      allowClose: false,
      allowKeyboardControl: false,
      // The whole point is that the user presses the real control.
      disableActiveInteraction: false,
      smoothScroll: true,
      // A surface that failed to mount should cost its own step, not the tour.
      skipMissingElement: true,
      waitForElement: ANCHOR_WAIT_MS,
      popoverOffset: POPOVER_OFFSET,
      popoverClass: "cozea-tour-popover",
      progressText: t("tour.progress"),
      nextBtnText: t("tour.next"),
      doneBtnText: t("tour.done"),
      steps: steps.map((step) => {
        const position = sectionProgress.get(step.id);
        return {
        element: step.element,
        popover: {
          title: t(step.titleKey),
          description: t(step.descriptionKey),
          side: step.side,
          align: step.align,
          // A section opening is the door into a section, not a step of it.
          showProgress: !isSectionIntro(step),
          progressText: position ? `${position.position} of ${position.total}` : undefined,
          // Only an explanation offers a Next. Every other step is finished by
          // doing the thing: pressing the control, or creating what it asks for.
          showButtons: isActionStep(step) ? [] : ["next"],
        },
        };
      }),
      onPopoverRender: (popover: PopoverDOM) => {
        // Nothing left to wait for, so give the user a way forward rather than
        // a step that can never complete.
        if (alreadySatisfiedRef.current) {
          const next = document.createElement("button");
          next.type = "button";
          next.className = "driver-popover-footer-btn driver-popover-next-btn";
          next.textContent = t("tour.next");
          next.addEventListener("click", () => advance(activeIndexRef.current));
          popover.footerButtons.appendChild(next);
        }

        const skip = document.createElement("button");
        skip.type = "button";
        skip.className = "cozea-tour-skip";
        skip.textContent = t("tour.skip");
        skip.addEventListener("click", () => finish("skipped"));
        popover.wrapper.appendChild(skip);
      },
      onHighlighted: (element) => {
        // Binding only. Which step this is, and what it is waiting for, were
        // both settled in beginStep before driver.js was asked to move.
        const active = activeIndexRef.current;
        const step = activeStepsRef.current[active];
        if (!step) return;

        anchorRef.current = element ?? null;

        if (step.blockInteraction && element) {
          element.classList.add(FROZEN_CLASS);
          frozenRef.current = element;
        }
        if (arrowRef.current) {
          arrowRef.current.style.display = isActionStep(step) && element ? "flex" : "none";
        }

        // A `click` step completes when its own control is actually pressed.
        if (step.advance === "click" && element) {
          const onClick = () => advance(active);
          element.addEventListener("click", onClick, { once: true });
          detachClickRef.current = () => element.removeEventListener("click", onClick);
        }
      },
      onDeselected: () => clearStepBindings(),
      onNextClick: () => advance(activeIndexRef.current),
      onDoneClick: () => finish("completed"),
    });

    driverRef.current = instance;

    // Resume where the user left off, clamped in case the step list shrank
    // since the run that saved it.
    const resumeAt = Math.min(progress.stepIndex, steps.length - 1);
    beginStep(resumeAt);
    prepareStep(resumeAt);
    instance.drive(resumeAt);
    setIsRunning(true);
  }, [
    advance,
    beginStep,
    clearStepBindings,
    finish,
    isAuthenticated,
    isLoading,
    needsOnboarding,
    prepareStep,
    projectsResolved,
    steps,
    t,
  ]);

  /**
   * Keeps the ring on its target. A frame loop rather than scroll and resize
   * listeners, because the sidebar, the router and driver.js all move things
   * independently and any of them can shift an anchor without an event.
   */
  // Other surfaces narrow their options while the tutorial is on screen.
  useEffect(() => {
    setTourActive(isRunning);
    return () => setTourActive(false);
  }, [isRunning, setTourActive]);

  useEffect(() => {
    if (!isRunning) return;

    let frame = 0;
    const track = () => {
      frame = requestAnimationFrame(track);

      // A step can be waiting for a form that another control reveals. There is
      // no event for that, so it is checked here alongside the ring.
      const active = activeIndexRef.current;
      const step = activeStepsRef.current[active];
      if (step?.advance === "element" && step.awaitSelector && !alreadySatisfiedRef.current) {
        if (document.querySelector(step.awaitSelector)) {
          advance(active);
          return;
        }
      }

      const anchor = anchorRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();

      /*
       * driver.js measures the cutout once when a step opens, then only on
       * window resize or scroll. The workbench lays itself out again on its
       * own, so the highlight ends up framing where the anchor used to be and
       * a hard edge cuts through the content. Re-measuring on a moved anchor
       * keeps the cutout on the thing it is meant to be showing.
       */
      const box = [rect.x, rect.y, rect.width, rect.height].map(Math.round).join();
      if (box !== anchorBoxRef.current) {
        anchorBoxRef.current = box;
        driverRef.current?.refresh();
      }

      const ring = arrowRef.current;
      if (!ring || ring.style.display === "none") return;

      placeRing(ring, rect);
    };
    frame = requestAnimationFrame(track);
    return () => cancelAnimationFrame(frame);
  }, [advance, isRunning]);

  /**
   * Hands the tour over to the create project dialog as soon as it opens, so
   * the arrow moves onto the form the user now has to fill rather than staying
   * on the button that is no longer the point.
   */
  useEffect(() => {
    if (!isCreateDialogOpen) return;
    const instance = driverRef.current;
    if (!instance) return;

    const active = activeIndexRef.current;
    if (activeStepsRef.current[active]?.advance !== "dialog") return;

    advance(active);
  }, [advance, isCreateDialogOpen]);

  /**
   * Completes a creation-gated step once the thing is really there. The count
   * must rise above the baseline captured when the step opened, so someone who
   * already had a project or an organization still creates a new one.
   */
  useEffect(() => {
    const instance = driverRef.current;
    if (!instance) return;

    const active = activeIndexRef.current;
    const step = activeStepsRef.current[active];
    if (!step) return;

    const gate =
      step.advance === "project"
        ? { count: projectCount, baseline: projectBaselineRef.current }
        : step.advance === "organization"
          ? { count: organizationCount, baseline: organizationBaselineRef.current }
          : null;

    if (!gate) return;
    if (gate.count <= gate.baseline) return;

    advance(active);
  }, [advance, organizationCount, projectCount]);

  // Tear down if the app unmounts mid-tour. Saved progress resumes it later.
  useEffect(() => {
    return () => {
      detachClickRef.current?.();
      unfreezeAll();
      frozenRef.current = null;
      arrowRef.current?.remove();
      arrowRef.current = null;
      driverRef.current?.destroy();
      driverRef.current = null;
    };
  }, []);

  return null;
}

export default ProductTour;
