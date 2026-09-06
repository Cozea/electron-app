import * as React from "react";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";

/** Twelve marks, long ones on the quarters, laid out around the dial. */
const TICKS = Array.from({ length: 12 }, (_, index) => {
  const angle = (index * Math.PI * 2) / 12;
  const isQuarter = index % 3 === 0;
  const outer = 46;
  const inner = isQuarter ? 38 : 41;
  return {
    key: index,
    x1: 100 + Math.sin(angle) * outer,
    y1: 108 - Math.cos(angle) * outer,
    x2: 100 + Math.sin(angle) * inner,
    y2: 108 - Math.cos(angle) * inner,
    isQuarter,
  };
});

/**
 * Where the bells meet the case.
 *
 * A bell has to sit on the rim and lean along the radius, or it reads as pasted
 * on. Both the anchor and the lean come from one angle off vertical, so the two
 * can never drift apart.
 */
const CASE = { cx: 100, cy: 110, r: 62 };
const BELL_ANGLE = 42;

const BELLS = [-1, 1].map((side) => {
  const radians = (side * BELL_ANGLE * Math.PI) / 180;
  return {
    side,
    x: CASE.cx + Math.sin(radians) * CASE.r,
    y: CASE.cy - Math.cos(radians) * CASE.r,
    rotate: side * BELL_ANGLE,
  };
});

/** The cards that fan out of the case: the runs this task has not had yet. */
const RUN_CARDS = [
  {
    initial: { rotate: -4, x: -22, y: 10, opacity: 0 },
    open: { rotate: -13, x: -104, y: -46, opacity: 1 },
    transition: { type: "spring" as const, stiffness: 170, damping: 21, bounce: 0.18 },
    className: "z-10",
    tone: "started" as const,
    stamp: "09:00",
  },
  {
    initial: { rotate: 0, x: 0, y: 6, opacity: 0 },
    open: { rotate: 1, x: 0, y: -92, opacity: 1 },
    transition: { type: "spring" as const, stiffness: 195, damping: 23, bounce: 0.14 },
    className: "z-20",
    tone: "started" as const,
    stamp: "Tue 09:00",
  },
  {
    initial: { rotate: 4, x: 22, y: 10, opacity: 0 },
    open: { rotate: 12, x: 104, y: -44, opacity: 1 },
    transition: { type: "spring" as const, stiffness: 165, damping: 20, bounce: 0.2 },
    className: "z-10",
    tone: "skipped" as const,
    stamp: "Wed 09:00",
  },
];

/**
 * A task with nothing to show yet.
 *
 * Sibling of the folder empty state, and built the same way: one drawn
 * character in SVG on the shared `--empty-folder-*` palette, layered depth,
 * and springs tuned per element. The clock idles until you touch it, then
 * wakes — time speeds up, the bells ring, and the runs it is waiting for fan
 * out of the case. Nothing has happened yet, and nothing is wrong.
 */
export function EmptyTaskRuns({
  title = "No runs yet",
  description = "When this task next comes due, the run lands here with the conversation it opened.",
  className,
}: {
  title?: string;
  description?: string;
  className?: string;
}) {
  const [isAwake, setIsAwake] = React.useState(false);

  return (
    <div
      className={cn(
        "flex w-full flex-col items-center justify-center px-6 py-10 select-none",
        className,
      )}
    >
      <div
        role="img"
        aria-label={title}
        tabIndex={0}
        onMouseEnter={() => setIsAwake(true)}
        onMouseLeave={() => setIsAwake(false)}
        onFocus={() => setIsAwake(true)}
        onBlur={() => setIsAwake(false)}
        className="group relative mb-8 h-52 w-72 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {/* Glow, so waking the clock lifts the whole area rather than one shape. */}
        <div
          className={cn(
            "pointer-events-none absolute -inset-8 rounded-full opacity-0 blur-2xl transition-opacity duration-300",
            isAwake && "bg-primary/10 opacity-100",
          )}
        />

        {/* Runs fanning out from behind the case. */}
        {RUN_CARDS.map((card, index) => (
          <motion.div
            key={index}
            initial={card.initial}
            animate={isAwake ? card.open : card.initial}
            transition={card.transition}
            className={cn(
              "absolute inset-x-0 top-12 mx-auto h-fit w-28 rounded-xl shadow-xl",
              card.className,
            )}
          >
            <RunCard stamp={card.stamp} tone={card.tone} />
          </motion.div>
        ))}

        {/* The clock itself, breathing while it waits and lifting when woken. */}
        <motion.div
          className="absolute inset-0 z-30 flex items-center justify-center"
          animate={
            isAwake ? { y: -6, rotate: 0 } : { y: [0, -3, 0], rotate: [-1, 1, -1] }
          }
          transition={
            isAwake
              ? { type: "spring", stiffness: 240, damping: 17 }
              : { duration: 5.5, ease: "easeInOut", repeat: Infinity }
          }
        >
          <svg
            viewBox="0 0 200 200"
            className="h-full w-full overflow-visible"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              {/* Light from above: the case is brighter at the top, the dial
                  sinks away from it. Two gradients do most of the work of
                  making a flat circle read as an object. */}
              <linearGradient id="clock-case" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--empty-folder-flap-active)" />
                <stop offset="55%" stopColor="var(--empty-folder-flap)" />
                <stop offset="100%" stopColor="var(--empty-folder-back)" />
              </linearGradient>
              <radialGradient id="clock-dial" cx="0.5" cy="0.34" r="0.78">
                <stop offset="0%" stopColor="var(--empty-folder-page)" />
                <stop offset="100%" stopColor="var(--empty-folder-back)" />
              </radialGradient>
              <linearGradient id="clock-bell" x1="0.2" y1="0" x2="0.8" y2="1">
                <stop offset="0%" stopColor="var(--empty-folder-flap-active)" />
                <stop offset="100%" stopColor="var(--empty-folder-flap)" />
              </linearGradient>
              <linearGradient id="clock-glass" x1="0" y1="0" x2="0.7" y2="1">
                <stop offset="0%" stopColor="var(--empty-folder-page)" stopOpacity="0.55" />
                <stop offset="60%" stopColor="var(--empty-folder-page)" stopOpacity="0" />
              </linearGradient>
              <clipPath id="clock-dial-clip">
                <circle cx="100" cy="110" r="50" />
              </clipPath>
            </defs>

            {/* Contact shadow. It spreads and fades as the clock lifts, which
                is what sells the lift as height rather than a slide. */}
            <motion.ellipse
              cx="100"
              cy="184"
              className="fill-[var(--empty-folder-mark)]"
              animate={
                isAwake ? { rx: 52, ry: 5.5, opacity: 0.14 } : { rx: 44, ry: 7, opacity: 0.22 }
              }
              transition={{ type: "spring", stiffness: 220, damping: 20 }}
            />

            {/* Feet, splayed and rounded, drawn before the case so it stands on them. */}
            {[
              { x: 74, rotate: -14 },
              { x: 126, rotate: 14 },
            ].map((foot) => (
              <g key={foot.x} transform={`rotate(${foot.rotate} ${foot.x} 150)`}>
                <path
                  d={`M ${foot.x - 8} 148 L ${foot.x - 11} 172 Q ${foot.x - 11} 178 ${foot.x - 4} 178 L ${foot.x + 6} 178 Q ${foot.x + 12} 178 ${foot.x + 11} 172 L ${foot.x + 8} 148 Z`}
                  fill="url(#clock-case)"
                  className="stroke-[var(--empty-folder-edge)]"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              </g>
            ))}

            {/* Bells: a dome, a stem, and a highlight each, leaning out along
                the radius. Drawn before the case so the rim covers the joint. */}
            {BELLS.map((bell, index) => (
              <motion.g
                key={bell.side}
                style={{
                  transformBox: "view-box",
                  originX: `${bell.x}px`,
                  originY: `${bell.y}px`,
                }}
                animate={isAwake ? { rotate: [-9, 9, -9] } : { rotate: 0 }}
                transition={
                  isAwake
                    ? { duration: 0.22, ease: "easeInOut", repeat: Infinity, delay: index * 0.05 }
                    : { type: "spring", stiffness: 180, damping: 13 }
                }
              >
                <g transform={`rotate(${bell.rotate} ${bell.x} ${bell.y})`}>
                  {/* Squat rather than tall: a short stem and a shallow dome,
                      so the pair sits on the case instead of towering over it. */}
                  <rect
                    x={bell.x - 5.5}
                    y={bell.y - 9}
                    width="11"
                    height="11"
                    rx="3.5"
                    fill="url(#clock-case)"
                    className="stroke-[var(--empty-folder-edge)]"
                    strokeWidth="2"
                  />
                  <path
                    d={`M ${bell.x - 16} ${bell.y - 8} A 16 11.5 0 0 1 ${bell.x + 16} ${bell.y - 8} Z`}
                    fill="url(#clock-bell)"
                    className="stroke-[var(--empty-folder-edge)]"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  <path
                    d={`M ${bell.x - 10} ${bell.y - 10} A 11 8 0 0 1 ${bell.x - 3} ${bell.y - 17}`}
                    fill="none"
                    className="stroke-[var(--empty-folder-page)]"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    opacity="0.5"
                  />
                </g>
              </motion.g>
            ))}

            {/* The hammer between them, swinging only while they ring. */}
            <motion.g
              style={{ transformBox: "view-box", originX: "100px", originY: "50px" }}
              animate={isAwake ? { rotate: [-16, 16, -16] } : { rotate: 0 }}
              transition={
                isAwake
                  ? { duration: 0.22, ease: "easeInOut", repeat: Infinity }
                  : { type: "spring", stiffness: 200, damping: 15 }
              }
            >
              <line
                x1="100"
                y1="50"
                x2="100"
                y2="34"
                strokeWidth="3"
                strokeLinecap="round"
                className="stroke-[var(--empty-folder-edge)]"
              />
              <circle
                cx="100"
                cy="31"
                r="5"
                fill="url(#clock-case)"
                className="stroke-[var(--empty-folder-edge)]"
                strokeWidth="2"
              />
            </motion.g>

            {/* Case, bezel ring, dial. */}
            <circle
              cx="100"
              cy="110"
              r="62"
              fill="url(#clock-case)"
              className="stroke-[var(--empty-folder-edge)]"
              strokeWidth="2"
            />
            <circle
              cx="100"
              cy="110"
              r="55"
              fill="none"
              className="stroke-[var(--empty-folder-page)]"
              strokeWidth="1.5"
              opacity="0.35"
            />
            <circle
              cx="100"
              cy="110"
              r="50"
              fill="url(#clock-dial)"
              className="stroke-[var(--empty-folder-edge)]"
              strokeWidth="1.5"
            />

            {TICKS.map((tick) => (
              <line
                key={tick.key}
                x1={tick.x1}
                y1={tick.y1}
                x2={tick.x2}
                y2={tick.y2}
                strokeLinecap="round"
                strokeWidth={tick.isQuarter ? 3 : 1.75}
                className="stroke-[var(--empty-folder-mark)]"
                opacity={tick.isQuarter ? 0.8 : 0.4}
              />
            ))}

            {/* Hands keep their own time behind the face. Waking the clock does
                not restart the sweep, it only speeds it up. */}
            {/* Motion overwrites CSS transform-origin with originX/originY, and
                forces transform-box: fill-box unless one is passed here. Both
                are needed, and the origins must be px strings: bare numbers are
                read as percentages of the element's own box. */}
            <motion.g
              style={{ transformBox: "view-box", originX: "100px", originY: "110px" }}
              animate={{ rotate: 360 }}
              transition={{ duration: isAwake ? 2 : 9, ease: "linear", repeat: Infinity }}
              opacity="0.45"
            >
              <line
                x1="100"
                y1="110"
                x2="100"
                y2="76"
                strokeWidth="3"
                strokeLinecap="round"
                className="stroke-[var(--empty-folder-mark)]"
              />
            </motion.g>
            <motion.g
              style={{ transformBox: "view-box", originX: "100px", originY: "110px" }}
              animate={{ rotate: 360 }}
              transition={{ duration: isAwake ? 24 : 108, ease: "linear", repeat: Infinity }}
              opacity="0.45"
            >
              <line
                x1="100"
                y1="110"
                x2="100"
                y2="88"
                strokeWidth="4"
                strokeLinecap="round"
                className="stroke-[var(--empty-folder-mark)]"
              />
            </motion.g>

            {/* Face. Blush first, then eyes with a highlight each, then a mouth
                that lifts into a smile when the clock wakes. */}
            {[76, 124].map((x) => (
              <motion.ellipse
                key={`blush-${x}`}
                cx={x}
                cy="118"
                rx="7.5"
                ry="4.5"
                className="fill-primary"
                animate={{ opacity: isAwake ? 0.3 : 0.16 }}
                transition={{ type: "spring", stiffness: 240, damping: 22 }}
              />
            ))}

            {[
              { x: 84, delay: 0 },
              { x: 116, delay: 0.05 },
            ].map((eye) => (
              <motion.g
                key={`eye-${eye.x}`}
                animate={{ scaleY: [1, 1, 0.1, 1] }}
                transition={{
                  duration: 4.4,
                  times: [0, 0.88, 0.93, 1],
                  ease: "easeInOut",
                  repeat: Infinity,
                  delay: eye.delay,
                }}
              >
                <ellipse
                  cx={eye.x}
                  cy="100"
                  rx="5.5"
                  ry="6.5"
                  className="fill-[var(--empty-folder-mark)]"
                />
                <circle
                  cx={eye.x - 1.8}
                  cy="97.5"
                  r="1.9"
                  className="fill-[var(--empty-folder-page)]"
                  opacity="0.9"
                />
              </motion.g>
            ))}

            {/* Brows lift on waking: the cheapest way to read as awake. */}
            {[
              { x: 84, rotate: -8 },
              { x: 116, rotate: 8 },
            ].map((brow) => (
              <g key={`brow-${brow.x}`} transform={`rotate(${brow.rotate} ${brow.x} 89)`}>
                <motion.line
                  x1={brow.x - 5}
                  y1="89"
                  x2={brow.x + 5}
                  y2="89"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  className="stroke-[var(--empty-folder-mark)]"
                  animate={{ y: isAwake ? -3 : 0, opacity: isAwake ? 0.75 : 0.35 }}
                  transition={{ type: "spring", stiffness: 260, damping: 20 }}
                />
              </g>
            ))}

            <motion.path
              // A resting shape so the mouth exists before motion takes over.
              d="M 90 127 Q 100 130 110 127"
              initial={false}
              fill="none"
              strokeWidth="3.5"
              strokeLinecap="round"
              className="stroke-[var(--empty-folder-mark)]"
              animate={{
                d: isAwake ? "M 89 125 Q 100 137 111 125" : "M 90 127 Q 100 130 110 127",
              }}
              transition={{ type: "spring", stiffness: 260, damping: 20 }}
            />

            <circle cx="100" cy="110" r="4" className="fill-[var(--empty-folder-mark)]" />
            <circle
              cx="98.8"
              cy="108.8"
              r="1.3"
              className="fill-[var(--empty-folder-page)]"
              opacity="0.7"
            />

            {/* Glass, last: one specular sweep across the top-left of the dial. */}
            <g clipPath="url(#clock-dial-clip)" className="pointer-events-none">
              <path d="M 40 110 A 60 60 0 0 1 150 58 L 44 152 Z" fill="url(#clock-glass)" />
            </g>
          </svg>
        </motion.div>
      </div>

      <div className="space-y-2 text-center">
        <h3 className="text-2xl font-semibold tracking-[-0.03em] text-foreground">{title}</h3>
        <p className="mx-auto max-w-sm text-base leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

/** A run, the way the history lists one, drawn as a card the case fans out. */
function RunCard({ stamp, tone }: { stamp: string; tone: "started" | "skipped" }) {
  return (
    <div className="h-full w-full rounded-xl border border-[var(--empty-folder-edge)] bg-[var(--empty-folder-page)] p-3 shadow-2xl">
      <div className="mb-2 flex items-center gap-1.5">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            tone === "started" ? "bg-emerald-500" : "bg-[var(--empty-folder-mark)]",
          )}
        />
        <span className="truncate font-mono text-[10px] text-muted-foreground">{stamp}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="h-1.5 w-full rounded-full bg-[var(--empty-folder-line)]" />
        <div className="flex gap-1.5">
          <div className="h-1.5 flex-1 rounded-full bg-[var(--empty-folder-line-soft)]" />
          <div className="h-1.5 w-1/3 rounded-full bg-[var(--empty-folder-line-soft)]" />
        </div>
        <div className="h-1.5 w-2/3 rounded-full bg-[var(--empty-folder-line-soft)]" />
      </div>
    </div>
  );
}

export default EmptyTaskRuns;
