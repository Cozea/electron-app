"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SpinnerProps extends React.ComponentProps<"span"> {
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  label?: string;
}

const sizeClasses = {
  xs: "size-3",
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
  xl: "size-6",
};

const Spinner = React.forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { className, size = "sm", label, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      role={label ? "status" : "presentation"}
      aria-label={label}
      data-slot="spinner"
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-current",
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="size-full animate-spin"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="3"
        />
        <path
          className="opacity-80"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
});

export { Spinner };
