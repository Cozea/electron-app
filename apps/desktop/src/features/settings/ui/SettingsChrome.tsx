import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Header for top of settings pages (large clean title + optional description) */
export function SettingsPageHeader({
  title,
  description,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 px-1 space-y-1", className)}>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
      {description ? (
        <p className="text-xs text-muted-foreground/80">{description}</p>
      ) : null}
    </div>
  );
}

/** Outer column: matches project settings scroll column (`max-w-4xl`, padding). */
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
        "mx-auto w-full space-y-7",
        surface === "drawer" ? "max-w-5xl px-8 py-7" : "max-w-4xl px-8 sm:px-10 pt-6 pb-12",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Section title label above a group (e.g. Permissions, General) */
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
    <h2
      className={cn(
        "mb-2 flex items-center gap-1.5 px-1 text-xs font-semibold tracking-tight",
        variant === "danger" ? "text-destructive" : "text-foreground",
        className,
      )}
    >
      {children}
    </h2>
  );
}

/** One line under section title */
export function SettingsSectionDescription({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("mb-2.5 px-1 text-[11px] text-muted-foreground/80", className)}>{children}</p>
  );
}

/** Grouped card (Apple Inset Grouped card with border and divided rows) */
export function SettingsGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-border/40 bg-secondary/35 dark:border-white/[0.08] dark:bg-[#161616] divide-y divide-border/25 dark:divide-white/[0.06]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SettingsDangerGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-destructive/25 bg-destructive/10 dark:border-destructive/30 dark:bg-destructive/15 divide-y divide-destructive/20",
        className,
      )}
    >
      {children}
    </div>
  );
}

const rowBase =
  "flex min-h-[58px] items-center justify-between gap-8 px-6 py-4 text-left transition-colors";

/** One row inside SettingsGroup */
export function SettingsRow({
  children,
  className,
  isFirst: _isFirst,
  borderClassName: _borderClassName,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  isFirst?: boolean;
  borderClassName?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn(rowBase, className)}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

/** Left column: title + optional description */
export function SettingsRowLabel({
  title,
  description,
  htmlFor,
  className,
  descriptionClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  className?: string;
  descriptionClassName?: string;
}) {
  return (
    <div className={cn("min-w-0 flex-1 pr-6", description ? "flex flex-col gap-0.5" : "", className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="cursor-pointer text-sm font-medium text-foreground">
          {title}
        </label>
      ) : (
        <span className="text-sm font-medium text-foreground">{title}</span>
      )}
      {description ? (
        <p className={cn("text-xs leading-relaxed text-muted-foreground/80 mt-0.5", descriptionClassName)}>{description}</p>
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
  return <div className="border-t border-border/40 px-5 py-3 text-xs text-destructive">{children}</div>;
}

/** Success line inside group */
export function SettingsGroupSuccess({ children }: { children: ReactNode }) {
  return (
    <div className="border-t border-border/40 px-5 py-3 text-xs text-emerald-600 dark:text-emerald-500">
      {children}
    </div>
  );
}

/** Bottom save row */
export function SettingsFooterActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex justify-end pt-3", className)}>{children}</div>;
}

/** Inputs aligned like settings (right, compact, flat borderless) */
export const settingsInlineInputClass =
  "h-7 max-w-full border-0 border-none bg-transparent px-0 text-xs font-normal text-foreground shadow-none placeholder:text-muted-foreground/60 focus:outline-none focus-visible:border-none focus-visible:ring-0 focus-visible:shadow-none text-right dark:border-none dark:bg-transparent";

export const settingsInlineInputWidth = "w-[280px] max-w-full";

/** Native `<select>` in settings / create-project rows (compact rounded control). */
export const settingsNativeSelectClass =
  "h-8 max-w-full rounded-lg border border-border/60 bg-background/50 px-2.5 text-xs text-foreground shadow-xs outline-none focus:outline-none focus:ring-1 focus:ring-ring dark:bg-muted/40 cursor-pointer";
