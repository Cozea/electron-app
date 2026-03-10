import { cn } from "@/lib/utils";
import type { CSSProperties, HTMLAttributes } from "react";

export type LoaderProps = HTMLAttributes<HTMLDivElement> & {
  size?: number;
};

export const Loader = ({ className, size, style, ...props }: LoaderProps) => (
  <div
    className={cn(
      "cozea-wave-loader inline-flex size-4 items-center justify-center text-current",
      className
    )}
    style={
      size
        ? ({
            ...style,
            width: size,
            height: size,
          } satisfies CSSProperties)
        : style
    }
    {...props}
  >
    <span className="cozea-wave-loader-dot" />
    <span className="cozea-wave-loader-dot" />
    <span className="cozea-wave-loader-dot" />
  </div>
);
