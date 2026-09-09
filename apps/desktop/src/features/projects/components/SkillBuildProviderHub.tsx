import { providerEssentialCount, cozeaSkills, providerSkillCounts } from "@/features/projects/model/skillBuildModel";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";
import type { AgentSkillBuild, AgentSkillProvider, AgentSkillRecord } from "@shared/electronApiTypes";
import { BUILD_PROVIDER_ICONS } from "./skillBuildProviderIcons";

/**
 * The hub is laid out in a fixed 900x560 coordinate space and then expressed
 * in percentages, so the whole diagram scales with the pane while the
 * hairlines stay 1px (`vector-effect: non-scaling-stroke`).
 */
const HUB_W = 900;
const HUB_H = 560;

const pctX = (value: number) => `${(value / HUB_W) * 100}%`;
const pctY = (value: number) => `${(value / HUB_H) * 100}%`;

/**
 * One seat in the ring. `d` is drawn in the node's own box, so each silhouette
 * chamfers the corners that face the core — the ring reads as one machined
 * plate rather than four identical cards.
 */
interface HubSlot {
  d: string;
  w: number;
  h: number;
  x: number;
  y: number;
  edge: "top" | "left" | "right" | "bottom";
  /**
   * The outline cut in two at the edge facing away from the core, so a single
   * charge arriving at a plate runs down both of its sides and meets again at
   * the edge that feeds the wiring.
   */
  halves: [string, string];
}

const HUB_SLOTS: HubSlot[] = [
  {
    edge: "top",
    w: 300,
    h: 120,
    x: 450,
    y: 68,
    d: "M40 1 H260 L299 27 V119 H1 V27 Z",
    halves: ["M150 1 H40 L1 27 V119 H150", "M150 1 H260 L299 27 V119 H150"],
  },
  {
    edge: "left",
    w: 280,
    h: 132,
    x: 145,
    y: 280,
    d: "M40 1 H279 V101 L239 131 H1 V31 Z",
    halves: ["M1 81 V31 L40 1 H279 V51", "M1 81 V131 H239 L279 101 V51"],
  },
  {
    edge: "right",
    w: 280,
    h: 132,
    x: 755,
    y: 280,
    d: "M1 1 H239 L279 31 V131 H41 L1 101 Z",
    halves: ["M279 81 V31 L239 1 H1 V51", "M279 81 V131 H41 L1 101 V51"],
  },
  {
    edge: "bottom",
    w: 300,
    h: 120,
    x: 450,
    y: 492,
    d: "M1 1 H299 V93 L260 119 H40 L1 93 Z",
    halves: ["M150 119 H40 L1 93 V1 H150", "M150 119 H260 L299 93 V1 H150"],
  },
];

/**
 * The charge crosses the diagram in stages, each starting a beat after the
 * one that feeds it: a plate's two sides, then the three stubs leaving its
 * inner edge, then the diagonals, then the core's two diamonds. Every stage
 * shares one duration, so the offsets alone make the cascade.
 */
export const HUB_CHARGE_STAGE_DELAY_S = { plate: 0, stub: 0.42, diagonal: 0.82, core: 1.18 };

/** Decorative part codes, the way a machined panel carries a stamp. */
const HUB_STAMP = "8W7F1 1A1T1 21TRG";

/**
 * The loadout screen: the build at the centre, each provider a plate around it
 * carrying the number of that build's skills it would run, joined by traces.
 * Clicking a plate opens what that provider actually gets.
 */
export function ProviderHub({
  loadout,
  skills,
  isActive,
  onOpenProvider,
  onOpenShared,
}: {
  build?: AgentSkillBuild;
  loadout: AgentSkillRecord[];
  skills: AgentSkillRecord[];
  isActive: boolean;
  busyKey?: string | null;
  onOpenProvider: (provider: AgentSkillProvider) => void;
  onOpenShared: () => void;
  onOpenAllSkills?: () => void;
  onEquip?: () => void;
}) {
  const counts = providerSkillCounts(loadout);
  const shared = cozeaSkills(loadout);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div
          className={cn(
            // Sized by the height it is given, not the width: a fixed-ratio
            // box driven by `w-full` overflows a short pane instead of
            // shrinking (measured: 117px over at a 620px pane). The lit field
            // it used to carry is now the page's, so this box is transparent.
            "relative h-full max-h-[640px] w-auto max-w-full",
            "aspect-[900/560]",
          )}
        >
          <HubTraces charged={isActive} />

          {counts.map((node, index) => {
            const slot = HUB_SLOTS[index];
            if (!slot) return null;
            return (
              <ProviderNode
                key={node.provider}
                node={node}
                slot={slot}
                charged={isActive}
                essential={providerEssentialCount(skills, node.provider)}
                onClick={onOpenProvider}
              />
            );
          })}

          {/* The core plate: what every provider carries, on top of the traces. */}
          <button
            type="button"
            onClick={() => onOpenShared()}
            aria-label={`Cozea skills: ${shared.length} carried by every provider`}
            className="skill-builds-core-button group absolute top-1/2 left-1/2 z-[2] aspect-square w-[20.6%] -translate-x-1/2 -translate-y-1/2 cursor-pointer focus-visible:outline-none"
          >
            <span
              className="skill-builds-core-plate absolute inset-0 rotate-45 rounded-[3px] border border-[var(--hub-ln-hi)]"
            />
            {/* The ring nearest the middle holds steady instead of pulsing:
                an active build reads as lit, and one running ring is enough
                motion at the centre. */}
            <span
              className={cn(
                "absolute inset-[12%] rotate-45 rounded-[2px] border transition-colors",
                isActive
                  ? "skill-builds-active-ring opacity-100"
                  : "border-[var(--hub-ln)] opacity-55",
              )}
            />
            {/* The core is CSS boxes, so the charge needs a path of its own.
                A rotated square is a diamond in the SVG's own coordinates. */}
            {isActive ? (
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 size-full overflow-visible"
              >
                {/* Both rings, each entered at the top and bottom vertices
                    and split down the two edges either side, so the core is
                    fed the way the plates are rather than chased round. */}
                {HUB_CORE_CHARGE_EDGES.map((d) => (
                  <path
                    key={d}
                    d={d}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    pathLength={100}
                    // Longer than the wiring's dash: the core is the arrival.
                    strokeDasharray="42 58"
                    style={{ animationDelay: `${HUB_CHARGE_STAGE_DELAY_S.core}s` }}
                    className="cozea-hub-charge skill-builds-charge-strong"
                  />
                ))}
              </svg>
            ) : null}
            {/* Same arrangement as a provider plate — name, then mark and
                count — so the core reads as one of the family, just bigger. */}
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-[8%]">
              <span className="text-[11px] tracking-[0.16em] text-muted-foreground uppercase transition-colors group-hover:text-foreground">
                Cozea
              </span>
              <span className="flex items-center gap-2.5">
                <Logo size={22} className="shrink-0 opacity-90" />
                <span
                  className={cn(
                    "text-[26px] leading-none font-medium tabular-nums text-foreground",
                    shared.length === 0 && "opacity-45",
                  )}
                >
                  {shared.length}
                </span>
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** The routes themselves, shared by the static wiring and the live charge. */
const HUB_TRACE_PATHS = [
  "M450 128 V150",
  "M436 128 V142 H406",
  "M464 128 V142 H494",
  "M450 410 V432",
  "M436 432 V418 H406",
  "M464 432 V418 H494",
  "M285 264 H316",
  "M285 246 H300 V226",
  "M285 298 H300 V318",
  "M615 264 H584",
  "M615 246 H600 V226",
  "M615 298 H600 V318",
  "M300 188 H352 L390 150",
  "M600 188 H548 L510 150",
  "M300 374 H352 L390 412",
  "M600 374 H548 L510 412",
] as const;

/**
 * The four spokes the charge runs along, each drawn from its plate's inner
 * edge to the core.
 *
 * Separate from the decorative wiring on purpose: those routes are drawn in
 * whichever direction suited the picture, and a dash travels the way its path
 * was drawn, so reusing them would send half the charge outwards. Each spoke
 * follows its stub's axis and ends on the diamond, so all four start together
 * and arrive together.
 */
/**
 * The three stubs leaving each plate's inner edge, every one drawn away from
 * the plate. A dash travels the way its path was drawn, so the decorative
 * wiring cannot be reused: some of those routes run core to plate.
 */
const HUB_CHARGE_STUBS = [
  "M450 128 V150",
  "M436 128 V142 H406",
  "M464 128 V142 H494",
  "M450 432 V410",
  "M436 432 V418 H406",
  "M464 432 V418 H494",
  "M285 264 H316",
  "M285 246 H300 V226",
  "M285 298 H300 V318",
  "M615 264 H584",
  "M615 246 H600 V226",
  "M615 298 H600 V318",
] as const;

/**
 * The core's rings as four edges each, drawn from the top and bottom vertices
 * outward to the left and right ones.
 *
 * A closed ring would send one dash chasing round the whole diamond. Split
 * this way the charge enters where the wiring actually arrives, at the top and
 * bottom, and each entry runs down both sides to meet at the waist.
 *
 * The vertices sit outside the 100x100 box on purpose. Both rings are squares
 * rotated 45 degrees, so their corners reach the half-diagonal rather than the
 * box edge; a diamond inscribed in the box traces neither ring.
 */
const HUB_CORE_CHARGE_EDGES = [
  // Only the outer ring runs. It is a square at inset 0, so its corners swing
  // out to the half-diagonal, 50 * sqrt(2) = 70.71, not the box edge at 50.
  // The inner ring simply lights up: see the core's own markup.
  "M50 -20.71 L-20.71 50",
  "M50 -20.71 L120.71 50",
  "M50 120.71 L-20.71 50",
  "M50 120.71 L120.71 50",
] as const;

/** The diagonals that carry the charge the last stretch to the diamond. */
const HUB_CHARGE_DIAGONALS = [
  "M300 188 H352 L390 150",
  "M600 188 H548 L510 150",
  "M300 374 H352 L390 412",
  "M600 374 H548 L510 412",
] as const;

/** Circuit routes from the core out to each plate, drawn behind them. */
function HubTraces({ charged }: { charged: boolean }) {
  return (
    <svg
      viewBox={`0 0 ${HUB_W} ${HUB_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="absolute inset-0 z-[1] size-full"
    >
      <g stroke="var(--hub-trace)" strokeWidth="1.1" fill="none" vectorEffect="non-scaling-stroke">
        {HUB_TRACE_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>

      {/* Stage two and three: out of each plate along its three stubs, then
          on down the diagonals. Each stage starts a beat after its feeder. */}
      {charged ? (
        <g
          stroke="currentColor"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className="skill-builds-charge"
        >
          {HUB_CHARGE_STUBS.map((d) => (
            <path
              key={d}
              d={d}
              pathLength={100}
              strokeDasharray="26 74"
              style={{ animationDelay: `${HUB_CHARGE_STAGE_DELAY_S.stub}s` }}
              className="cozea-hub-charge"
            />
          ))}
          {HUB_CHARGE_DIAGONALS.map((d) => (
            <path
              key={d}
              d={d}
              pathLength={100}
              strokeDasharray="26 74"
              style={{ animationDelay: `${HUB_CHARGE_STAGE_DELAY_S.diagonal}s` }}
              className="cozea-hub-charge"
            />
          ))}
        </g>
      ) : null}
      <g fill="var(--hub-trace)">
        <rect x="402" y="139" width="9" height="5" />
        <rect x="491" y="139" width="9" height="5" />
        <rect x="402" y="415" width="9" height="5" />
        <rect x="491" y="415" width="9" height="5" />
        <rect x="297" y="222" width="5" height="9" />
        <rect x="597" y="222" width="5" height="9" />
        <rect x="297" y="316" width="5" height="9" />
        <rect x="597" y="316" width="5" height="9" />
      </g>
    </svg>
  );
}

function ProviderNode({
  node,
  slot,
  essential,
  charged,
  onClick,
}: {
  node: { provider: AgentSkillProvider; label: string; count: number };
  slot: HubSlot;
  essential: number;
  charged: boolean;
  onClick: (provider: AgentSkillProvider) => void;
}) {
  const isEmpty = node.count === 0;
  const stampVertical = slot.edge === "left" || slot.edge === "right";

  return (
    <button
      type="button"
      onClick={() => onClick(node.provider)}
      aria-label={`${node.label}: ${node.count} skills in this build`}
      style={{
        left: pctX(slot.x),
        top: pctY(slot.y),
        width: pctX(slot.w),
        height: pctY(slot.h),
      }}
      className="group absolute z-[2] -translate-x-1/2 -translate-y-1/2 cursor-pointer"
    >
      <svg
        viewBox={`0 0 ${slot.w} ${slot.h}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        className="skill-builds-provider-plate absolute inset-0 size-full"
      >
        <path
          d={slot.d}
          fill="var(--hub-fill)"
          stroke="var(--hub-ln)"
          strokeWidth="1.25"
          vectorEffect="non-scaling-stroke"
          className="transition-[fill,stroke] duration-150 group-hover:fill-[var(--hub-fill-hi)] group-hover:stroke-[var(--hub-ln-hi)]"
        />
        {charged
          ? slot.halves.map((half) => (
              <path
                key={half}
                d={half}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                pathLength={100}
                strokeDasharray="26 74"
                style={{ animationDelay: `${HUB_CHARGE_STAGE_DELAY_S.plate}s` }}
                className="cozea-hub-charge skill-builds-charge"
              />
            ))
          : null}
      </svg>

      <span className="absolute inset-0 flex flex-col items-center justify-center gap-2">
        <span className="text-[11px] tracking-[0.16em] text-muted-foreground uppercase transition-colors group-hover:text-foreground">
          {node.label}
        </span>
        <span className="flex items-center gap-2.5">
          <ProviderMark provider={node.provider} />
          <span
            className={cn(
              "text-[22px] leading-none font-medium tabular-nums text-foreground",
              isEmpty && "opacity-45",
            )}
          >
            {node.count}
          </span>
          {/* Always on, whatever the build holds, so it is shown apart from
              the count rather than folded into it. */}
          {essential > 0 ? (
            <span
              className="text-[12px] leading-none tabular-nums text-muted-foreground"
              title={`${essential} essential ${essential === 1 ? "skill" : "skills"} always on`}
            >
              +{essential}
            </span>
          ) : null}
        </span>
      </span>

      {/* A clip straddling the edge that faces the core, and a stamped code. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute border border-[var(--hub-ln)] bg-background opacity-90",
          slot.edge === "top" && "bottom-[-4px] left-[42%] h-[7px] w-[16%]",
          slot.edge === "bottom" && "top-[-4px] left-[42%] h-[7px] w-[16%]",
          slot.edge === "left" && "top-[42%] right-[-4px] h-[22px] w-[8px]",
          slot.edge === "right" && "top-[42%] left-[-4px] h-[22px] w-[8px]",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "absolute font-mono text-[6.5px] leading-none tracking-[0.1em] whitespace-nowrap text-[var(--hub-micro)]",
          slot.edge === "right" ? "right-[15%]" : "left-[15%]",
          slot.edge === "bottom" ? "bottom-[-10px]" : "top-[-9px]",
        )}
      >
        {stampVertical ? HUB_STAMP : "8W7F1 1A1T1"}
      </span>
    </button>
  );
}

/** The provider's own mark, beside its count on the plate. */
function ProviderMark({ provider }: { provider: AgentSkillProvider }) {
  const Mark = BUILD_PROVIDER_ICONS[provider];
  return (
    <Mark
      aria-hidden
      className="size-[18px] shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
    />
  );
}
