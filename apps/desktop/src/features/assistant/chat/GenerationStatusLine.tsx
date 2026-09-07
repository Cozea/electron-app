import { memo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

interface GenerationStatusLineProps {
  textKey: string;
  children: React.ReactNode;
  className?: string;
  animateEntrance?: boolean;
}

export const GenerationStatusLine = memo(function GenerationStatusLine({
  textKey,
  children,
  className,
  animateEntrance = true,
}: GenerationStatusLineProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={shouldReduceMotion || !animateEntrance ? false : { opacity: 0, x: -14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        duration: 0.2,
        ease: [0.16, 1, 0.3, 1], // Smooth ease-out, no bounce
      }}
      className={cn(
        "flex h-7 min-h-7 w-full min-w-0 items-center overflow-hidden text-sm leading-normal text-muted-foreground",
        className,
      )}
    >
      <div className="relative flex h-full w-full min-w-0 items-center overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={textKey}
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -14 }}
            transition={{
              duration: 0.22,
              ease: [0.16, 1, 0.3, 1], // Smooth slot machine roll, no bounce
            }}
            className="flex items-center gap-1.5 min-w-0 truncate tabular-nums"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
});
