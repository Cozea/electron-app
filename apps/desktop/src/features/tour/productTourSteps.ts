/**
 * The first-run product tour, organised into sections.
 *
 * Each section opens with a short introduction, then walks its own steps before
 * the next section begins. The introduction has no anchor, so driver.js centres
 * it: a moment to say what is coming before anything is highlighted.
 *
 * Most steps have no Next button. The user advances by doing the real thing:
 * clicking the highlighted control, or actually creating a project or an
 * organization. Steps that complete because the tour noticed something keep a
 * Next, so a missed observation cannot strand anyone.
 *
 * Copy lives in `lib/i18n/en.ts` like the rest of the interface.
 */

import type { TranslationKey } from "@/lib/i18n"

/**
 * How a step is completed.
 *
 * - `next`: explanation only, so a Next button is the only way on.
 * - `click`: the highlighted control must actually be clicked.
 * - `element`: the step's `awaitSelector` must appear, which is how the tour
 *   follows the user into a surface that another control revealed.
 * - `dialog`: the create project dialog must be opened.
 * - `project` / `organization`: one must actually be created.
 */
export type ProductTourAdvance =
  | "next"
  | "click"
  | "dialog"
  | "element"
  | "project"
  | "organization"

export interface ProductTourStep {
  id: string
  /** Section this step belongs to. Set when the sections are flattened. */
  sectionId?: string
  /** Absent on a section introduction, which driver.js then centres. */
  element?: string
  /**
   * Route to open before the step is shown.
   *
   * Usually absent on `click` steps, because arriving is the user's job. The
   * tour points the way instead: to reach settings the user opens the menu and
   * picks the section, and to come back out they press Back.
   */
  route?: string
  titleKey: TranslationKey
  descriptionKey: TranslationKey
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  advance: ProductTourAdvance
  /** Selector whose appearance completes an `element` step. */
  awaitSelector?: string
  /**
   * Open the project the user created before showing this step. The path is not
   * known until they make one, so it cannot be written down as a route.
   */
  routeToProject?: boolean
  /**
   * The anchor is a whole region rather than a single control, because the user
   * has more than one thing to do inside it.
   */
  anchorIsRegion?: boolean
  /**
   * The anchor is shown to be looked at, not used. Clicks inside it are blocked
   * for the life of the step.
   */
  blockInteraction?: boolean
  /** Leaves settings, restoring the main navigation the later steps need. */
  exitsSettings?: boolean
  /** The step cannot be shown without a project. */
  requiresProject?: boolean
}

export interface ProductTourSection {
  id: string
  /** Heading of the section's opening card. */
  titleKey: TranslationKey
  /** The "here is what we are about to do" line. */
  descriptionKey: TranslationKey
  steps: readonly ProductTourStep[]
}

export const PRODUCT_TOUR_SECTIONS: readonly ProductTourSection[] = [
  {
    id: "projects",
    titleKey: "tour.section.projects.title",
    descriptionKey: "tour.section.projects.description",
    steps: [
      {
        id: "create-project",
        element: '[data-tour="new-project"]',
        route: "/projects",
        titleKey: "tour.project.title",
        descriptionKey: "tour.project.description",
        side: "right",
        align: "start",
        advance: "dialog",
      },
      {
        // The dialog owns the screen once it opens, so the tour follows it in
        // rather than leaving the user staring at a dimmed form.
        id: "create-project-confirm",
        element: '[data-tour="create-project-dialog"]',
        titleKey: "tour.projectConfirm.title",
        descriptionKey: "tour.projectConfirm.description",
        side: "right",
        align: "center",
        advance: "project",
        anchorIsRegion: true,
      },
      {
        id: "project-devapps",
        element: '[data-tour="project-devapps"]',
        routeToProject: true,
        titleKey: "tour.projectDevApps.title",
        descriptionKey: "tour.projectDevApps.description",
        side: "bottom",
        align: "center",
        advance: "next",
        // Opening a DevApp here would take over the workbench and strand the tour.
        blockInteraction: true,
        requiresProject: true,
      },
    ],
  },
  {
    id: "devapps",
    titleKey: "tour.section.devapps.title",
    descriptionKey: "tour.section.devapps.description",
    steps: [
      {
        id: "store",
        element: '[data-tour="nav-store"]',
        titleKey: "tour.store.title",
        descriptionKey: "tour.store.description",
        side: "right",
        align: "start",
        advance: "click",
      },
      {
        // Without this the next section's route would replace the store the
        // instant it opened, and the user would never see the page.
        id: "store-page",
        element: '[data-tour="devapp-store"]',
        titleKey: "tour.storePage.title",
        descriptionKey: "tour.storePage.description",
        side: "left",
        align: "start",
        advance: "next",
        // driver.js already makes everything outside the highlight inert, so
        // the store page is the one live surface left. Installing something or
        // opening a listing here would carry the user off mid-step.
        blockInteraction: true,
      },
    ],
  },
  {
    id: "organizations",
    titleKey: "tour.section.organizations.title",
    descriptionKey: "tour.section.organizations.description",
    steps: [
      {
        // Settings is reached through the user menu. The tour points at it and
        // waits for the settings navigation to appear rather than jumping there.
        id: "open-settings",
        element: '[data-tour="user-menu"]',
        titleKey: "tour.openSettings.title",
        descriptionKey: "tour.openSettings.description",
        side: "top",
        align: "start",
        advance: "element",
        awaitSelector: '[data-tour="settings-organizations"]',
      },
      {
        id: "settings-organizations",
        element: '[data-tour="settings-organizations"]',
        titleKey: "tour.settingsOrganizations.title",
        descriptionKey: "tour.settingsOrganizations.description",
        side: "right",
        align: "start",
        advance: "click",
      },
      {
        id: "organizations",
        element: '[data-tour="new-organization"]',
        titleKey: "tour.organizations.title",
        descriptionKey: "tour.organizations.description",
        side: "bottom",
        align: "end",
        advance: "element",
        awaitSelector: '[data-tour="new-organization-form"]',
      },
      {
        // Pressing the button reveals a form the user has to fill, so the tour
        // moves onto the form rather than staying on a button that is done.
        id: "organizations-confirm",
        element: '[data-tour="new-organization-form"]',
        titleKey: "tour.organizationsConfirm.title",
        descriptionKey: "tour.organizationsConfirm.description",
        side: "right",
        align: "center",
        advance: "organization",
        anchorIsRegion: true,
      },
      {
        id: "org-members",
        element: '[data-tour="org-members-tab"]',
        titleKey: "tour.orgMembers.title",
        descriptionKey: "tour.orgMembers.description",
        side: "bottom",
        align: "start",
        advance: "next",
      },
      {
        // The settings sidebar replaces the main navigation, so every later
        // step's control is missing until the user comes back out. Back is how
        // a person actually leaves, so the tour points at it.
        id: "leave-settings",
        element: '[data-tour="settings-back"]',
        titleKey: "tour.leaveSettings.title",
        descriptionKey: "tour.leaveSettings.description",
        side: "right",
        align: "start",
        advance: "click",
        exitsSettings: true,
      },
      {
        id: "inbox",
        element: '[data-tour="nav-inbox"]',
        titleKey: "tour.inbox.title",
        descriptionKey: "tour.inbox.description",
        side: "right",
        align: "start",
        advance: "click",
      },
    ],
  },
  {
    id: "builds",
    titleKey: "tour.section.builds.title",
    descriptionKey: "tour.section.builds.description",
    steps: [
      {
        id: "default-build",
        element: '[data-tour="nav-builds"]',
        titleKey: "tour.defaultBuild.title",
        descriptionKey: "tour.defaultBuild.description",
        side: "right",
        align: "start",
        advance: "click",
      },
      {
        // Waits for the build to actually go live, not for the button to be
        // pressed: activation is asynchronous and can fail.
        id: "activate-build",
        element: '[data-tour="activate-build"]',
        titleKey: "tour.activateBuild.title",
        descriptionKey: "tour.activateBuild.description",
        side: "bottom",
        align: "end",
        advance: "element",
        awaitSelector: '[data-tour="activate-build"][data-tour-state="active"]',
      },
      {
        id: "provider-builds",
        element: '[data-tour="skill-builds"]',
        titleKey: "tour.providerBuilds.title",
        descriptionKey: "tour.providerBuilds.description",
        side: "left",
        align: "start",
        advance: "next",
      },
    ],
  },
  {
    id: "schedules",
    titleKey: "tour.section.schedules.title",
    descriptionKey: "tour.section.schedules.description",
    steps: [
      {
        id: "scheduled-tasks",
        element: '[data-tour="nav-schedules"]',
        titleKey: "tour.schedules.title",
        descriptionKey: "tour.schedules.description",
        side: "right",
        align: "start",
        advance: "click",
      },
      {
        id: "schedules-page",
        element: '[data-tour="scheduled-tasks-page"]',
        titleKey: "tour.schedulesPage.title",
        descriptionKey: "tour.schedulesPage.description",
        side: "left",
        align: "start",
        advance: "next",
        blockInteraction: true,
      },
    ],
  },
  {
    // A closing card. No steps: the section opening is the whole of it.
    id: "done",
    titleKey: "tour.section.done.title",
    descriptionKey: "tour.section.done.description",
    steps: [],
  },
]

/** The id of a section's opening card. */
export function sectionIntroId(sectionId: string): string {
  return `${sectionId}-intro`
}

/** Every section flattened into the sequence driver.js actually walks. */
export const PRODUCT_TOUR_STEPS: readonly ProductTourStep[] = PRODUCT_TOUR_SECTIONS.flatMap(
  (section) => [
    {
      id: sectionIntroId(section.id),
      sectionId: section.id,
      titleKey: section.titleKey,
      descriptionKey: section.descriptionKey,
      advance: "next" as const,
    },
    ...section.steps.map((step) => ({ ...step, sectionId: section.id })),
  ],
)

/** True when the step is completed by doing something rather than reading. */
export function isActionStep(step: ProductTourStep): boolean {
  return step.advance !== "next"
}

/** True when the step opens a section rather than pointing at anything. */
export function isSectionIntro(step: ProductTourStep): boolean {
  return step.element === undefined
}

/**
 * Numbers each step within its own section, so the counter reads "2 of 3" for
 * the section the user is in rather than a running total across the whole tour.
 *
 * Computed from the resolved list, not the full one: dropping the steps that
 * need a project shrinks a section, and the count has to shrink with it.
 * Section openings are left out, being the door into a section rather than a
 * step of it.
 */
export function resolveSectionProgress(
  steps: readonly ProductTourStep[],
): Map<string, { position: number; total: number }> {
  const totals = new Map<string, number>()
  for (const step of steps) {
    if (isSectionIntro(step) || !step.sectionId) continue
    totals.set(step.sectionId, (totals.get(step.sectionId) ?? 0) + 1)
  }

  const seen = new Map<string, number>()
  const progress = new Map<string, { position: number; total: number }>()
  for (const step of steps) {
    if (isSectionIntro(step) || !step.sectionId) continue
    const position = (seen.get(step.sectionId) ?? 0) + 1
    seen.set(step.sectionId, position)
    progress.set(step.id, { position, total: totals.get(step.sectionId) ?? position })
  }
  return progress
}

/**
 * Drops steps whose surface does not exist for this user. Someone who declined
 * to create a project has no workbench, so those steps would highlight nothing.
 */
export function resolveProductTourSteps(options: { hasProject: boolean }): ProductTourStep[] {
  return PRODUCT_TOUR_STEPS.filter((step) => !step.requiresProject || options.hasProject)
}
