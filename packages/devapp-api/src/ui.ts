import {
  createElement,
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

export const DEV_APP_UI_API_VERSION = 1 as const;

function mergeClassName(base: string, value?: string): string {
  return value ? `${base} ${value}` : base;
}

export interface DevAppPanelProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export const Panel = forwardRef<HTMLDivElement, DevAppPanelProps>(function Panel(
  { className, ...props },
  ref,
) {
  return createElement("div", {
    ...props,
    ref,
    "data-cozea-devapp-panel": "",
    className: mergeClassName("cozea-devapp-panel", className),
  });
});

export interface DevAppPanelToolbarProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
  actions?: ReactNode;
}

export const PanelToolbar = forwardRef<HTMLDivElement, DevAppPanelToolbarProps>(
  function PanelToolbar(
    { title, description, actions, children, className, ...props },
    ref,
  ) {
    return createElement(
      "div",
      {
        ...props,
        ref,
        "data-cozea-devapp-toolbar": "",
        className: mergeClassName("cozea-devapp-toolbar", className),
      },
      createElement(
        "div",
        { "data-cozea-devapp-toolbar-copy": "" },
        title ? createElement("strong", null, title) : null,
        description ? createElement("span", null, description) : null,
      ),
      children,
      actions ? createElement("div", { "data-cozea-devapp-toolbar-actions": "" }, actions) : null,
    );
  },
);

export type DevAppButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export const Button = forwardRef<HTMLButtonElement, DevAppButtonProps>(function Button(
  { className, type = "button", ...props },
  ref,
) {
  return createElement("button", {
    ...props,
    ref,
    type,
    "data-cozea-devapp-button": "",
    className: mergeClassName("cozea-devapp-button", className),
  });
});

export type DevAppInputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, DevAppInputProps>(function Input(
  { className, ...props },
  ref,
) {
  return createElement("input", {
    ...props,
    ref,
    "data-cozea-devapp-input": "",
    className: mergeClassName("cozea-devapp-input", className),
  });
});

export interface DevAppEmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  action?: ReactNode;
}

export const EmptyState = forwardRef<HTMLDivElement, DevAppEmptyStateProps>(
  function EmptyState({ title, description, action, className, ...props }, ref) {
    return createElement(
      "div",
      {
        ...props,
        ref,
        "data-cozea-devapp-empty-state": "",
        className: mergeClassName("cozea-devapp-empty-state", className),
      },
      createElement("strong", null, title),
      description ? createElement("p", null, description) : null,
      action,
    );
  },
);
