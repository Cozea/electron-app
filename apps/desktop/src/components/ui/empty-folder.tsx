import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FolderLibraryIcon as __FolderLibraryHugeIcon,
  FolderAddIcon as __FolderAddHugeIcon,
  CodeIcon as __CodeHugeIcon,
  GitBranchIcon as __GitBranchHugeIcon,
} from "@hugeicons/core-free-icons";

export interface EmptyFolderProps {
  title?: string;
  description?: string;
  browseLabel?: string;
  isDragActive?: boolean;
  isSelectingFolder?: boolean;
  onBrowse?: () => void;
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnter?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (event: React.DragEvent<HTMLDivElement>) => void;
  className?: string;
}

export function EmptyFolder({
  title = "Drop a repository folder",
  description = "Opens the folder in place without copying or moving it. Click to browse.",
  browseLabel = "Browse folder",
  isDragActive = false,
  isSelectingFolder = false,
  onBrowse,
  onDrop,
  onDragEnter,
  onDragOver,
  onDragLeave,
  className,
}: EmptyFolderProps) {
  const [isHovered, setIsHovered] = React.useState(false);
  const [isManuallyToggled, setIsManuallyToggled] = React.useState(false);

  const isOpen = isDragActive || isHovered || isManuallyToggled;

  return (
    <div
      className={cn(
        "relative flex w-full max-w-2xl flex-col items-center justify-center py-10 px-4 select-none",
        className,
      )}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* 3D Animated Folder Visual */}
      <div
        role="button"
        tabIndex={0}
        aria-label={title}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => {
          setIsManuallyToggled((prev) => !prev);
          onBrowse?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onBrowse?.();
          }
        }}
        className={cn(
          "group relative mb-8 h-48 w-72 cursor-pointer sm:h-52 sm:w-80",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-2xl",
        )}
      >
        {/* Glow backdrop on drag */}
        <div
          className={cn(
            "pointer-events-none absolute -inset-8 rounded-full opacity-0 blur-2xl transition-opacity duration-300",
            isDragActive && "opacity-100 bg-primary/20",
          )}
        />

        {/* Folder Back */}
        <div
          className={cn(
            "relative mx-auto flex h-full w-[88%] justify-center rounded-2xl border overflow-visible transition-colors duration-200",
            "bg-[#202024] border-white/[0.1] dark:bg-[#1a1a1e] dark:border-white/[0.08]",
            isDragActive && "border-primary/60 shadow-[0_0_30px_rgba(255,255,255,0.08)]",
          )}
        >
          {/* Fanning-out code & file pages */}
          {[
            {
              initial: { rotate: -3, x: -36, y: 4 },
              open: { rotate: -10, x: -68, y: -72 },
              transition: {
                type: "spring" as const,
                bounce: 0.16,
                stiffness: 160,
                damping: 22,
              },
              className: "z-10",
              tag: "src/",
              icon: __CodeHugeIcon,
            },
            {
              initial: { rotate: 0, x: 0, y: 0 },
              open: { rotate: 1, x: 0, y: -90 },
              transition: {
                type: "spring" as const,
                duration: 0.55,
                bounce: 0.14,
                stiffness: 190,
                damping: 24,
              },
              className: "z-20",
              tag: "README.md",
              icon: __FolderLibraryHugeIcon,
            },
            {
              initial: { rotate: 3.5, x: 38, y: 3 },
              open: { rotate: 10, x: 70, y: -74 },
              transition: {
                type: "spring" as const,
                duration: 0.58,
                bounce: 0.18,
                stiffness: 170,
                damping: 21,
              },
              className: "z-10",
              tag: "main",
              icon: __GitBranchHugeIcon,
            },
          ].map((page, i) => (
            <motion.div
              key={i}
              initial={page.initial}
              animate={isOpen ? page.open : page.initial}
              transition={page.transition}
              className={cn(
                "absolute top-2.5 h-fit w-32 rounded-xl shadow-xl",
                page.className,
              )}
            >
              <FileCard tag={page.tag} icon={page.icon} />
            </motion.div>
          ))}
        </div>

        {/* 3D Animated Folder Flap */}
        <motion.div
          animate={{ rotateX: isOpen ? -38 : 0 }}
          transition={{ type: "spring", duration: 0.55, bounce: 0.18 }}
          className="absolute inset-x-0 -bottom-px z-30 flex h-44 origin-bottom items-center justify-center overflow-visible"
          style={{ transformStyle: "preserve-3d", perspective: 900 }}
        >
          <div className="relative h-full w-full">
            <svg
              className="h-full w-full overflow-visible drop-shadow-md"
              viewBox="0 0 235 121"
              fill="none"
              preserveAspectRatio="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M104.615 0.350494L33.1297 0.838776C32.7542 0.841362 32.3825 0.881463 32.032 0.918854C31.6754 0.956907 31.3392 0.992086 31.0057 0.992096H31.0047C30.6871 0.99235 30.3673 0.962051 30.0272 0.929596C29.6927 0.897686 29.3384 0.863802 28.9803 0.866119L13.2693 0.967682H13.2527L13.2352 0.969635C13.1239 0.981406 13.0121 0.986674 12.9002 0.986237H9.91388C8.33299 0.958599 6.76052 1.22345 5.27423 1.76651H5.27325C4.33579 2.11246 3.48761 2.66213 2.7879 3.37393L2.49689 3.68839L2.492 3.69424C1.62667 4.73882 1.00023 5.96217 0.656067 7.27725C0.653324 7.28773 0.654065 7.29886 0.652161 7.30948C0.3098 8.62705 0.257231 10.0048 0.499817 11.3446L12.2147 114.399L12.2156 114.411L12.2176 114.423C12.6046 116.568 13.7287 118.508 15.3934 119.902C17.058 121.297 19.1572 122.056 21.3231 122.049V122.05H215.379C217.76 122.02 220.064 121.192 221.926 119.698V119.697C223.657 118.384 224.857 116.485 225.305 114.35L225.307 114.339L235.914 53.3798L235.968 53.1093L235.97 53.0985L235.971 53.0888C236.134 51.8978 236.044 50.685 235.705 49.5321C235.307 48.1669 234.63 46.9005 233.717 45.8144L233.383 45.4296C232.58 44.5553 231.614 43.8449 230.539 43.3398C229.311 42.7628 227.971 42.4685 226.616 42.4774H146.746C144.063 42.4705 141.423 41.8004 139.056 40.5263C136.691 39.2522 134.671 37.4127 133.175 35.1689L113.548 5.05948L113.544 5.05362L113.539 5.04776C112.545 3.65165 111.238 2.51062 109.722 1.72061C108.266 0.886502 106.627 0.422235 104.952 0.365143V0.364166L104.633 0.350494H104.615Z"
                className={cn(
                  "transition-colors duration-200",
                  "fill-[#2b2b30] stroke-white/[0.14] dark:fill-[#252529] dark:stroke-white/[0.12]",
                  isDragActive && "stroke-primary/70 fill-[#2f2f35]",
                )}
                strokeWidth="1.5"
              />
            </svg>

            {/* Folder Tab Detail */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-8">
              <div className="mb-2.5 flex gap-11">
                <div className="size-2.5 rounded-full bg-white/20 dark:bg-white/15" />
                <div className="size-2.5 rounded-full bg-white/20 dark:bg-white/15" />
              </div>
              <div className="h-1 w-9 rounded-full bg-white/20 dark:bg-white/15" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Large, Beautiful Typography */}
      <div className="space-y-3 text-center">
        <h2 className="text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl">
          {isSelectingFolder
            ? "Importing project…"
            : isDragActive
              ? "Release to open project"
              : title}
        </h2>
        <p className="mx-auto max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
          {description}
        </p>
      </div>

      {/* Action Button */}
      <div className="mt-7 flex items-center justify-center">
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={isSelectingFolder}
          onClick={(e) => {
            e.stopPropagation();
            onBrowse?.();
          }}
        >
          {browseLabel}
        </Button>
      </div>
    </div>
  );
}

function FileCard({
  tag,
  icon: IconComponent,
}: {
  tag: string;
  icon?: typeof __FolderLibraryHugeIcon;
}) {
  return (
    <div className="h-full w-full rounded-xl border border-white/[0.1] bg-[#2a2a2f] p-3.5 shadow-2xl dark:bg-[#202024] dark:border-white/[0.08]">
      <div className="flex items-center gap-1.5 mb-2.5">
        {IconComponent ? (
          <HugeiconsIcon icon={IconComponent} className="size-3 text-muted-foreground" />
        ) : null}
        <span className="font-mono text-[10px] text-muted-foreground truncate">{tag}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="h-1.5 w-full rounded-full bg-white/15" />
        <div className="flex gap-1.5">
          <div className="h-1.5 flex-1 rounded-full bg-white/10" />
          <div className="h-1.5 w-1/3 rounded-full bg-white/10" />
        </div>
        <div className="flex gap-1.5">
          <div className="h-1.5 w-1/2 rounded-full bg-white/10" />
          <div className="h-1.5 flex-1 rounded-full bg-white/10" />
        </div>
        <div className="h-1.5 w-2/3 rounded-full bg-white/10" />
      </div>
    </div>
  );
}

export default EmptyFolder;
