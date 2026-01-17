"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { BookOpenIcon, ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";

export type SourcesProps = ComponentProps<typeof Collapsible>;

export const Sources = ({ className, ...props }: SourcesProps) => (
  <Collapsible
    className={cn("not-prose mb-4 text-primary text-xs", className)}
    {...props}
  />
);

export type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  count: number;
};

export const SourcesTrigger = ({
  className,
  count,
  children,
  ...props
}: SourcesTriggerProps) => (
  <CollapsibleTrigger
    className={cn(
      "flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        <BookOpenIcon className="size-4" />
        <p className="font-medium">
          {count === 1 ? "1 source" : `${count} sources`}
        </p>
        <ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" />
      </>
    )}
  </CollapsibleTrigger>
);

export type SourcesContentProps = ComponentProps<typeof CollapsibleContent>;

export const SourcesContent = ({
  className,
  ...props
}: SourcesContentProps) => (
  <CollapsibleContent
    className={cn(
      "mt-3 flex w-fit flex-col gap-2",
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

export type SourceProps = ComponentProps<"a"> & {
  title?: string;
  favicon?: string;
};

export const Source = ({
  href,
  title,
  favicon,
  children,
  className,
  ...props
}: SourceProps) => {
  // Extract domain from URL for display if no title
  const displayTitle = title || (href ? new URL(href).hostname : "Source");

  return (
    <a
      className={cn(
        "flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors",
        className
      )}
      href={href}
      rel="noreferrer noopener"
      target="_blank"
      {...props}
    >
      {children ?? (
        <>
          {favicon ? (
            <img
              src={favicon}
              alt=""
              className="size-4 rounded-sm"
              onError={(e) => {
                // Fallback to book icon if favicon fails to load
                e.currentTarget.style.display = "none";
                e.currentTarget.nextElementSibling?.classList.remove("hidden");
              }}
            />
          ) : null}
          <BookOpenIcon
            className={cn("size-4", favicon && "hidden")}
          />
          <span className="font-medium truncate max-w-[200px]">
            {displayTitle}
          </span>
        </>
      )}
    </a>
  );
};

Sources.displayName = "Sources";
SourcesTrigger.displayName = "SourcesTrigger";
SourcesContent.displayName = "SourcesContent";
Source.displayName = "Source";
