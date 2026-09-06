"use client";

import * as React from "react";
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface SearchInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "size"> {
  value: string;
  onValueChange: (value: string) => void;
  onClear?: () => void;
  sizeVariant?: "default" | "compact";
  containerClassName?: string;
}

const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    onValueChange,
    onClear,
    sizeVariant = "default",
    containerClassName,
    className,
    placeholder = "Search…",
    "aria-label": ariaLabel,
    ...props
  },
  ref,
) {
  const handleClear = React.useCallback(() => {
    if (onClear) {
      onClear();
    } else {
      onValueChange("");
    }
  }, [onClear, onValueChange]);

  return (
    <div className={cn("relative", containerClassName)}>
      <HugeiconsIcon
        icon={Search01Icon}
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/70"
        aria-hidden
      />
      <Input
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? (typeof placeholder === "string" ? placeholder : "Search")}
        className={cn(
          "bg-muted pl-9 text-sm",
          sizeVariant === "compact" ? "h-9 rounded-lg" : "h-11 rounded-search",
          value && "pr-9",
          className,
        )}
        {...props}
      />
      {value ? (
        <button
          type="button"
          onClick={handleClear}
          className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded-full cursor-pointer transition-colors"
          aria-label="Clear search"
        >
          <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
});

export { SearchInput };
