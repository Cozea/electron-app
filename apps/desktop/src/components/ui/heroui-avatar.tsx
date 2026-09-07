"use client";

import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as React from "react";
import { cn } from "@/lib/utils";

type AvatarSize = "sm" | "md" | "lg";
type AvatarColor =
  | "default"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "blue"
  | "purple"
  | "coral";
type AvatarVariant = "default" | "soft" | "gradient";

type AvatarContextValue = {
  color: AvatarColor;
  size: AvatarSize;
  variant: AvatarVariant;
};

const AvatarContext = React.createContext<AvatarContextValue>({
  color: "default",
  size: "md",
  variant: "gradient",
});

const GRADIENT_PALETTE: Array<AvatarColor> = ["blue", "purple", "coral"];

function getGradientColorFromSeed(seed?: React.ReactNode): AvatarColor {
  if (!seed) return "purple";
  const str = typeof seed === "string" ? seed : String(seed);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return GRADIENT_PALETTE[Math.abs(hash) % GRADIENT_PALETTE.length] ?? "purple";
}

const colorClassMap: Record<AvatarColor, string> = {
  default: "text-zinc-600 dark:text-zinc-300",
  accent: "text-violet-700 dark:text-violet-300",
  success: "text-emerald-700 dark:text-emerald-300",
  warning: "text-amber-700 dark:text-amber-300",
  danger: "text-rose-700 dark:text-rose-300",
  blue: "text-blue-700 dark:text-blue-300",
  purple: "text-purple-700 dark:text-purple-300",
  coral: "text-rose-700 dark:text-rose-300",
};

const softColorClassMap: Record<AvatarColor, string> = {
  default: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  accent: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-200",
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200",
  danger: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-200",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200",
  purple: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-200",
  coral: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-200",
};

const gradientClassMap: Record<AvatarColor, string> = {
  default:
    "bg-[radial-gradient(circle_at_50%_60%,#2563eb_0%,#38bdf8_40%,#bae6fd_75%,#e0f2fe_100%)] text-white shadow-inner",
  accent:
    "bg-[radial-gradient(circle_at_50%_60%,#9333ea_0%,#c084fc_40%,#f5d0fe_75%,#fae8ff_100%)] text-white shadow-inner",
  blue:
    "bg-[radial-gradient(circle_at_50%_60%,#2563eb_0%,#38bdf8_40%,#bae6fd_75%,#e0f2fe_100%)] text-white shadow-inner",
  purple:
    "bg-[radial-gradient(circle_at_50%_60%,#9333ea_0%,#c084fc_40%,#f5d0fe_75%,#fae8ff_100%)] text-white shadow-inner",
  coral:
    "bg-[radial-gradient(circle_at_50%_60%,#ea580c_0%,#fb923c_40%,#fecdd3_75%,#ffe4e6_100%)] text-white shadow-inner",
  success:
    "bg-[radial-gradient(circle_at_50%_60%,#059669_0%,#34d399_40%,#a7f3d0_75%,#ecfdf5_100%)] text-white shadow-inner",
  warning:
    "bg-[radial-gradient(circle_at_50%_60%,#d97706_0%,#fbbf24_40%,#fde68a_75%,#fef3c7_100%)] text-white shadow-inner",
  danger:
    "bg-[radial-gradient(circle_at_50%_60%,#e11d48_0%,#fb7185_40%,#fecdd3_75%,#ffe4e6_100%)] text-white shadow-inner",
};

interface AvatarRootProps
  extends Omit<React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>, "color"> {
  color?: AvatarColor;
  size?: AvatarSize;
  variant?: AvatarVariant;
}

function AvatarRoot({
  children,
  className,
  color = "default",
  size = "md",
  variant = "gradient",
  ...props
}: AvatarRootProps) {
  return (
    <AvatarContext.Provider value={{ color, size, variant }}>
      <AvatarPrimitive.Root
        data-slot="avatar"
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden bg-zinc-100 dark:bg-zinc-800",
          size === "sm" && "size-8 rounded-2xl",
          size === "md" && "size-10 rounded-3xl",
          size === "lg" && "size-12 rounded-3xl",
          (variant === "soft" || variant === "gradient") && "bg-transparent dark:bg-transparent",
          className,
        )}
        {...props}
      >
        {children}
      </AvatarPrimitive.Root>
    </AvatarContext.Provider>
  );
}

interface AvatarImageProps
  extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image> {}

function AvatarImage({ className, ...props }: AvatarImageProps) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn(
        "absolute inset-0 aspect-square size-full object-cover opacity-100 transition-opacity duration-200 motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

interface AvatarFallbackProps
  extends Omit<React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>, "color"> {
  color?: AvatarColor;
}

function AvatarFallback({ children, className, color, ...props }: AvatarFallbackProps) {
  const context = React.useContext(AvatarContext);
  let resolvedColor = color ?? context.color;

  if (context.variant === "gradient" && resolvedColor === "default" && children) {
    resolvedColor = getGradientColorFromSeed(children);
  }

  const variantClasses =
    context.variant === "gradient"
      ? gradientClassMap[resolvedColor] ?? gradientClassMap.default
      : context.variant === "soft"
        ? softColorClassMap[resolvedColor] ?? softColorClassMap.default
        : cn(
            "bg-zinc-100 dark:bg-zinc-800",
            colorClassMap[resolvedColor] ?? colorClassMap.default,
          );

  return (
    <AvatarPrimitive.Fallback
      className={cn(
        "flex size-full items-center justify-center text-sm font-semibold select-none",
        context.variant === "gradient" && "text-white drop-shadow-xs",
        context.size === "lg" && "text-base",
        variantClasses,
        className,
      )}
      data-slot="avatar-fallback"
      {...props}
    >
      {children}
    </AvatarPrimitive.Fallback>
  );
}

const Avatar = Object.assign(AvatarRoot, {
  Image: AvatarImage,
  Fallback: AvatarFallback,
});

export { Avatar, AvatarRoot, AvatarImage, AvatarFallback };
export type { AvatarRootProps, AvatarImageProps, AvatarFallbackProps, AvatarSize, AvatarColor, AvatarVariant };
