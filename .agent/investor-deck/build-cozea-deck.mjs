import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const W = 1280;
const H = 720;
const M = 56;
const FONT = "Helvetica Neue";

const C = {
  ink: "#F5F7FB",
  muted: "#A9B2C1",
  soft: "#717B8C",
  panel: "#10151D",
  panel2: "#171E28",
  rule: "#303A48",
  accent: "#AEB9C7",
  blue: "#55B6FF",
  blue2: "#1976D2",
  dark: "#06080D",
  white: "#F7F9FC",
  silver: "#D9E0E8",
  chrome: "#596677",
  green: "#0E8A5F",
  amber: "#B86E00",
  red: "#B42318",
};

let metallicContentBackground;

const TMP_DIR = "/Users/erickxu/Desktop/BS/Cozea/app/cozea-2.0/.agent/investor-deck";
const ASSET_DIR = path.join(TMP_DIR, "assets");
const RENDER_DIR = path.join(TMP_DIR, "rendered");
const FINAL_PPTX = "/Users/erickxu/Desktop/BS/Cozea/app/cozea-2.0/Cozea-Investor-Read-Deck.pptx";

async function imageBytes(filename) {
  const bytes = await fs.readFile(path.join(ASSET_DIR, filename));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function addShape(slide, position, fill = "none", lineFill = "none", geometry = "rect", radius = undefined) {
  return slide.shapes.add({
    geometry,
    position,
    fill,
    line: { style: "solid", fill: lineFill, width: lineFill === "none" ? 0 : 1 },
    ...(radius ? { borderRadius: radius } : {}),
  });
}

function addRule(slide, left, top, width, fill = C.rule, height = 1) {
  return addShape(slide, { left, top, width, height }, fill, "none", "rect");
}

function addContentBackground(slide) {
  if (!metallicContentBackground) return;
  slide.images.add({
    blob: metallicContentBackground,
    contentType: "image/png",
    alt: "Subtle graphite and brushed-metal presentation background",
    fit: "cover",
    position: { left: 0, top: 0, width: W, height: H },
  });
  addShape(slide, { left: 0, top: 0, width: W, height: H }, "#05070A78", "none");
  addRule(slide, M, 18, 116, C.chrome, 2);
  addRule(slide, M + 116, 18, 34, C.blue, 2);
}

function addText(slide, text, position, options = {}) {
  const box = slide.shapes.add({
    geometry: "textbox",
    name: options.name,
    position,
    fill: options.fill ?? "none",
    line: { style: "solid", fill: options.lineFill ?? "none", width: options.lineFill ? 1 : 0 },
  });
  box.text = text;
  box.text.style = {
    fontSize: options.fontSize ?? 21.33,
    typeface: options.typeface ?? FONT,
    bold: options.bold ?? false,
    italic: options.italic ?? false,
    color: options.color ?? C.ink,
    alignment: options.alignment ?? "left",
    verticalAlignment: options.verticalAlignment ?? "top",
    autoFit: options.autoFit ?? "shrinkText",
    wrap: options.wrap ?? "square",
    lineSpacing: options.lineSpacing ?? 1.05,
    insets: options.insets ?? { top: 0, right: 0, bottom: 0, left: 0 },
  };
  return box;
}

function addRichText(slide, paragraphs, position, options = {}) {
  const box = slide.shapes.add({
    geometry: "textbox",
    name: options.name,
    position,
    fill: options.fill ?? "none",
    line: { style: "solid", fill: options.lineFill ?? "none", width: options.lineFill ? 1 : 0 },
  });
  box.text.set(paragraphs);
  box.text.style = {
    fontSize: options.fontSize ?? 21.33,
    typeface: options.typeface ?? FONT,
    color: options.color ?? C.ink,
    alignment: options.alignment ?? "left",
    verticalAlignment: options.verticalAlignment ?? "top",
    autoFit: options.autoFit ?? "shrinkText",
    wrap: "square",
    lineSpacing: options.lineSpacing ?? 1.05,
    insets: options.insets ?? { top: 0, right: 0, bottom: 0, left: 0 },
  };
  return box;
}

function addBulletList(slide, items, position, options = {}) {
  const paragraphs = items.map((item) => ({
    bulletCharacter: "•",
    marginLeft: 22,
    indent: -12,
    spaceAfter: options.spaceAfter ?? 9,
    runs: typeof item === "string"
      ? [{ run: item }]
      : [
          { run: item.label, textStyle: { bold: true } },
          { run: item.text },
        ],
  }));
  return addRichText(slide, paragraphs, position, {
    fontSize: options.fontSize ?? 21.33,
    color: options.color ?? C.ink,
    lineSpacing: options.lineSpacing ?? 1.04,
    autoFit: options.autoFit ?? "shrinkText",
  });
}

function addImage(slide, blob, contentType, alt, position, options = {}) {
  if (options.backing) {
    addShape(
      slide,
      { left: position.left - 6, top: position.top - 6, width: position.width + 12, height: position.height + 12 },
      options.backingFill ?? C.panel2,
      options.backingLine ?? C.chrome,
      "roundRect",
      options.radius ?? "rounded-xl",
    );
    addShape(
      slide,
      { left: position.left - 2, top: position.top - 2, width: position.width + 4, height: position.height + 4 },
      C.dark,
      C.rule,
      "roundRect",
      options.radius ?? "rounded-xl",
    );
  }
  return slide.images.add({
    blob,
    contentType,
    alt,
    fit: options.fit ?? "cover",
    position,
    geometry: options.geometry ?? "roundRect",
    borderRadius: options.radius ?? "rounded-xl",
    ...(options.crop ? { crop: options.crop } : {}),
  });
}

function addNotes(slide, sources, context = "") {
  const lines = ["[Sources]", ...sources.map((source) => `- ${source}`)];
  if (context) lines.push("", "[Context]", context);
  slide.speakerNotes.textFrame.setText(lines.join("\n"));
  slide.speakerNotes.setVisible(true);
}

function addHeader(slide, section) {
  addContentBackground(slide);
  addText(slide, `COZEA  /  ${section.toUpperCase()}`, { left: M, top: 26, width: 500, height: 22 }, {
    fontSize: 13.33,
    bold: true,
    color: C.accent,
    name: "deck-section",
  });
}

function addFooter(slide, pageNumber, sourceText = "Sources: see notes") {
  addRule(slide, M, 676, W - 2 * M, C.rule, 1);
  addText(slide, sourceText, { left: M, top: 684, width: 1030, height: 20 }, {
    fontSize: 10.67,
    color: C.soft,
    name: "source-footer",
  });
  addText(slide, String(pageNumber).padStart(2, "0"), { left: 1178, top: 682, width: 38, height: 20 }, {
    fontSize: 12,
    bold: true,
    color: C.muted,
    alignment: "center",
    name: "page-number",
  });
}

function addSlideTitle(slide, title, subtitle = "", options = {}) {
  addText(slide, title, { left: M, top: options.top ?? 64, width: W - 2 * M, height: options.height ?? 62 }, {
    fontSize: options.fontSize ?? 44,
    bold: true,
    color: options.color ?? C.ink,
    lineSpacing: 0.96,
    autoFit: "shrinkText",
    name: "slide-title",
  });
  if (subtitle) {
    addText(slide, subtitle, { left: M, top: options.subtitleTop ?? 130, width: W - 2 * M, height: options.subtitleHeight ?? 54 }, {
      fontSize: options.subtitleSize ?? 21.33,
      color: options.subtitleColor ?? C.muted,
      lineSpacing: 1.08,
      name: "slide-subtitle",
    });
  }
}

function addMetric(slide, value, label, position, options = {}) {
  if (options.panel) addShape(slide, position, options.panelFill ?? C.panel, options.panelLine ?? C.rule, "roundRect", "rounded-xl");
  addText(slide, value, { left: position.left + (options.panel ? 24 : 0), top: position.top + (options.panel ? 22 : 0), width: position.width - (options.panel ? 48 : 0), height: options.valueHeight ?? 90 }, {
    fontSize: options.valueSize ?? 58,
    bold: true,
    color: options.valueColor ?? C.ink,
    verticalAlignment: "bottom",
  });
  addText(slide, label, { left: position.left + (options.panel ? 24 : 0), top: position.top + (options.panel ? 118 : 96), width: position.width - (options.panel ? 48 : 0), height: position.height - (options.panel ? 142 : 96) }, {
    fontSize: options.labelSize ?? 20,
    color: options.labelColor ?? C.muted,
    lineSpacing: 1.1,
  });
}

function addColumnHeading(slide, number, title, body, left, width, top = 250) {
  addText(slide, number, { left, top: top - 46, width: 60, height: 30 }, {
    fontSize: 16,
    bold: true,
    color: C.blue,
  });
  addText(slide, title, { left, top, width, height: 54 }, {
    fontSize: 30,
    bold: true,
    lineSpacing: 0.98,
  });
  addText(slide, body, { left, top: top + 76, width, height: 188 }, {
    fontSize: 20,
    color: C.muted,
    lineSpacing: 1.12,
  });
}

async function build() {
  await fs.mkdir(RENDER_DIR, { recursive: true });
  const [
    logo,
    heroApp,
    featureDevApps,
    featureProviders,
    featureMultiAgent,
    featureWorkspace,
    featureCollaboration,
    heroBg,
    metallicHero,
    metallicContent,
  ] = await Promise.all([
    imageBytes("cozea-logo.png"),
    imageBytes("hero-app.png"),
    imageBytes("feature-devapps.png"),
    imageBytes("feature-providers.jpeg"),
    imageBytes("feature-multi-agent.png"),
    imageBytes("feature-workspace.png"),
    imageBytes("feature-collaboration.png"),
    imageBytes("hero-bg.jpg"),
    imageBytes("metallic-hero.png"),
    imageBytes("metallic-content.png"),
  ]);

  metallicContentBackground = metallicContent;

  const presentation = Presentation.create({ slideSize: { width: W, height: H } });

  // 01 — Cover
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.dark;
    slide.images.add({ blob: metallicHero, contentType: "image/png", alt: "Brushed titanium ribbons on a graphite background", fit: "cover", position: { left: 0, top: 0, width: W, height: H } });
    addShape(slide, { left: 0, top: 0, width: W, height: H }, "#03050928", "none");
    addShape(slide, { left: 56, top: 42, width: 52, height: 52 }, C.silver, C.chrome, "roundRect", "rounded-xl");
    slide.images.add({ blob: logo, contentType: "image/png", alt: "Cozea logo", fit: "contain", position: { left: 64, top: 50, width: 36, height: 36 }, geometry: "rect" });
    addText(slide, "COZEA", { left: 124, top: 56, width: 180, height: 30 }, { fontSize: 20, bold: true, color: C.white });
    addRule(slide, 58, 132, 112, C.chrome, 2);
    addRule(slide, 170, 132, 34, C.blue, 2);
    addText(slide, "The multiplayer operating system\nfor agentic software teams", { left: 58, top: 168, width: 738, height: 188 }, {
      fontSize: 60,
      bold: true,
      lineSpacing: 0.92,
      color: C.white,
      name: "cover-title",
    });
    addText(slide, "Provider-neutral orchestration, programmable workflows, and real-time team collaboration in one desktop workbench.", { left: 62, top: 392, width: 690, height: 98 }, {
      fontSize: 24,
      color: C.muted,
      lineSpacing: 1.1,
    });
    addText(slide, "INVESTOR READ DECK  ·  AUGUST 2026", { left: 62, top: 622, width: 460, height: 30 }, { fontSize: 14, bold: true, color: C.accent });
    addText(slide, "cozea.app", { left: 1010, top: 622, width: 200, height: 30 }, { fontSize: 16, bold: true, color: C.white, alignment: "right" });
    addNotes(slide, [
      "https://cozea.app/ — product positioning and brand asset.",
      "https://cozea.app/cozea_logo_v4.png — authentic Cozea brand mark.",
      "AI-generated brushed titanium background created for this deck; prompt recorded in the project design notes.",
    ], "The cover language is a strategic positioning synthesis, not a direct quotation.");
  }

  // 02 — Problem
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, "Problem");
    addSlideTitle(slide, "Coding agents changed execution; team coordination did not", "Agent capability is compounding, while the surrounding workflow remains fragmented across people, tools, and model vendors.");
    addRule(slide, 638, 210, 1, C.rule, 390);
    addText(slide, "TODAY'S TOOLS", { left: 72, top: 218, width: 230, height: 28 }, { fontSize: 14, bold: true, color: C.muted });
    addText(slide, "Optimize a developer–agent loop", { left: 72, top: 258, width: 500, height: 72 }, { fontSize: 34, bold: true, lineSpacing: 0.98 });
    addBulletList(slide, [
      "One IDE, terminal, or model surface at a time",
      "Parallel agents create more branches, diffs, and state to supervise",
      "Team context still moves through meetings, chat, tickets, and screenshots",
    ], { left: 72, top: 360, width: 500, height: 210 }, { fontSize: 20 });
    addText(slide, "THE NEW REQUIREMENT", { left: 704, top: 218, width: 260, height: 28 }, { fontSize: 14, bold: true, color: C.blue });
    addText(slide, "Coordinate an entire software team", { left: 704, top: 258, width: 500, height: 72 }, { fontSize: 34, bold: true, lineSpacing: 0.98 });
    addBulletList(slide, [
      "Multiple humans and multiple agents operating at once",
      "Shared visibility into files, terminals, previews, changes, and decisions",
      "A common workspace that survives provider and workflow changes",
    ], { left: 704, top: 360, width: 500, height: 210 }, { fontSize: 20 });
    addFooter(slide, 2, "Sources: OpenAI Codex app; Cozea product site. Full links in notes.");
    addNotes(slide, [
      "https://openai.com/index/introducing-the-codex-app/ — describes the shift from single-agent edits to supervising coordinated teams of agents.",
      "https://cozea.app/ — positions Cozea around multi-agent and team collaboration.",
    ], "Problem framing is a synthesis across the current product category and Cozea's stated product thesis.");
  }

  // 03 — Orchestration bottleneck diagram
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, "Category");
    addSlideTitle(slide, "The next bottleneck is coordinating humans, agents, and tools", "Cozea sits at the intersection, turning fragmented execution into a shared operating context.", { fontSize: 38 });

    // Connectors first so they remain behind nodes.
    addShape(slide, { left: 332, top: 394, width: 194, height: 0 }, "none", C.rule, "straightConnector1");
    addShape(slide, { left: 754, top: 394, width: 194, height: 0 }, "none", C.rule, "straightConnector1");
    addShape(slide, { left: 640, top: 278, width: 0, height: 62 }, "none", C.rule, "straightConnector1");

    addShape(slide, { left: 502, top: 330, width: 276, height: 130 }, C.panel2, C.chrome, "roundRect", "rounded-xl");
    addText(slide, "COZEA", { left: 534, top: 355, width: 212, height: 36 }, { fontSize: 27, bold: true, color: C.white, alignment: "center" });
    addText(slide, "Shared control plane", { left: 534, top: 399, width: 212, height: 28 }, { fontSize: 17, color: C.accent, alignment: "center" });

    addShape(slide, { left: 78, top: 322, width: 254, height: 150 }, C.panel, C.rule, "roundRect", "rounded-xl");
    addText(slide, "Human team", { left: 104, top: 350, width: 202, height: 38 }, { fontSize: 28, bold: true });
    addText(slide, "Developers, designers, operators, and reviewers share the same project state.", { left: 104, top: 404, width: 202, height: 70 }, { fontSize: 18, color: C.muted });

    addShape(slide, { left: 948, top: 322, width: 254, height: 150 }, C.panel, C.rule, "roundRect", "rounded-xl");
    addText(slide, "Agent fleet", { left: 974, top: 350, width: 202, height: 38 }, { fontSize: 28, bold: true });
    addText(slide, "Codex, Cursor, Claude, OpenCode, and future providers run side by side.", { left: 974, top: 404, width: 202, height: 70 }, { fontSize: 18, color: C.muted });

    addShape(slide, { left: 514, top: 192, width: 252, height: 90 }, C.panel, C.rule, "roundRect", "rounded-xl");
    addText(slide, "Delivery stack", { left: 540, top: 211, width: 200, height: 34 }, { fontSize: 26, bold: true, alignment: "center" });
    addText(slide, "Code · terminals · previews · integrations", { left: 528, top: 250, width: 224, height: 24 }, { fontSize: 16, color: C.muted, alignment: "center" });

    addText(slide, "The category opportunity is the coordination layer—not another model endpoint.", { left: 252, top: 525, width: 776, height: 46 }, { fontSize: 25, bold: true, alignment: "center" });
    addText(slide, "The control plane gains value as the number of people, agents, and connected workflows increases.", { left: 270, top: 582, width: 740, height: 42 }, { fontSize: 18, color: C.muted, alignment: "center" });
    addFooter(slide, 3);
    addNotes(slide, [
      "https://cozea.app/ — provider support, multi-agent, workspace, collaboration, and integrations.",
      "Local AGENTS.md and src/features/devapps/registry/index.ts — implementation evidence for providers and workbench surfaces.",
    ], "This is a conceptual category diagram and does not represent market share or current customer usage.");
  }

  // 04 — Market validation
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, "Timing");
    addSlideTitle(slide, "Demand for agentic development is already proven", "The opportunity is not to prove that developers want coding agents; it is to own the team workflow that forms around them.");
    addMetric(slide, ">1M", "developers used Codex in the prior month when OpenAI introduced its desktop multi-agent app in February 2026.", { left: 56, top: 286, width: 360, height: 280 }, { panel: true, valueColor: C.blue });
    addMetric(slide, "$1B", "run-rate revenue reported for Claude Code in November 2025, six months after public availability.", { left: 452, top: 286, width: 360, height: 280 }, { panel: true, valueColor: C.ink });
    addMetric(slide, "$40", "per user per month for Cursor's Standard Teams seat in 2026—evidence of willingness to pay for team-grade developer tooling.", { left: 848, top: 286, width: 360, height: 280 }, { panel: true, valueColor: C.ink });
    addText(slide, "Category signal", { left: 56, top: 590, width: 160, height: 28 }, { fontSize: 16, bold: true, color: C.blue });
    addText(slide, "Agent capability, usage, and spend are scaling faster than the collaborative operating model around them.", { left: 210, top: 586, width: 990, height: 38 }, { fontSize: 20, bold: true });
    addFooter(slide, 4, "OpenAI, Anthropic, and Cursor sources; full links in notes.");
    addNotes(slide, [
      "https://openai.com/index/introducing-the-codex-app/ — more than one million developers used Codex in the preceding month.",
      "https://www.anthropic.com/news/anthropic-acquires-bun-as-claude-code-reaches-usd1b-milestone — Claude Code $1B run-rate revenue statement.",
      "https://prod.cursor.com/docs/account/teams/pricing — $40/month Standard Teams seat.",
    ], "These are category-validation metrics from provider companies; they are not Cozea traction metrics.");
  }

  // 05 — Product hero
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, "Product");
    addSlideTitle(slide, "One repo becomes a shared, agent-native workbench", "Files, assistants, terminals, browser previews, mobile simulation, diffs, and custom DevApps live in one persistent, dockable workspace.", { fontSize: 40 });
    addImage(slide, heroApp, "image/png", "Cozea multi-pane workbench with several assistant sessions and a live project preview", { left: 66, top: 210, width: 1148, height: 408 }, { fit: "contain", backing: true, backingLine: C.rule, radius: "rounded-xl" });
    addText(slide, "One project state. Multiple people. Multiple agents. One place to supervise the work.", { left: 98, top: 632, width: 1084, height: 28 }, { fontSize: 17, bold: true, alignment: "center" });
    addFooter(slide, 5, "Product image: Cozea website. Feature descriptions verified against the local application repository.");
    addNotes(slide, [
      "https://cozea.app/hero-img-solid.png — product screenshot.",
      "https://cozea.app/ and local AGENTS.md — product description.",
    ]);
  }

  // 06 — Workflow
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, "Workflow");
    addSlideTitle(slide, "One loop carries a team from workspace setup to launch", "Cozea removes handoff friction by keeping context and tools inside the same project environment.", { fontSize: 38 });
    addRule(slide, 88, 338, 1104, C.ink, 2);
    const xs = [88, 366, 644, 922];
    xs.forEach((x) => addShape(slide, { left: x, top: 331, width: 16, height: 16 }, C.ink, "none", "ellipse"));
    addColumnHeading(slide, "01", "Build workspace", "Start from a local or new project, then compose the layout with assistants, editor, terminal, browser, dev server, and other DevApps.", 88, 236, 390);
    addColumnHeading(slide, "02", "Invite team", "Bring collaborators into the project so the team shares current files, presence, decisions, and changes instead of relaying state manually.", 366, 236, 390);
    addColumnHeading(slide, "03", "Vibe together", "Run multiple provider agents in parallel while teammates inspect previews, review diffs, and coordinate the next action in the same workspace.", 644, 236, 390);
    addColumnHeading(slide, "04", "Launch project", "Use integrated dev tools and connected services to validate, package, and ship without rebuilding context in another environment.", 922, 236, 390);
    addFooter(slide, 6, "Source: Cozea website's four-step workflow; expanded with application repository evidence.");
    addNotes(slide, [
      "https://cozea.app/ — Build Workspace, Invite Team, Vibe Together, Launch Project sequence.",
      "Local AGENTS.md — project creation and workbench lifecycle.",
    ], "Expanded descriptions paraphrase the product workflow rather than quoting the website verbatim.");
  }

  // 07 — Product systems
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, "Product system");
    addSlideTitle(slide, "Four systems make the workspace more valuable over time", "The product is designed as an operating environment, not a single chat or code-completion feature.", { fontSize: 38 });
    addImage(slide, featureWorkspace, "image/png", "Cozea customized workspace with browser and terminal tiles", { left: 58, top: 230, width: 610, height: 344 }, { fit: "cover", backing: true, radius: "rounded-xl" });
    const rows = [226, 326, 426, 526];
    const labels = [
      ["01", "Composable workbench", "Persistent, dockable tiles let every team shape its own workflow."],
      ["02", "Provider layer", "Codex, Claude, Cursor, and OpenCode run through one assistant surface."],
      ["03", "Collaboration substrate", "Real-time shared state and encrypted updates keep the team synchronized."],
      ["04", "DevApp platform", "Any app can be published into the organization catalog and launched from the shared workbench."],
    ];
    labels.forEach(([n, title, body], index) => {
      const y = rows[index];
      addText(slide, n, { left: 724, top: y + 4, width: 38, height: 24 }, { fontSize: 14, bold: true, color: C.blue });
      addText(slide, title, { left: 778, top: y, width: 420, height: 32 }, { fontSize: 25, bold: true });
      addText(slide, body, { left: 778, top: y + 40, width: 420, height: 46 }, { fontSize: 18, color: C.muted });
      if (index < 3) addRule(slide, 724, y + 92, 474, C.rule, 1);
    });
    addFooter(slide, 7);
    addNotes(slide, [
      "https://cozea.app/features/img_8.png — product image.",
      "https://cozea.app/ — workspace, providers, collaboration, and DevApps product pillars.",
      "Local src/features/devapps/registry/index.ts and AGENTS.md — implementation evidence.",
      "Founder-provided product update, 2026-08-26 — organization-wide DevApp publication and launch scope.",
    ]);
  }

  // 08 — Multi-provider
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, "Provider strategy");
    addSlideTitle(slide, "Provider-neutral orchestration removes model lock-in", "Teams can use the best agent for each job while Cozea owns the durable workspace, shared context, and supervision layer.");
    addImage(slide, featureMultiAgent, "image/png", "Cozea multi-agent workspace with multiple assistant sessions", { left: 58, top: 224, width: 650, height: 366 }, { fit: "cover", backing: true, radius: "rounded-xl" });
    addText(slide, "BUILT-IN PROVIDERS", { left: 766, top: 222, width: 220, height: 28 }, { fontSize: 14, bold: true, color: C.muted });
    const providers = [
      ["Codex", "OpenAI coding-agent workflows"],
      ["Claude", "Anthropic planning and implementation"],
      ["Cursor", "Cursor sessions inside the shared workbench"],
      ["OpenCode", "Open-source provider surface"],
    ];
    providers.forEach(([name, desc], index) => {
      const y = 270 + index * 78;
      addText(slide, name, { left: 766, top: y, width: 152, height: 34 }, { fontSize: 27, bold: true });
      addText(slide, desc, { left: 932, top: y + 4, width: 280, height: 48 }, { fontSize: 18, color: C.muted });
      if (index < 3) addRule(slide, 766, y + 60, 446, C.rule, 1);
    });
    addText(slide, "Strategic implication", { left: 766, top: 592, width: 190, height: 26 }, { fontSize: 16, bold: true, color: C.blue });
    addText(slide, "Cozea can benefit from model progress regardless of which vendor leads a given task category.", { left: 946, top: 588, width: 266, height: 60 }, { fontSize: 18, bold: true });
    addFooter(slide, 8);
    addNotes(slide, [
      "https://cozea.app/features/img_6.png — product image.",
      "Local src/features/devapps/apps/codex/manifest.ts, claude/manifest.ts, cursor/manifest.ts, opencode/manifest.ts — built-in provider surfaces.",
      "https://cozea.app/terms — users connect their own third-party provider accounts; Cozea does not provide a proprietary foundation model.",
    ]);
  }

  // 09 — Collaboration
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, "Collaboration");
    addSlideTitle(slide, "Human collaboration is built into the coding loop", "Instead of screen sharing or relaying state through chat, teammates operate against the same evolving project context.");
    addImage(slide, featureCollaboration, "image/png", "Cozea share-project dialog and two collaborator assistant tiles", { left: 58, top: 222, width: 644, height: 362 }, { fit: "cover", backing: true, radius: "rounded-xl" });
    addText(slide, "Shared by default", { left: 760, top: 232, width: 426, height: 40 }, { fontSize: 30, bold: true });
    addBulletList(slide, [
      { label: "Live state — ", text: "files, presence, and updates stay synchronized through Yjs collaboration." },
      { label: "Encrypted content — ", text: "websocket updates, snapshots, and awareness payloads are encrypted before server persistence." },
      { label: "Reviewable change — ", text: "assistant-proposed changes surface as diffs for human approval before disk writes." },
      { label: "Branch-aware work — ", text: "shared collaboration and local work remain distinct operating contexts." },
    ], { left: 760, top: 300, width: 446, height: 274 }, { fontSize: 18, spaceAfter: 13 });
    addText(slide, "Why it matters", { left: 760, top: 594, width: 130, height: 28 }, { fontSize: 16, bold: true, color: C.blue });
    addText(slide, "Collaboration becomes part of the product architecture, not a meeting layered over individual tools.", { left: 900, top: 590, width: 306, height: 58 }, { fontSize: 18, bold: true });
    addFooter(slide, 9);
    addNotes(slide, [
      "https://cozea.app/features/img_9.png — product image.",
      "Local docs/collaboration-encryption-architecture.md — implemented encrypted collaboration slice and threat model.",
      "Local AGENTS.md — Yjs CRDT collaboration and diff approval flow.",
    ], "Security claims are limited to the implemented collaboration transport/persistence slice described in the repository; no broader compliance certification is claimed.");
  }

  // 10 — DevApps
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, "DevApp distribution");
    addSlideTitle(slide, "Every internal app can become an organization-wide DevApp", "Build it inside or outside Cozea. Publish it once. Let the entire organization launch it from the same shared workbench.", { fontSize: 38 });
    addImage(slide, featureDevApps, "image/png", "Cozea DevApp launcher and Store entry point inside the shared workbench", { left: 58, top: 222, width: 620, height: 350 }, { fit: "cover", backing: true, radius: "rounded-xl" });
    const devAppSteps = [
      ["01", "Build anywhere", "Start with a Cozea project or bring an existing web app built elsewhere."],
      ["02", "Publish once", "Give the app a durable identity, release, permissions, and launch configuration."],
      ["03", "Launch across the organization", "Teammates discover it in the shared catalog and open it inside their own Cozea workbench."],
    ];
    devAppSteps.forEach(([n, title, body], index) => {
      const y = 224 + index * 112;
      addText(slide, n, { left: 738, top: y + 4, width: 42, height: 24 }, { fontSize: 14, bold: true, color: C.blue });
      addText(slide, title, { left: 794, top: y, width: 406, height: 34 }, { fontSize: 25, bold: true });
      addText(slide, body, { left: 794, top: y + 40, width: 406, height: 54 }, { fontSize: 18, color: C.muted, lineSpacing: 1.04 });
      if (index < 2) addRule(slide, 738, y + 102, 462, C.rule, 1);
    });
    addRule(slide, 58, 602, 1142, C.rule, 1);
    addText(slide, "Strategic implication", { left: 58, top: 618, width: 170, height: 24 }, { fontSize: 15, bold: true, color: C.blue });
    addText(slide, "Cozea becomes the distribution surface for internal software—not only the place where teams build it.", { left: 236, top: 612, width: 964, height: 38 }, { fontSize: 20, bold: true });
    addFooter(slide, 10, "Latest product scope supplied by the founder; app interface shown from Cozea.");
    addNotes(slide, [
      "https://cozea.app/features/img_4.png — product image.",
      "https://cozea.app/docs — DevApps overview, built-ins, selection bridge, and manifest model.",
      "Founder-provided product update, 2026-08-26 — the latest app can publish DevApps built inside or outside Cozea for organization-wide discovery and launch.",
      "Local docs/project-devapps.md and src/features/devapps/ — publication identity, versioned releases, Store discovery, launch recipes, and workbench mounting are visible implementation foundations.",
    ], "The organization-wide scope is a founder-provided latest-product update that is not yet described on the public website. The checked-in branch still documents the earlier machine-local precursor, so the founder statement is the authoritative source for the current shipping scope presented here.");
  }

  // 11 — Competitive landscape
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, "Competition");
    addSlideTitle(slide, "Cozea is a control plane, not another coding model", "Cursor, Codex, and Claude Code validate agentic development; Cozea differentiates by coordinating multiple providers and multiple teammates in a shared programmable workspace.");
    const x = [58, 238, 520, 748, 1000, 1220];
    const top = 226;
    const rowH = 90;
    const headers = ["Product", "Primary promise", "Provider posture", "Team collaboration", "Extensibility"];
    headers.forEach((h, i) => addText(slide, h, { left: x[i] + 8, top, width: x[i + 1] - x[i] - 16, height: 36 }, { fontSize: 16, bold: true, color: C.muted }));
    addRule(slide, 58, top + 46, 1162, C.ink, 2);
    const rows = [
      ["Cozea", "Team operating system for agentic software work", "Provider-neutral; hosts Codex, Claude, Cursor, OpenCode", "Live shared workbench and project context", "Organization-wide DevApps and workflow composition"],
      ["Cursor", "AI-native editor, cloud agents, and team administration", "Multi-model inside Cursor's product and pricing layer", "Team billing, analytics, shared context and cloud agents", "Rules, skills, plugins, SDK and marketplace"],
      ["Codex", "OpenAI command center for parallel coding agents", "OpenAI-first model and agent ecosystem", "Threads, worktrees, review, and handoff around agent tasks", "Skills and automations within Codex"],
      ["Claude Code", "Anthropic coding agent in terminal and IDE surfaces", "Anthropic-first; configurable enterprise gateways", "Agent teams, subagents, and developer-controlled sessions", "Hooks, MCP, SDK, and CLI workflows"],
    ];
    rows.forEach((row, r) => {
      const y = top + 54 + r * rowH;
      if (r === 0) addShape(slide, { left: 58, top: y - 2, width: 1162, height: rowH - 2 }, "#102B3D", C.blue2);
      row.forEach((cell, i) => addText(slide, cell, { left: x[i] + 8, top: y + 10, width: x[i + 1] - x[i] - 16, height: rowH - 20 }, {
        fontSize: i === 0 ? 19 : 16.5,
        bold: i === 0 || r === 0,
        color: i === 0 ? C.ink : (r === 0 ? C.ink : C.muted),
        lineSpacing: 1.06,
      }));
      addRule(slide, 58, y + rowH - 2, 1162, C.rule, 1);
    });
    [238, 520, 748, 1000].forEach((vx) => addRule(slide, vx, top, 1, C.rule, 414));
    addText(slide, "Positioning discipline", { left: 58, top: 640, width: 170, height: 24 }, { fontSize: 14, bold: true, color: C.blue });
    addText(slide, "Do not claim that incumbents lack agents, worktrees, teams, or extensions. Win on cross-provider human collaboration and workflow composition.", { left: 230, top: 636, width: 990, height: 32 }, { fontSize: 16.5, bold: true });
    addFooter(slide, 11, "Sources: official Cozea, Cursor, OpenAI, and Anthropic product pages. Comparison reflects primary product posture, not exhaustive parity.");
    addNotes(slide, [
      "https://cozea.app/ and https://cozea.app/docs — Cozea positioning and product surface.",
      "https://prod.cursor.com/docs/account/teams/pricing and https://cursor.com/en-US/business/teams — Cursor Teams, cloud agents, admin, and extensibility.",
      "https://openai.com/index/introducing-the-codex-app/ — Codex multi-agent app, worktrees, skills, and automations.",
      "https://docs.anthropic.com/en/docs/claude-code/getting-started and https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously — Claude Code surfaces, subagents, hooks, and background tasks.",
      "Founder-provided product update, 2026-08-26 — Cozea organization-wide DevApp distribution capability.",
    ], "This is a strategic comparison of primary product posture. It intentionally avoids absolute yes/no feature claims where products are evolving quickly.");
  }

  // 12 — Architecture/moat
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, "Defensibility");
    addSlideTitle(slide, "Architecture compounds into a durable advantage", "The defensible asset is the coordination system around models: state, permissions, adapters, workflows, and collaborative behavior.", { fontSize: 40 });
    const layers = [
      ["04", "Composable experience", "Dockable workbench, organization DevApp catalog, built-in and custom apps", C.dark, C.white],
      ["03", "Provider adaptation boundary", "Stable product behavior across Codex, Claude, Cursor, and OpenCode adapters", "#182332", C.white],
      ["02", "Local execution and control", "Project-scoped tools, terminal/runtime ownership, diff approvals, safe command constraints", "#132C3B", C.white],
      ["01", "Encrypted collaboration substrate", "Yjs real-time updates, wrapped device keys, encrypted snapshots and awareness", C.panel, C.white],
    ];
    layers.forEach(([n, title, body, fill, textColor], index) => {
      const y = 218 + index * 96;
      addShape(slide, { left: 78, top: y, width: 1124, height: 78 }, fill, "none", "rect");
      addText(slide, n, { left: 102, top: y + 22, width: 44, height: 30 }, { fontSize: 15, bold: true, color: textColor === C.white ? C.accent : C.blue });
      addText(slide, title, { left: 166, top: y + 17, width: 320, height: 36 }, { fontSize: 27, bold: true, color: textColor });
      addText(slide, body, { left: 510, top: y + 18, width: 652, height: 42 }, { fontSize: 18, color: textColor === C.white ? "#D0D5DD" : C.muted });
    });
    addText(slide, "What compounds", { left: 78, top: 622, width: 150, height: 24 }, { fontSize: 15, bold: true, color: C.blue });
    addText(slide, "Every provider added, team workflow encoded, and collaborative state transition strengthens the control plane without requiring Cozea to train a foundation model.", { left: 232, top: 616, width: 970, height: 44 }, { fontSize: 18, bold: true });
    addFooter(slide, 12);
    addNotes(slide, [
      "Local AGENTS.md — application stack and runtime architecture.",
      "Local docs/ai-behavior-contract.md — stable provider adaptation boundary and project-scoped tool rules.",
      "Local docs/collaboration-encryption-architecture.md — encrypted collaboration substrate.",
      "Local docs/project-devapps.md — composable DevApp layer and runtime safety.",
      "Founder-provided product update, 2026-08-26 — shared organization DevApp catalog scope.",
    ], "Defensibility is a strategic inference from the implemented architecture, not a claim of patent protection or proprietary foundation-model IP.");
  }

  // 13 — Business model
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, "Business model");
    addSlideTitle(slide, "Free core creates adoption; organizational controls create revenue", "The current site offers Free and Custom Enterprise. A paid team layer is the logical packaging experiment once retention is proven.", { fontSize: 35 });
    const cols = [56, 448, 840, 1224];
    [448, 840].forEach((vx) => addRule(slide, vx, 220, 1, C.rule, 382));

    addText(slide, "CURRENT", { left: 72, top: 226, width: 100, height: 24 }, { fontSize: 14, bold: true, color: C.blue });
    addText(slide, "Free core", { left: 72, top: 268, width: 320, height: 44 }, { fontSize: 31, bold: true });
    addText(slide, "$0 forever", { left: 72, top: 325, width: 260, height: 38 }, { fontSize: 25, bold: true });
    addBulletList(slide, ["Full desktop app", "Core collaboration", "All coding agents", "20+ integrations"], { left: 72, top: 392, width: 312, height: 170 }, { fontSize: 18 });
    addText(slide, "Goal: remove adoption friction and create workflow habit.", { left: 72, top: 574, width: 312, height: 52 }, { fontSize: 17, bold: true, color: C.muted });

    addText(slide, "RECOMMENDED TEST", { left: 466, top: 226, width: 170, height: 24 }, { fontSize: 14, bold: true, color: C.blue });
    addText(slide, "Team cloud", { left: 466, top: 268, width: 320, height: 44 }, { fontSize: 31, bold: true });
    addText(slide, "$30–40 / user / month", { left: 466, top: 325, width: 330, height: 38 }, { fontSize: 25, bold: true });
    addBulletList(slide, ["Managed team sync", "Shared workflow templates", "Usage and cost visibility", "Team permissions and support"], { left: 466, top: 392, width: 316, height: 170 }, { fontSize: 18 });
    addText(slide, "Goal: monetize the collaboration layer while preserving a generous free wedge.", { left: 466, top: 574, width: 316, height: 52 }, { fontSize: 17, bold: true, color: C.muted });

    addText(slide, "CURRENT / EXPAND", { left: 858, top: 226, width: 150, height: 24 }, { fontSize: 14, bold: true, color: C.blue });
    addText(slide, "Enterprise", { left: 858, top: 268, width: 320, height: 44 }, { fontSize: 31, bold: true });
    addText(slide, "Custom annual contract", { left: 858, top: 325, width: 330, height: 38 }, { fontSize: 25, bold: true });
    addBulletList(slide, ["SAML / OIDC and SCIM", "Organization-wide controls", "Private deployment", "Custom providers and rollout support"], { left: 858, top: 392, width: 316, height: 170 }, { fontSize: 18 });
    addText(slide, "Goal: high-ACV revenue tied to governance, deployment, and procurement requirements.", { left: 858, top: 574, width: 316, height: 52 }, { fontSize: 17, bold: true, color: C.muted });

    addFooter(slide, 13, "Current packaging sourced from cozea.app/pricing. Team-cloud pricing is a recommended test, not a current offer.");
    addNotes(slide, [
      "https://cozea.app/pricing — current Free and Custom Enterprise packaging and enterprise feature list.",
      "https://prod.cursor.com/docs/account/teams/pricing — external reference for current team-seat willingness to pay.",
    ], "The proposed Team cloud tier and $30–40 price range are strategic recommendations for testing after retention is established.");
  }

  // 14 — GTM
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, "Go-to-market");
    addSlideTitle(slide, "Start with high-agency teams, then expand through workflow gravity", "The winning motion is product-led adoption followed by founder-led conversion where collaboration and governance become critical.", { fontSize: 35 });
    addRule(slide, 90, 360, 1100, C.rule, 2);
    const stages = [
      ["01", "Wedge", "2–10 person AI-native startups, agencies, and product teams already mixing providers and tools."],
      ["02", "Land", "Free desktop product, open-source trust, local repo import, and ready-made agent/tool surfaces."],
      ["03", "Expand", "Organization DevApps, shared layouts, team workflows, and collaboration pull additional seats into the workspace."],
      ["04", "Monetize", "Convert teams needing managed sync, admin visibility, security controls, private deployment, and support."],
    ];
    stages.forEach(([n, title, body], i) => {
      const left = 84 + i * 282;
      addShape(slide, { left: left + 4, top: 350, width: 20, height: 20 }, i === 3 ? C.blue : C.ink, "none", "ellipse");
      addText(slide, n, { left, top: 230, width: 44, height: 24 }, { fontSize: 14, bold: true, color: C.blue });
      addText(slide, title, { left, top: 274, width: 240, height: 46 }, { fontSize: 30, bold: true });
      addText(slide, body, { left, top: 402, width: 240, height: 166 }, { fontSize: 18, color: C.muted, lineSpacing: 1.1 });
    });
    addText(slide, "Initial distribution loops", { left: 84, top: 592, width: 200, height: 26 }, { fontSize: 16, bold: true, color: C.blue });
    addText(slide, "Founder-led design partners  ·  Open-source/community content  ·  Workflow templates  ·  Provider ecosystem partnerships", { left: 294, top: 590, width: 896, height: 30 }, { fontSize: 18, bold: true });
    addFooter(slide, 14, "Proposed GTM strategy based on current Free/Enterprise packaging and Cozea's integration-first product design.");
    addNotes(slide, [
      "https://cozea.app/pricing — free adoption and enterprise packaging.",
      "https://cozea.app/integrations — integration-first product posture.",
      "https://cozea.app/privacy — AGPL and self-hosting posture.",
      "Founder-provided product update, 2026-08-26 — organization-wide DevApps as an expansion loop.",
    ], "This slide is a recommended go-to-market plan, not a statement of current pipeline or customer counts.");
  }

  // 15 — Market opportunity
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, "Opportunity");
    addSlideTitle(slide, "A focused developer wedge can support a venture-scale business", "Seat-based team revenue scales quickly even before adding enterprise platform fees or services. The scenarios below are illustrative, not forecasts.", { fontSize: 36 });
    slide.charts.add("bar", {
      position: { left: 70, top: 238, width: 730, height: 360 },
      categories: ["100K paid seats", "250K paid seats", "500K paid seats"],
      series: [{ name: "Illustrative ARR ($M)", values: [36, 90, 240], fill: C.blue }],
      barOptions: { direction: "bar", grouping: "clustered", gapWidth: 52 },
      hasLegend: false,
      xAxis: { visible: true, min: 0, max: 260, majorUnit: 50, title: { text: "Illustrative ARR ($M)", textStyle: { fontSize: 16, fill: C.muted } }, textStyle: { fill: C.muted, fontSize: 15 }, majorGridlines: { style: "solid", fill: C.rule, width: 1 }, line: { style: "solid", fill: C.rule, width: 1 } },
      yAxis: { visible: true, textStyle: { fill: C.ink, fontSize: 18 }, line: { style: "solid", fill: C.rule, width: 1 }, majorGridlines: null },
      dataLabels: { showValue: true, position: "outEnd", textStyle: { fill: C.ink, fontSize: 18, bold: true } },
      chartFill: C.dark,
      chartLine: { style: "solid", fill: C.dark, width: 0 },
      plotAreaFill: C.dark,
      plotAreaLine: { style: "solid", fill: C.dark, width: 0 },
    });
    addText(slide, "MODELED INPUTS", { left: 862, top: 246, width: 170, height: 24 }, { fontSize: 14, bold: true, color: C.muted });
    addText(slide, "$30", { left: 862, top: 292, width: 150, height: 60 }, { fontSize: 48, bold: true, color: C.blue });
    addText(slide, "monthly seat price for the first two scenarios", { left: 862, top: 354, width: 314, height: 52 }, { fontSize: 18, color: C.muted });
    addRule(slide, 862, 430, 314, C.rule, 1);
    addText(slide, "$40", { left: 862, top: 454, width: 150, height: 60 }, { fontSize: 48, bold: true });
    addText(slide, "monthly seat price for the 500K-seat scenario; equal to Cursor Standard Teams pricing", { left: 862, top: 516, width: 314, height: 70 }, { fontSize: 18, color: C.muted });
    addText(slide, "The strategic question is not whether developer spend exists—it is whether Cozea can earn a durable share by owning cross-provider team workflows.", { left: 70, top: 618, width: 1106, height: 38 }, { fontSize: 18, bold: true, alignment: "center" });
    addFooter(slide, 15, "Illustrative calculation: seats × monthly price × 12. Cursor $40 reference sourced from official 2026 pricing.");
    addNotes(slide, [
      "https://prod.cursor.com/docs/account/teams/pricing — $40/month Standard Teams seat reference.",
      "Calculation: 100K x $30 x 12 = $36M; 250K x $30 x 12 = $90M; 500K x $40 x 12 = $240M.",
    ], "These are illustrative revenue scenarios and are not management forecasts, current revenue, TAM estimates, or customer commitments.");
  }

  // 16 — Product stage
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, "Stage");
    addSlideTitle(slide, "The product is beyond concept; the round funds commercial proof", "Cozea already contains significant systems depth. The next valuation step comes from retained teams and repeatable paid demand.", { fontSize: 35 });
    addText(slide, "PRODUCT EVIDENCE", { left: 58, top: 224, width: 200, height: 24 }, { fontSize: 14, bold: true, color: C.muted });
    addMetric(slide, "8", "built-in DevApps across development and assistant workflows", { left: 58, top: 266, width: 250, height: 150 }, { valueSize: 54, valueColor: C.blue, labelSize: 18 });
    addMetric(slide, "4", "provider kinds supported in the local assistant runtime", { left: 338, top: 266, width: 250, height: 150 }, { valueSize: 54, labelSize: 18 });
    addMetric(slide, "E2E", "encrypted collaboration updates, snapshots, and awareness payloads", { left: 58, top: 446, width: 250, height: 150 }, { valueSize: 46, labelSize: 18 });
    addMetric(slide, "AGPL", "open-source software and self-hosting posture", { left: 338, top: 446, width: 250, height: 150 }, { valueSize: 46, labelSize: 18 });
    addRule(slide, 646, 224, 1, C.rule, 400);
    addText(slide, "WHAT THE ROUND MUST PROVE", { left: 704, top: 224, width: 270, height: 24 }, { fontSize: 14, bold: true, color: C.blue });
    addBulletList(slide, [
      { label: "Retention — ", text: "teams return weekly because shared workflows and project context compound." },
      { label: "Organization pull — ", text: "one useful DevApp or workflow reliably brings additional teammates into Cozea." },
      { label: "Willingness to pay — ", text: "managed collaboration, visibility, and governance convert to paid accounts." },
      { label: "Distribution — ", text: "repeatable channels acquire teams without founder-only effort." },
      { label: "Enterprise readiness — ", text: "security, identity, deployment, and support requirements are productized." },
    ], { left: 704, top: 280, width: 492, height: 300 }, { fontSize: 19, spaceAfter: 15 });
    addText(slide, "Investor implication", { left: 704, top: 594, width: 156, height: 24 }, { fontSize: 15, bold: true, color: C.blue });
    addText(slide, "Features justify attention; commercial evidence earns the next round.", { left: 862, top: 590, width: 334, height: 42 }, { fontSize: 19, bold: true });
    addFooter(slide, 16, "Product evidence: website, app repository, and founder-provided latest DevApp scope; no user or revenue metrics asserted.");
    addNotes(slide, [
      "Local src/features/devapps/registry/index.ts — eight built-in DevApps.",
      "Local AGENTS.md — four provider kinds and product/runtime architecture.",
      "Local docs/collaboration-encryption-architecture.md — implemented encrypted collaboration slice.",
      "https://cozea.app/privacy — AGPL and self-hosting posture.",
      "Founder-provided product update, 2026-08-26 — organization-wide DevApp distribution and launch.",
    ], "No current usage, retention, revenue, or customer figures were supplied, so this slide uses product evidence and defines the commercial proofs required from the round.");
  }

  // 17 — Round recommendation
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, "Financing");
    addSlideTitle(slide, "$1M for 10% funds the proof that unlocks the next round", "A deliberately focused first round keeps the team lean while converting product depth into retention, paid adoption, and repeatable team expansion.", { fontSize: 36 });

    addShape(slide, { left: 56, top: 220, width: 540, height: 330 }, C.panel, C.chrome, "roundRect", "rounded-xl");
    addText(slide, "THE ASK", { left: 88, top: 248, width: 120, height: 26 }, { fontSize: 14, bold: true, color: C.accent });
    addText(slide, "$1M", { left: 84, top: 290, width: 240, height: 108 }, { fontSize: 82, bold: true, color: C.blue, verticalAlignment: "bottom" });
    addText(slide, "FOR", { left: 344, top: 338, width: 70, height: 36 }, { fontSize: 18, bold: true, color: C.soft, alignment: "center" });
    addText(slide, "10%", { left: 418, top: 290, width: 150, height: 108 }, { fontSize: 70, bold: true, color: C.white, verticalAlignment: "bottom", alignment: "right" });
    addRule(slide, 88, 426, 450, C.rule, 1);
    addText(slide, "$10M post-money equivalent", { left: 88, top: 454, width: 310, height: 32 }, { fontSize: 24, bold: true });
    addText(slide, "Simple ownership economics; final instrument and closing mechanics should be set with counsel.", { left: 88, top: 494, width: 430, height: 48 }, { fontSize: 16, color: C.muted, lineSpacing: 1.08 });

    addText(slide, "WHAT THIS ROUND MUST PROVE", { left: 654, top: 232, width: 330, height: 28 }, { fontSize: 14, bold: true, color: C.blue });
    addBulletList(slide, [
      { label: "Retention — ", text: "teams return because shared workflows and project context compound week after week." },
      { label: "Paid adoption — ", text: "managed collaboration, visibility, and governance convert into recurring revenue." },
      { label: "Expansion — ", text: "one activated user reliably pulls teammates and additional workflows into Cozea." },
    ], { left: 654, top: 286, width: 550, height: 196 }, { fontSize: 20, spaceAfter: 18 });
    addRule(slide, 654, 506, 550, C.rule, 1);
    addText(slide, "15–18 mo.", { left: 654, top: 532, width: 152, height: 34 }, { fontSize: 24, bold: true, color: C.white });
    addText(slide, "proof window", { left: 654, top: 568, width: 152, height: 26 }, { fontSize: 14, color: C.muted });
    addText(slide, "Lean team", { left: 838, top: 532, width: 152, height: 34 }, { fontSize: 24, bold: true, color: C.white });
    addText(slide, "disciplined hiring", { left: 838, top: 568, width: 152, height: 26 }, { fontSize: 14, color: C.muted });
    addText(slide, "3 proofs", { left: 1022, top: 532, width: 182, height: 34 }, { fontSize: 24, bold: true, color: C.white });
    addText(slide, "retention · paid · expansion", { left: 1022, top: 568, width: 182, height: 36 }, { fontSize: 13, color: C.muted });
    addFooter(slide, 17, "Proposed first-round economics: $1M for 10%. Final structure should be reviewed with startup counsel.");
    addNotes(slide, [
      "https://carta.com/data/state-of-pre-seed-q2-2026/ — Q2 2026 pre-seed volume, average instrument size, AI share, and observation that few pre-seed deals exceed $2.5M.",
      "https://carta.com/uk/en/data/safe-valuation-caps-q2-2026/ — SAFE dominance, post-money SAFE usage, and rising caps.",
      "https://www.ycombinator.com/deal/ — familiar early-stage dilution reference.",
      "Calculation: $1M / 10% ownership = $10M post-money equivalent and $9M pre-money equivalent.",
    ], "This is a founder-selected financing ask based on incomplete company metrics. Final terms should be set with legal, tax, and financing counsel and adjusted to verified traction, team burn, and investor demand.");
  }

  // 18 — Use of funds
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, "Use of funds");
    addSlideTitle(slide, "The round creates a 15–18 month commercial proof window", "Capital stays concentrated on retention, collaboration reliability, and the shortest path from free use to paid organizational value.", { fontSize: 38 });
    const uses = [
      ["45%", "$450K", "Product + infrastructure", "Collaboration reliability, provider adapters, workbench polish, performance, and cross-platform readiness."],
      ["30%", "$300K", "Distribution + success", "Design partners, onboarding, content/community, customer success, and founder-led sales instrumentation."],
      ["15%", "$150K", "Enterprise readiness", "Identity, admin controls, security review, private deployment, auditability, and procurement requirements."],
      ["10%", "$100K", "Operations + reserve", "Legal, finance, tooling, contingencies, and a buffer against a forced raise."],
    ];
    uses.forEach(([pct, amount, title, body], i) => {
      const left = 56 + i * 292;
      if (i > 0) addRule(slide, left - 22, 226, 1, C.rule, 272);
      addText(slide, pct, { left, top: 226, width: 150, height: 64 }, { fontSize: 50, bold: true, color: i === 0 ? C.blue : C.ink });
      addText(slide, amount, { left, top: 294, width: 180, height: 32 }, { fontSize: 20, bold: true, color: C.muted });
      addText(slide, title, { left, top: 350, width: 244, height: 54 }, { fontSize: 25, bold: true, lineSpacing: 0.98 });
      addText(slide, body, { left, top: 418, width: 244, height: 88 }, { fontSize: 17, color: C.muted, lineSpacing: 1.1 });
    });
    addShape(slide, { left: 56, top: 536, width: 1168, height: 108 }, C.panel, "none", "rect");
    addText(slide, "MILESTONES TO TARGET BY THE NEXT ROUND", { left: 80, top: 554, width: 390, height: 24 }, { fontSize: 14, bold: true, color: C.blue });
    addText(slide, "20–30 design-partner teams", { left: 80, top: 592, width: 250, height: 30 }, { fontSize: 20, bold: true });
    addText(slide, "10–15 paying organizations", { left: 350, top: 592, width: 250, height: 30 }, { fontSize: 20, bold: true });
    addText(slide, "Strong 8-week team retention", { left: 620, top: 592, width: 250, height: 30 }, { fontSize: 20, bold: true });
    addText(slide, "Repeatable acquisition + expansion", { left: 890, top: 592, width: 286, height: 30 }, { fontSize: 20, bold: true });
    addFooter(slide, 18, "Illustrative allocation and milestone plan for a $1M raise.");
    addNotes(slide, [
      "Internal recommendation and arithmetic: 45%/30%/15%/10% of $1M.",
      "Local AGENTS.md and product docs — product, security, collaboration, and enterprise work areas informing the allocation.",
    ], "Milestones are proposed operating targets, not current results or guaranteed outcomes. They should be updated after the founders confirm baseline metrics, headcount, salaries, and infrastructure spend.");
  }

  // 19 — Risks
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, "Risks");
    addSlideTitle(slide, "The key risks are real—and testable in this round", "A credible investor case should show how Cozea will learn faster than incumbents can close the gap.", { fontSize: 40 });
    const cols = [56, 300, 590, 884, 1224];
    const headers = ["Risk", "Why it matters", "Mitigation", "Proof required by next round"];
    headers.forEach((h, i) => addText(slide, h, { left: cols[i] + 8, top: 222, width: cols[i + 1] - cols[i] - 16, height: 30 }, { fontSize: 16, bold: true, color: C.muted }));
    addRule(slide, 56, 264, 1168, C.ink, 2);
    const risks = [
      ["Platform encroachment", "Cursor, OpenAI, and Anthropic are rapidly adding agents, teams, worktrees, and extensions.", "Stay provider-neutral and focus on live multi-human coordination plus programmable cross-tool workflows.", "Teams choose Cozea even when they already pay for a provider-native tool."],
      ["Open-source monetization", "AGPL and a free core can limit direct seat monetization if paid value is not distinct.", "Charge for managed collaboration, governance, deployment, visibility, and support—not access to local code.", "Free-to-paid conversion and clear enterprise willingness to pay."],
      ["Provider fragility", "CLI and SDK behavior can change, breaking adapters or creating support cost.", "Maintain a stable provider contract, version gates, runtime diagnostics, and multiple supported providers.", "Fast adapter recovery and low provider-related churn or support burden."],
      ["Security + onboarding", "Collaboration, local execution, and enterprise deployment raise trust and complexity requirements.", "Default-safe tool scopes, encrypted collaboration, clear device recovery, identity controls, and design-partner security reviews.", "Security review completion, low activation time, and reliable team onboarding."],
    ];
    risks.forEach((row, r) => {
      const y = 270 + r * 84;
      row.forEach((cell, i) => addText(slide, cell, { left: cols[i] + 8, top: y + 10, width: cols[i + 1] - cols[i] - 16, height: 68 }, {
        fontSize: i === 0 ? 18 : 15.8,
        bold: i === 0,
        color: i === 0 ? C.ink : C.muted,
        lineSpacing: 1.05,
      }));
      addRule(slide, 56, y + 82, 1168, C.rule, 1);
    });
    [300, 590, 884].forEach((vx) => addRule(slide, vx, 222, 1, C.rule, 384));
    addText(slide, "Fundraising message", { left: 56, top: 628, width: 180, height: 24 }, { fontSize: 14, bold: true, color: C.blue });
    addText(slide, "The round is sized to answer these risks with evidence before scaling burn.", { left: 242, top: 624, width: 982, height: 32 }, { fontSize: 19, bold: true });
    addFooter(slide, 19);
    addNotes(slide, [
      "Official Cursor, OpenAI Codex, and Anthropic Claude Code pages cited on slide 11 — incumbent product expansion.",
      "https://cozea.app/privacy and https://cozea.app/terms — AGPL, self-hosting, and provider posture.",
      "Local docs/ai-behavior-contract.md, docs/collaboration-encryption-architecture.md, and docs/project-devapps.md — mitigation evidence.",
    ], "Risks and mitigation priorities are strategic analysis based on the product and competitive landscape.");
  }

  // 20 — Team
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.white;
    addHeader(slide, "Team");
    addSlideTitle(slide, "A lean core team built systems depth before scaling headcount", "The first round should preserve hands-on founder speed while adding focused capacity around product reliability, adoption, and enterprise readiness.", { fontSize: 35 });
    addText(slide, "ERICK XU", { left: 70, top: 236, width: 360, height: 52 }, { fontSize: 36, bold: true });
    addText(slide, "Founder & CEO", { left: 70, top: 294, width: 300, height: 32 }, { fontSize: 22, bold: true, color: C.blue });
    addText(slide, "Public founder contact for Cozea. Leads company direction, product strategy, and fundraising.", { left: 70, top: 348, width: 450, height: 90 }, { fontSize: 20, color: C.muted, lineSpacing: 1.12 });
    addRule(slide, 610, 228, 1, C.rule, 250);
    addText(slide, "KELYAN EDOU ENGONE", { left: 674, top: 236, width: 470, height: 52 }, { fontSize: 36, bold: true });
    addText(slide, "Founding technical contributor", { left: 674, top: 294, width: 420, height: 32 }, { fontSize: 22, bold: true, color: C.blue });
    addText(slide, "Largest repository contributor by commit count; hands-on engineering across the desktop product and supporting systems.", { left: 674, top: 348, width: 474, height: 90 }, { fontSize: 20, color: C.muted, lineSpacing: 1.12 });

    addShape(slide, { left: 70, top: 506, width: 1078, height: 116 }, C.panel, "none", "rect");
    addText(slide, "FIRST HIRES AFTER THE ROUND", { left: 94, top: 526, width: 250, height: 24 }, { fontSize: 14, bold: true, color: C.blue });
    addText(slide, "Senior product / runtime engineer", { left: 94, top: 566, width: 302, height: 32 }, { fontSize: 21, bold: true });
    addText(slide, "Product-led growth + customer success", { left: 438, top: 566, width: 334, height: 32 }, { fontSize: 21, bold: true });
    addText(slide, "Enterprise security / platform capacity", { left: 814, top: 566, width: 306, height: 32 }, { fontSize: 21, bold: true });
    addFooter(slide, 20, "Founder name sourced from Cozea's public enterprise scheduling link. Repository contribution summary is local Git evidence.");
    addNotes(slide, [
      "https://cal.com/erick-xu/30min — public founder contact linked from Cozea's pricing page.",
      "https://www.linkedin.com/in/erickxuli — public profile identifies Erick Xu as a co-founder/CEO at RAMUSE, the operator named in Cozea's terms.",
      "Local git shortlog — Kelyan Edou Engone is the largest repository contributor by commit count; role wording is deliberately conservative.",
      "https://cozea.app/terms — Cozea is currently operated by Ramuse LLC.",
    ], "Final titles and biographies should be confirmed by the founders before external circulation. This deck avoids unsupported employment history or performance claims.");
  }

  // 21 — Close
  {
    const slide = presentation.slides.add();
    slide.background.fill = C.dark;
    slide.images.add({ blob: metallicHero, contentType: "image/png", alt: "Brushed titanium ribbons on a graphite background", fit: "cover", position: { left: 0, top: 0, width: W, height: H } });
    addShape(slide, { left: 0, top: 0, width: W, height: H }, "#03050938", "none");
    addShape(slide, { left: 56, top: 42, width: 52, height: 52 }, C.silver, C.chrome, "roundRect", "rounded-xl");
    slide.images.add({ blob: logo, contentType: "image/png", alt: "Cozea logo", fit: "contain", position: { left: 64, top: 50, width: 36, height: 36 }, geometry: "rect" });
    addText(slide, "COZEA", { left: 124, top: 56, width: 180, height: 30 }, { fontSize: 20, bold: true, color: C.white });
    addRule(slide, 58, 132, 112, C.chrome, 2);
    addRule(slide, 170, 132, 34, C.blue, 2);
    addText(slide, "Own the team layer in the\nagentic development stack", { left: 58, top: 176, width: 760, height: 150 }, { fontSize: 58, bold: true, color: C.white, lineSpacing: 0.94 });
    addText(slide, "Models will keep changing. Teams will still need one shared place to direct agents, compose workflows, review work, and ship together.", { left: 62, top: 368, width: 700, height: 104 }, { fontSize: 24, color: C.muted, lineSpacing: 1.12 });
    addText(slide, "THE ASK", { left: 62, top: 532, width: 120, height: 28 }, { fontSize: 14, bold: true, color: C.blue });
    addText(slide, "$1M  FOR  10%", { left: 62, top: 566, width: 520, height: 54 }, { fontSize: 38, bold: true, color: C.white });
    addText(slide, "15–18 month proof window", { left: 62, top: 624, width: 360, height: 28 }, { fontSize: 16, color: C.accent });
    addText(slide, "cozea.app", { left: 1000, top: 568, width: 200, height: 32 }, { fontSize: 20, bold: true, color: C.white, alignment: "right" });
    addText(slide, "contact@cozea.app", { left: 954, top: 610, width: 246, height: 28 }, { fontSize: 17, color: C.muted, alignment: "right" });
    addNotes(slide, [
      "https://cozea.app/ — closing product thesis and contact domain.",
      "https://cozea.app/contact — public contact email.",
      "Fundraising recommendation and calculations documented on slides 17–18.",
      "AI-generated brushed titanium background created for this deck; prompt recorded in the project design notes.",
    ], "Closing thesis is strategic positioning, not a claim of current market leadership.");
  }

  // Render every slide and a deck montage before exporting.
  for (const [index, slide] of presentation.slides.items.entries()) {
    const stem = `slide-${String(index + 1).padStart(2, "0")}`;
    const png = await presentation.export({ slide, format: "png", scale: 1.5 });
    await fs.writeFile(path.join(RENDER_DIR, `${stem}.png`), new Uint8Array(await png.arrayBuffer()));
    const layout = await slide.export({ format: "layout" });
    await fs.writeFile(path.join(RENDER_DIR, `${stem}.layout.json`), await layout.text());
  }
  const montage = await presentation.export({ format: "webp", montage: true, scale: 1 });
  await fs.writeFile(path.join(TMP_DIR, "cozea-deck-montage.webp"), new Uint8Array(await montage.arrayBuffer()));

  const inspection = await presentation.inspect({ kind: "slide,textbox,shape,image,chart,notes", maxChars: 60000 });
  await fs.writeFile(path.join(TMP_DIR, "deck-inspection.ndjson"), inspection.ndjson);

  const pptx = await PresentationFile.exportPptx(presentation);
  await pptx.save(FINAL_PPTX);
  console.log(`Created ${FINAL_PPTX}`);
  console.log(`Rendered ${presentation.slides.items.length} slides to ${RENDER_DIR}`);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
