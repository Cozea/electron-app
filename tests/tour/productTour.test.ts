import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import en from "@/lib/i18n/en";
import es from "@/lib/i18n/es";
import {
  isActionStep,
  isSectionIntro,
  PRODUCT_TOUR_SECTIONS,
  PRODUCT_TOUR_STEPS,
  resolveProductTourSteps,
  resolveSectionProgress,
  sectionIntroId,
} from "@/features/tour/productTourSteps";
import {
  isProductTourFinished,
  readProductTourProgress,
  resetProductTourProgress,
  writeProductTourProgress,
} from "@/features/tour/productTourStorage";

const STORAGE_KEY = "cozea:product-tour:v1";

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("product tour progress storage", () => {
  beforeEach(() => {
    resetProductTourProgress();
  });

  it("treats a device with no record as a new user", () => {
    const progress = readProductTourProgress();

    expect(progress.status).toBe("pending");
    expect(progress.stepIndex).toBe(0);
    expect(isProductTourFinished(progress)).toBe(false);
  });

  it("round trips the step a user stopped on so the tour resumes in place", () => {
    writeProductTourProgress({ status: "pending", stepIndex: 4 });

    const progress = readProductTourProgress();

    expect(progress.status).toBe("pending");
    expect(progress.stepIndex).toBe(4);
    expect(isProductTourFinished(progress)).toBe(false);
  });

  it("never offers the tour again once it is completed or skipped", () => {
    for (const status of ["completed", "skipped"] as const) {
      writeProductTourProgress({ status, stepIndex: 0 });
      expect(isProductTourFinished(readProductTourProgress())).toBe(true);
    }
  });

  it("falls back to a fresh start rather than throwing on a corrupted record", () => {
    localStorage.setItem(STORAGE_KEY, "{ not json");
    expect(readProductTourProgress().status).toBe("pending");

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ status: "bogus", stepIndex: 3 }));
    expect(readProductTourProgress().status).toBe("pending");

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ status: "pending", stepIndex: -7 }));
    expect(readProductTourProgress().stepIndex).toBe(0);
  });
});

describe("product tour steps", () => {
  it("runs section by section, each opening with its own card", () => {
    expect(PRODUCT_TOUR_SECTIONS.map((section) => section.id)).toEqual([
      "projects",
      "devapps",
      "organizations",
      "builds",
      "schedules",
      "done",
    ]);

    // Every section is introduced before any of its steps.
    const ids = PRODUCT_TOUR_STEPS.map((step) => step.id);
    for (const section of PRODUCT_TOUR_SECTIONS) {
      const intro = ids.indexOf(sectionIntroId(section.id));
      expect(intro, `${section.id} needs an opening card`).toBeGreaterThan(-1);
      for (const step of section.steps) {
        expect(ids.indexOf(step.id), `${step.id} follows its opening`).toBeGreaterThan(intro);
      }
    }
  });

  it("covers every surface the tutorial promises, in order", () => {
    expect(PRODUCT_TOUR_STEPS.map((step) => step.id)).toEqual([
      "projects-intro",
      "create-project",
      "create-project-confirm",
      "project-devapps",
      "devapps-intro",
      "store",
      "store-page",
      "organizations-intro",
      "open-settings",
      "settings-organizations",
      "organizations",
      "organizations-confirm",
      "org-members",
      "leave-settings",
      "inbox",
      "builds-intro",
      "default-build",
      "activate-build",
      "provider-builds",
      "schedules-intro",
      "scheduled-tasks",
      "schedules-page",
      "done-intro",
    ]);
  });

  it("counts within the section, not across the whole tour", () => {
    const progress = resolveSectionProgress(PRODUCT_TOUR_STEPS);

    // The organizations section has six steps, so its last reads "6 of 6",
    // never "14 of 21".
    expect(progress.get("open-settings")).toEqual({ position: 1, total: 7 });
    expect(progress.get("inbox")).toEqual({ position: 7, total: 7 });
    // A one-step section says so.
    expect(progress.get("scheduled-tasks")).toEqual({ position: 1, total: 2 });
    // The builds section gained the activation step.
    expect(progress.get("activate-build")).toEqual({ position: 2, total: 3 });
    // Openings are the door into a section, not a step of it.
    for (const section of PRODUCT_TOUR_SECTIONS) {
      expect(progress.has(sectionIntroId(section.id))).toBe(false);
    }
  });

  it("shrinks a section's count when its steps are dropped", () => {
    // The memory section is a single in-project step, so a user with no project
    // loses it entirely rather than being told "1 of 1" with nothing to show.
    const withoutProject = resolveProductTourSteps({ hasProject: false });
    const progress = resolveSectionProgress(withoutProject);

    expect(progress.has("project-devapps")).toBe(false);
    // The projects section keeps its remaining steps, renumbered.
    expect(progress.get("create-project")).toEqual({ position: 1, total: 2 });
    expect(progress.get("create-project-confirm")).toEqual({ position: 2, total: 2 });
  });

  it("gives every opening card no anchor, so it is centred", () => {
    for (const section of PRODUCT_TOUR_SECTIONS) {
      const intro = PRODUCT_TOUR_STEPS.find((s) => s.id === sectionIntroId(section.id));
      expect(isSectionIntro(intro!), `${section.id} opening must not point at anything`).toBe(true);
      expect(intro?.advance).toBe("next");
    }
  });

  it("makes the user really create a project and an organization", () => {
    const byAdvance = (advance: string) =>
      PRODUCT_TOUR_STEPS.filter((step) => step.advance === advance).map((step) => step.id);

    expect(byAdvance("dialog")).toEqual(["create-project"]);
    expect(byAdvance("project")).toEqual(["create-project-confirm"]);
    expect(byAdvance("element")).toEqual([
      "open-settings",
      "organizations",
      "activate-build",
    ]);
    expect(byAdvance("organization")).toEqual(["organizations-confirm"]);
  });

  it("explains DevApps and extra builds without demanding either is built", () => {
    // These two exist to tell the user how something works. Nothing is created.
    const explained = PRODUCT_TOUR_STEPS.filter((step) => step.advance === "next").map(
      (step) => step.id,
    );

    expect(explained).toContain("project-devapps");
    expect(explained).toContain("provider-builds");
  });

  it("makes the remaining steps depend on pressing the real control", () => {
    expect(PRODUCT_TOUR_STEPS.filter((step) => step.advance === "click").map((s) => s.id)).toEqual([
      "store",
      "settings-organizations",
      "leave-settings",
      "inbox",
      "default-build",
      "scheduled-tasks",
    ]);
  });

  it("puts every sidebar control on screen before asking for it", () => {
    // The organization steps run inside Settings, whose sidebar replaces the
    // main navigation. Every nav anchor after that point is absent until the
    // tour comes back out, which is what stalled the tutorial at step 6 with
    // seven steps left.
    const inMainSidebar = readSource(
      "apps/desktop/src/features/projects/ui/ProjectSidebar.tsx",
    );

    // Where the user actually is: the last route any earlier step navigated to,
    // not just the route of the step immediately before.
    let location: string | undefined;

    for (const step of PRODUCT_TOUR_STEPS) {
      const anchor = step.element?.match(/\[data-tour="([^"]+)"\]/)?.[1];
      const needsMainSidebar = Boolean(anchor && inMainSidebar.includes(`data-tour="${anchor}"`));

      if (needsMainSidebar && location?.includes("/settings")) {
        expect(
          step.route,
          `${step.id} needs the main sidebar but ${location} replaced it`,
        ).toBeTruthy();
      }

      if (step.exitsSettings) location = "/projects";
      else if (step.routeToProject) location = "/p/project/workbench";
      else if (step.route) location = step.route;
    }
  });

  it("treats everything but an explanation as an action step", () => {
    for (const step of PRODUCT_TOUR_STEPS) {
      expect(isActionStep(step)).toBe(step.advance !== "next");
    }
  });

  it("drops the in-project steps when the user never created a project", () => {
    const withProject = resolveProductTourSteps({ hasProject: true }).map((step) => step.id);
    const withoutProject = resolveProductTourSteps({ hasProject: false }).map((step) => step.id);
    const insideProject = ["project-devapps"];

    for (const id of insideProject) {
      expect(withProject, `${id} needs a project`).toContain(id);
      expect(withoutProject, `${id} has nowhere to point`).not.toContain(id);
    }
    // Losing them must not disturb the rest of the sequence.
    expect(withoutProject).toEqual(withProject.filter((id) => !insideProject.includes(id)));
  });
});

describe("product tour anchors and copy", () => {
  /**
   * The tour highlights elements by `data-tour` attribute. Those attributes sit
   * in feature components that know nothing about the tour, so a rename would
   * otherwise silently reduce the tutorial to skipped steps.
   */
  const anchorSources = [
    "apps/desktop/src/components/nav-user.tsx",
    "apps/desktop/src/features/settings/ui/SettingsSidebar.tsx",
    "apps/desktop/src/features/projects/ui/CreateProjectDialog.tsx",
    "apps/desktop/src/features/projects/ui/ProjectSidebar.tsx",
    "apps/desktop/src/features/settings/Organizations.tsx",
    "apps/desktop/src/features/workbench/WorkbenchSelectionTile.tsx",
    "apps/desktop/src/features/devapps/pages/AppStorePage.tsx",
    "apps/desktop/src/features/projects/components/SkillBuildsView.tsx",
    "apps/desktop/src/features/projects/pages/ScheduledTasksView.tsx",
  ]
    .map(readSource)
    .join("\n");

  it("has a live anchor in the interface for every step", () => {
    for (const step of PRODUCT_TOUR_STEPS.filter((s) => !isSectionIntro(s))) {
      const anchor = step.element?.match(/\[data-tour="([^"]+)"\]/)?.[1];
      expect(anchor, `step ${step.id} must target a data-tour anchor`).toBeDefined();
      // Some anchors are passed through a prop rather than written inline, so
      // the name is what is searched for, not one exact spelling.
      expect(anchorSources, `no anchor "${anchor}" rendered for step ${step.id}`).toContain(
        `"${anchor}"`,
      );
    }
  });

  it("points every arrow at a real control, never at a container", () => {
    // An action step has no Next button, so its arrow is the instruction. An
    // arrow aimed at a <section> points at an edge and tells the user nothing.
    // A region step surrounds a whole form on purpose, so it is exempt.
    for (const step of PRODUCT_TOUR_STEPS.filter(isActionStep)
      .filter((s) => !s.anchorIsRegion)
      .filter((s) => !isSectionIntro(s))) {
      const name = step.element?.match(/\[data-tour="([^"]+)"\]/)?.[1];
      const at = anchorSources.indexOf(`"${name}"`);
      expect(at, `no anchor rendered for ${step.id}`).toBeGreaterThan(-1);

      // Walk back to the tag that carries the attribute.
      const openedAt = anchorSources.lastIndexOf("<", at);
      const tag = anchorSources.slice(openedAt + 1).match(/^[A-Za-z][\w.]*/)?.[0];
      // A wrapper counts if it is named as a button, or if its own definition
      // is in these sources and renders one. Anything else is a container.
      const named = /button$/i.test(tag ?? "");
      const definition = anchorSources.indexOf(`function ${tag}(`);
      const rendersButton =
        definition > -1 && anchorSources.slice(definition, definition + 1200).includes("<button");

      expect(
        named || rendersButton,
        `${step.id} must anchor a button, got <${tag}>`,
      ).toBe(true);
    }
  });

  it("has English and Spanish copy for every step", () => {
    for (const step of PRODUCT_TOUR_STEPS) {
      for (const key of [step.titleKey, step.descriptionKey]) {
        expect(en[key as keyof typeof en], `missing en copy for ${key}`).toBeTruthy();
        expect(es[key as keyof typeof es], `missing es copy for ${key}`).toBeTruthy();
      }
    }
  });

  it("stays short and never narrates itself", () => {
    // Step copy explains the product, not the tutorial. Lines like
    // "the tour carries on as soon as it exists" are noise: the arrow and the
    // absent Next button already say what to do.
    const meta = [
      "the tour",
      "el tutorial",
      "carry on",
      "continúa",
      "to continue",
      "para continuar",
      "last stop",
    ];

    for (const step of PRODUCT_TOUR_STEPS) {
      for (const [locale, dictionary] of [
        ["en", en],
        ["es", es],
      ] as const) {
        const copy = dictionary[step.descriptionKey as keyof typeof dictionary] as string;
        expect(copy.length, `${locale} ${step.id} copy is rambling`).toBeLessThanOrEqual(160);
        for (const phrase of meta) {
          expect(
            copy.toLowerCase(),
            `${locale} ${step.id} copy should not mention the tutorial itself`,
          ).not.toContain(phrase);
        }
      }
    }
  });

  it("has copy for the skip control and the navigation buttons", () => {
    for (const key of ["tour.skip", "tour.next", "tour.done", "tour.progress"]) {
      expect(en[key as keyof typeof en], `missing en copy for ${key}`).toBeTruthy();
      expect(es[key as keyof typeof es], `missing es copy for ${key}`).toBeTruthy();
    }
  });
});

describe("product tour behaviour", () => {
  const tourSource = readSource("apps/desktop/src/features/tour/ProductTour.tsx");
  const tourStyles = readSource("apps/desktop/src/features/tour/productTour.css");
  const appSource = readSource("apps/desktop/src/App.tsx");

  it("starts only after device onboarding is finished", () => {
    expect(tourSource).toContain("needsOnboarding");
    expect(tourSource).toMatch(/if \(!isAuthenticated \|\| isLoading \|\| needsOnboarding\) return/);
  });

  it("cannot be dismissed by clicking outside it or by the keyboard", () => {
    expect(tourSource).toContain("allowClose: false");
    expect(tourSource).toContain("allowKeyboardControl: false");
  });

  it("leaves the highlighted control clickable", () => {
    // Without this the user could not perform the action the step demands.
    expect(tourSource).toContain("disableActiveInteraction: false");
  });

  it("offers skipping as the only way out", () => {
    expect(tourSource).toContain('skip.className = "cozea-tour-skip"');
    expect(tourSource).toContain('finish("skipped")');
    expect(tourSource).toContain('finish("completed")');
  });

  it("offers Next only where there is nothing to do", () => {
    // An explanation has no action to complete it, so Next is the only way on.
    // Everything else is finished by doing the thing the step is about.
    expect(tourSource).toContain('showButtons: isActionStep(step) ? [] : ["next"]');

    const withNext = PRODUCT_TOUR_STEPS.filter((step) => !isActionStep(step)).map((s) => s.id);
    expect(withNext).toEqual([
      "projects-intro",
      "project-devapps",
      "devapps-intro",
      "store-page",
      "organizations-intro",
      "org-members",
      "builds-intro",
      "provider-builds",
      "schedules-intro",
      "schedules-page",
      "done-intro",
    ]);
  });

  it("completes a creation step only when the count rises during the step", () => {
    // A baseline captured on highlight is what separates creating something
    // from being credited for something that already existed.
    expect(tourSource).toContain("projectBaselineRef.current = projectCountRef.current");
    expect(tourSource).toContain("organizationBaselineRef.current = organizationCountRef.current");
    expect(tourSource).toContain("if (gate.count <= gate.baseline) return");
  });

  it("finishes on the last step, which has no Done button to press", () => {
    expect(tourSource).toMatch(
      /if \(from >= activeStepsRef\.current\.length - 1\) \{\s*\n\s*finish\("completed"\);/,
    );
  });

  it("rings the control with arrows converging on it", () => {
    expect(tourSource).toContain("cozea-tour-ring");
    expect(tourSource).toContain("placeRing");
    // Eight blades, so the ring reads as surrounding rather than beside.
    for (const at of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) {
      expect(tourStyles, `ring needs a ${at} blade`).toContain(
        `.cozea-tour-blade[data-at="${at}"]`,
      );
    }
    expect(tourStyles).toContain("cozea-tour-converge");
  });

  it("draws corners as brackets and sides as chevrons", () => {
    // A chevron is a right angle, so at 45 degrees its arms go flat and it
    // reads as a bracket regardless. The corners are drawn as brackets on
    // purpose so the ring frames the control instead of looking broken.
    expect(tourSource).toContain("CHEVRON_SVG");
    expect(tourSource).toContain("BRACKET_SVG");
    expect(tourSource).toContain('kind === "side" ? CHEVRON_SVG : BRACKET_SVG');
    expect(tourStyles).toContain('.cozea-tour-blade[data-kind="corner"]');
  });

  it("surrounds the whole create project form, not just its button", () => {
    // The user has a name and a folder to fill in. Ringing only the submit
    // button leaves both fields dimmed and the popover sitting over them.
    const confirm = PRODUCT_TOUR_STEPS.find((step) => step.id === "create-project-confirm");
    expect(confirm?.anchorIsRegion).toBe(true);
    expect(confirm?.element).toContain("create-project-dialog");
    // Beside the form, so the popover cannot cover the fields.
    expect(confirm?.side).toBe("right");
  });

  it("stops the ring animating when motion is not wanted", () => {
    expect(tourStyles).toContain("prefers-reduced-motion");
  });

  it("runs the ring frame loop only while a tour is on screen", () => {
    // The loop would otherwise keep a requestAnimationFrame callback alive for
    // the whole session, for every user, long after the tour is finished.
    expect(tourSource).toMatch(/useEffect\(\(\) => \{\s*\n\s*if \(!isRunning\) return;/);
    expect(tourSource).toMatch(/\}, \[(?:[\w\s,]*\b)?isRunning\]\);/);
    expect(tourSource).toContain("setIsRunning(true);");
  });

  it("keeps a revealed form usable by highlighting the form itself", () => {
    // driver.js sets `pointer-events: none` on everything except the element it
    // highlights. A dialog opening over a highlighted button is therefore
    // visible, dimmed and dead. Highlighting the whole form is what revives it,
    // which is why these steps are regions.
    for (const id of ["create-project-confirm", "organizations-confirm"]) {
      const step = PRODUCT_TOUR_STEPS.find((s) => s.id === id);
      expect(step?.anchorIsRegion, `${id} must highlight the whole form`).toBe(true);
    }
  });

  it("follows the user into the create project dialog", () => {
    expect(tourSource).toContain("useCreateProjectDialogStore");
    expect(tourSource).toMatch(/advance !== "dialog"\) return;/);
  });

  it("narrows the choices a menu offers while the tutorial runs", () => {
    // The project menu offers four routes. Only the empty project one has tour
    // steps, so the others stay visible but unclickable rather than sending the
    // user somewhere the tour cannot follow.
    const menu = readSource(
      "apps/desktop/src/features/projects/hooks/useProjectCreationMenu.ts",
    );

    expect(menu).toContain("useProductTourStore");
    expect(menu.match(/enabled: !isTourActive/g)?.length).toBe(3);
    // The route the tutorial teaches must never be disabled.
    const emptyItem = menu.split("\n").find((line) => line.includes('id: "empty"'));
    expect(emptyItem, "the empty project item must exist").toBeDefined();
    expect(emptyItem).not.toContain("enabled");
  });

  it("passes the disabled state through to the native menu", () => {
    const handler = readSource(
      "apps/desktop/electron/ipc/registerContextMenuHandlers.ts",
    );

    expect(handler).toContain("enabled: item.enabled ?? true");
  });

  it("publishes whether a tour is on screen", () => {
    expect(tourSource).toContain("setTourActive(isRunning)");
  });

  it("lets the user actually see the store page it just opened", () => {
    // The next section's route used to fire the instant the store opened,
    // replacing the page the user had just been sent to.
    const ids = PRODUCT_TOUR_STEPS.map((step) => step.id);

    expect(ids.indexOf("store-page")).toBe(ids.indexOf("store") + 1);
    const onStore = PRODUCT_TOUR_STEPS.find((step) => step.id === "store-page");
    // It must not navigate: the user's own click is what opened the page.
    expect(onStore?.route).toBeUndefined();
    expect(onStore?.routeToProject).toBeUndefined();
  });


  it("follows the user into any form a control reveals", () => {
    // Pressing New organization reveals a name field. Staying on the button
    // leaves that field dimmed under the popover telling the user to fill it.
    const reveal = PRODUCT_TOUR_STEPS.find((step) => step.id === "organizations");
    const fill = PRODUCT_TOUR_STEPS.find((step) => step.id === "organizations-confirm");

    expect(reveal?.advance).toBe("element");
    expect(reveal?.awaitSelector).toBe('[data-tour="new-organization-form"]');
    expect(fill?.element).toBe('[data-tour="new-organization-form"]');
    expect(fill?.anchorIsRegion).toBe(true);
    // Beside the form, never over the field the user has to type into.
    expect(fill?.side).toBe("right");
  });

  it("has an awaitSelector for every element step", () => {
    for (const step of PRODUCT_TOUR_STEPS.filter((s) => s.advance === "element")) {
      expect(step.awaitSelector, `${step.id} waits for nothing`).toBeTruthy();
    }
  });

  it("never asks driver.js which step it is on", () => {
    // driver.js has not updated its own index inside onHighlighted, so reading
    // it there returned the previous step. The organization step then recorded
    // no baseline, kept the project step's, and could never complete.
    expect(tourSource).not.toContain("getActiveIndex");
    expect(tourSource).toContain("activeIndexRef");
  });

  it("gives each creation gate its own baseline", () => {
    // One shared baseline let the project count block the organization gate.
    expect(tourSource).toContain("projectBaselineRef");
    expect(tourSource).toContain("organizationBaselineRef");
    expect(tourSource).not.toContain("gateBaselineRef");
  });

  it("records the step before driver.js is asked to move to it", () => {
    expect(tourSource).toMatch(/beginStep\(from \+ 1\);\s*\n\s*prepareStep\(from \+ 1\);/);
    expect(tourSource).toMatch(/beginStep\(resumeAt\);\s*\n\s*prepareStep\(resumeAt\);/);
  });

  it("ignores an advance from a step the tour has already left", () => {
    expect(tourSource).toContain("if (from !== activeIndexRef.current) return;");
  });

  it("shows the project's own DevApps before mentioning the store at all", () => {
    // The user has just landed on their new project, looking at its DevApp
    // icons. That is the moment to say what they are, before the store.
    const ids = PRODUCT_TOUR_STEPS.map((step) => step.id);
    const seen = ids.indexOf("project-devapps");

    expect(seen).toBe(ids.indexOf("create-project-confirm") + 1);
    for (const later of ["devapps-intro", "store", "store-page"]) {
      expect(seen, `${later} must come after the project's own DevApps`).toBeLessThan(
        ids.indexOf(later),
      );
    }
  });

  it("opens the created project for steps that live inside it", () => {
    // The path is only known once the user makes a project, so these steps
    // declare the intent instead of carrying a route.
    const inProject = PRODUCT_TOUR_STEPS.filter((step) => step.routeToProject);

    expect(inProject.map((step) => step.id)).toEqual(["project-devapps"]);
    for (const step of inProject) {
      expect(step.requiresProject, `${step.id} needs a project`).toBe(true);
      expect(step.route, `${step.id} cannot carry a fixed route`).toBeUndefined();
    }
    expect(tourSource).toContain("step.routeToProject && firstProjectId");
  });

  it("stops the user opening a DevApp while the tour is explaining them", () => {
    // The backdrop passes clicks through by design, so those icons stay live.
    // One click takes over the workbench and the tour is left pointing at a
    // page that is gone.
    for (const id of ["project-devapps", "store-page"]) {
      const step = PRODUCT_TOUR_STEPS.find((s) => s.id === id);
      expect(step?.blockInteraction, `${id} must be frozen while explained`).toBe(true);
    }

    expect(tourSource).toContain("element.classList.add(FROZEN_CLASS)");
    expect(tourStyles).toMatch(/\.cozea-tour-frozen[\s\S]{0,80}pointer-events: none/);
  });

  it("cannot leave any part of the app frozen once the tour ends", () => {
    // Leaving a page permanently dead is far worse than the bug this fixes, so
    // it must not depend on a cleanup path running. driver.js puts
    // `driver-active` on <body> while driving and always removes it on
    // destroy, so scoping the rule under it makes the freeze expire with the
    // tour no matter how the tour ended.
    expect(tourStyles).toMatch(/body\.driver-active \.cozea-tour-frozen/);
    expect(tourStyles).not.toMatch(/^\.cozea-tour-frozen/m);

    // And cleanup sweeps the document rather than trusting a stored reference.
    expect(tourSource).toContain("document.querySelectorAll(`.${FROZEN_CLASS}`)");
    const sweeps = tourSource.match(/unfreezeAll\(\);/g);
    expect(sweeps?.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the counter off the section openings", () => {
    // driver.js resolves this as `step.showProgress || config.showProgress`, an
    // OR rather than a nullish check. A global `true` therefore makes a
    // per-step `false` impossible, and every opening card carried a counter.
    // The global must stay off and each step must opt in.
    expect(tourSource).toContain("showProgress: false");
    expect(tourSource).toContain("showProgress: !isSectionIntro(step)");
    expect(tourSource).not.toContain("showProgress: true");
  });

  it("keeps the cutout on its anchor when the page relays out", () => {
    // driver.js measures the stage once when a step opens, then only on window
    // resize or scroll. The workbench lays itself out again on its own, which
    // left the highlight framing where the anchor used to be, with a hard edge
    // cutting straight through the content.
    expect(tourSource).toContain("anchorBoxRef");
    expect(tourSource).toContain("driverRef.current?.refresh()");
  });

  it("waits for the default build to actually go live", () => {
    const step = PRODUCT_TOUR_STEPS.find((s) => s.id === "activate-build");

    // Activation is asynchronous and can fail, so the step watches the build's
    // own state rather than treating a click as success.
    expect(step?.advance).toBe("element");
    expect(step?.awaitSelector).toBe('[data-tour="activate-build"][data-tour-state="active"]');

    const view = readSource(
      "apps/desktop/src/features/projects/components/SkillBuildsView.tsx",
    );
    expect(view).toContain('data-tour-state={isCurrentActive ? "active" : "inactive"}');
  });

  it("offers a way on when the thing a step waits for already happened", () => {
    // Someone whose default build was already active would otherwise watch the
    // step vanish, or sit on one that can never complete.
    expect(tourSource).toContain("alreadySatisfiedRef");
    expect(tourSource).toMatch(/if \(alreadySatisfiedRef\.current\) \{[\s\S]*?popover\.footerButtons\.appendChild/);
    expect(tourSource).toContain('!alreadySatisfiedRef.current');
  });

  it("ends on a card that sends the user off", () => {
    const ids = PRODUCT_TOUR_STEPS.map((step) => step.id);
    expect(ids[ids.length - 1]).toBe("done-intro");

    // A closing card, so it points at nothing and carries no counter.
    const done = PRODUCT_TOUR_STEPS[PRODUCT_TOUR_STEPS.length - 1];
    expect(isSectionIntro(done!)).toBe(true);
    expect(resolveSectionProgress(PRODUCT_TOUR_STEPS).has("done-intro")).toBe(false);
  });

  it("is mounted in the main window only", () => {
    expect(appSource).toContain("LazyProductTour");
    expect(appSource).toMatch(/\{!isSettingsWindow && \(\s*<Suspense fallback=\{null\}>/);
  });
});
