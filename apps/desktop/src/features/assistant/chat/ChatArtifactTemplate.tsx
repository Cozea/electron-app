import { createContext, useContext, type ReactNode } from "react";
import {
  codexArtifactTemplatePresentationLabel,
  type CodexArtifactTemplate,
} from "./chatArtifactTemplates";

const TemplateContext = createContext<((template: CodexArtifactTemplate) => void) | undefined>(
  undefined,
);

/** The callback only prepares the existing composer draft; it never submits it. */
export function ChatArtifactTemplateProvider({
  onUse,
  children,
}: {
  onUse?: (template: CodexArtifactTemplate) => void;
  children: ReactNode;
}) {
  return <TemplateContext.Provider value={onUse}>{children}</TemplateContext.Provider>;
}

export function ChatArtifactTemplateCard({ template }: { template: CodexArtifactTemplate }) {
  const onUse = useContext(TemplateContext);
  return (
    <div
      className="my-2 flex min-w-0 items-center gap-3 rounded-xl border border-border/50 px-3 py-2"
      aria-label={`${template.displayName} template`}
      data-artifact-kind={template.artifactKind}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{template.displayName}</div>
        <div className="text-xs text-muted-foreground">
          {codexArtifactTemplatePresentationLabel(template.artifactKind)}
        </div>
      </div>
      {onUse ? (
        <button
          type="button"
          className="shrink-0 rounded-md px-2 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onUse(template)}
        >
          Use template
        </button>
      ) : (
        <span className="text-xs text-muted-foreground">
          Use ${template.skillName} in your next prompt
        </span>
      )}
    </div>
  );
}
