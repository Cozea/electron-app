import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Outer column: matches project settings scroll column (`max-w-xl`, padding). */
export function SettingsPageBody({
  children,
  className,
  surface = "page",
}: {
  children: ReactNode;
  className?: string;
  surface?: "page" | "drawer";
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full space-y-5",
        surface === "drawer" ? "max-w-4xl px-6 py-6" : "max-w-xl px-6 pt-5 pb-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Muted caps section label above a group */
export function SettingsSectionTitle({
  children,
  className,
  variant = "default",
}: {
  children: ReactNode;
  className?: string;
  variant?: "default" | "danger";
}) {
  return (
    <h3
      className={cn(
        "mb-1.5 flex items-center gap-1.5 px-1 text-xs font-medium",
        variant === "danger" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {children}
    </h3>
  );
}

/** One line under section title (replaces ad hoc `text-sm text-muted-foreground mb-4`) */
export function SettingsSectionDescription({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("mb-3 px-1 text-[11px] text-muted-foreground", className)}>{children}</p>
  );
}

/** Grouped card (iOS-style settings list) */
export function SettingsGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col overflow-hidden rounded-[14px] bg-muted", className)}>{children}</div>
  );
}

export function SettingsDangerGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-[14px] bg-destructive/15 dark:bg-destructive/20",
        className,
      )}
    >
      {children}
    </div>
  );
}

const rowBase =
  "flex min-h-[44px] items-center justify-between gap-4 px-4 py-2 text-left";

/** One row inside SettingsGroup; first row should pass isFirst */
export function SettingsRow({
  children,
  className,
  isFirst,
  borderClassName = "border-border/40",
}: {
  children: ReactNode;
  className?: string;
  isFirst?: boolean;
  /** Use `border-destructive/20` inside danger groups */
  borderClassName?: string;
}) {
  return (
    <div
      className={cn(rowBase, !isFirst && cn("border-t", borderClassName), className)}
    >
      {children}
    </div>
  );
}

/** Left column: title + optional description (project settings pattern) */
export function SettingsRowLabel({
  title,
  description,
  htmlFor,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 pr-4", description ? "flex flex-col gap-0.5" : "", className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="cursor-pointer text-xs font-medium text-foreground">
          {title}
        </label>
      ) : (
        <span className="text-xs font-medium text-foreground">{title}</span>
      )}
      {description ? (
        <p className="text-[11px] text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

/** Right-aligned compact control slot */
export function SettingsRowControl({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex shrink-0 items-center justify-end", className)}>{children}</div>;
}

/** Inline error inside a group (full width row) */
export function SettingsGroupError({ children }: { children: ReactNode }) {
  return <div className="border-t border-border/40 px-4 py-3 text-xs text-destructive">{children}</div>;
}

/** Success line inside group */
export function SettingsGroupSuccess({ children }: { children: ReactNode }) {
  return (
    <div className="border-t border-border/40 px-4 py-3 text-xs text-emerald-600 dark:text-emerald-500">
      {children}
    </div>
  );
}

/** Bottom save row */
export function SettingsFooterActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex justify-end pt-3", className)}>{children}</div>;
}

/** Inputs aligned like project settings (right, compact) */
export const settingsInlineInputClass =
  "h-7 max-w-full border-none bg-transparent px-0 !text-[11px] shadow-none focus-visible:ring-0 text-right";

export const settingsInlineInputWidth = "w-[240px] max-w-full";
