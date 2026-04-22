const fs = require('fs');
const path = require('path');

const filePath = '/Users/admin/Downloads/electron-app-main/src/features/projects/components/assistant/chat/ComposerPromptEditor.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add imports
content = content.replace(
  'import { formatInlineTerminalContextLabel } from "@/stores/terminalContext";',
  `import { formatInlineTerminalContextLabel } from "@/stores/terminalContext";
import type { ServerProviderSkill } from "@cozea/assistant-contracts";
import { formatProviderSkillDisplayName } from "../providerSkillPresentation";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";`
);

// 2. Add ComposerSkillNode and related functions before splitPromptIntoComposerSegments
const skillNodeCode = `
const COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME = "mx-0.5 inline-flex cursor-default items-center gap-1 rounded bg-blue-500/15 py-0.5 pl-1.5 pr-2 font-mono text-[10px] leading-none text-blue-500 ring-1 ring-inset ring-blue-500/20";
const SKILL_CHIP_ICON_SVG = \`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>\`;

function resolveSkillDescription(
  skill: Pick<ServerProviderSkill, "shortDescription" | "description">,
): string | null {
  const shortDescription = skill.shortDescription?.trim();
  if (shortDescription) {
    return shortDescription;
  }
  const description = skill.description?.trim();
  return description || null;
}

type ComposerSkillMetadata = {
  label: string;
  description: string | null;
};

function skillMetadataByName(
  skills: ReadonlyArray<ServerProviderSkill>,
): ReadonlyMap<string, ComposerSkillMetadata> {
  return new Map(
    skills.map((skill) => [
      skill.name,
      {
        label: formatProviderSkillDisplayName(skill),
        description: resolveSkillDescription(skill),
      },
    ]),
  );
}

function ComposerSkillDecorator(props: { skillLabel: string; skillDescription: string | null }) {
  const chip = (
    <span
      className={COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME}
      contentEditable={false}
      spellCheck={false}
      data-composer-skill-chip="true"
    >
      <span
        aria-hidden="true"
        className={COMPOSER_INLINE_CHIP_ICON_CLASS_NAME}
        dangerouslySetInnerHTML={{ __html: SKILL_CHIP_ICON_SVG }}
      />
      <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>{props.skillLabel}</span>
    </span>
  );

  if (!props.skillDescription) {
    return chip;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup side="top" className="max-w-[30rem] whitespace-normal leading-tight">
        {props.skillDescription}
      </TooltipPopup>
    </Tooltip>
  );
}

type SerializedComposerSkillNode = Spread<
  {
    skillName: string;
    skillLabel?: string;
    skillDescription?: string;
    type: "composer-skill";
    version: 1;
  },
  SerializedDecoratorNode
>;

class ComposerSkillNode extends DecoratorNode<ReactElement> {
  __skillName: string;
  __skillLabel: string;
  __skillDescription: string | null;

  static override getType(): string {
    return "composer-skill";
  }

  static override clone(node: ComposerSkillNode): ComposerSkillNode {
    return new ComposerSkillNode(
      node.__skillName,
      node.__skillLabel,
      node.__skillDescription,
      node.__key,
    );
  }

  static override importJSON(serializedNode: SerializedComposerSkillNode): ComposerSkillNode {
    return $createComposerSkillNode(
      serializedNode.skillName,
      serializedNode.skillLabel ?? serializedNode.skillName,
      serializedNode.skillDescription ?? null,
    ).updateFromJSON(serializedNode);
  }

  constructor(
    skillName: string,
    skillLabel: string,
    skillDescription: string | null,
    key?: NodeKey,
  ) {
    super(key);
    const normalizedSkillName = skillName.startsWith("$") ? skillName.slice(1) : skillName;
    this.__skillName = normalizedSkillName;
    this.__skillLabel = skillLabel;
    this.__skillDescription = skillDescription;
  }

  override exportJSON(): SerializedComposerSkillNode {
    return {
      ...super.exportJSON(),
      skillName: this.__skillName,
      skillLabel: this.__skillLabel,
      ...(this.__skillDescription ? { skillDescription: this.__skillDescription } : {}),
      type: "composer-skill",
      version: 1,
    };
  }

  override createDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = "inline-flex align-middle leading-none";
    return dom;
  }

  override updateDOM(): false {
    return false;
  }

  override getTextContent(): string {
    return \`$\${this.__skillName}\`;
  }

  override isInline(): true {
    return true;
  }

  override decorate(): ReactElement {
    return (
      <ComposerSkillDecorator
        skillLabel={this.__skillLabel}
        skillDescription={this.__skillDescription}
      />
    );
  }
}

function $createComposerSkillNode(
  skillName: string,
  skillLabel: string,
  skillDescription: string | null,
): ComposerSkillNode {
  return $applyNodeReplacement(new ComposerSkillNode(skillName, skillLabel, skillDescription));
}

function skillSignature(skills: ReadonlyArray<ServerProviderSkill>): string {
  return skills
    .map((skill) =>
      [
        skill.name,
        skill.displayName ?? "",
        skill.shortDescription ?? "",
        skill.description ?? "",
        skill.path,
        skill.scope ?? "",
        skill.enabled ? "1" : "0",
      ].join("\\u0000"),
    )
    .join("\\u0001");
}

function $isComposerSkillNode(
  node: LexicalNode | null | undefined,
): node is ComposerSkillNode {
  return node instanceof ComposerSkillNode;
}
`;

content = content.replace(
  'function splitPromptIntoComposerSegments(',
  skillNodeCode + '\nfunction splitPromptIntoComposerSegments('
);

// 3. Update $setComposerEditorPrompt
content = content.replace(
  'export function $setComposerEditorPrompt(\n  prompt: string,\n  terminalContexts: ReadonlyArray<TerminalContextDraft>,\n): void {',
  'export function $setComposerEditorPrompt(\n  prompt: string,\n  terminalContexts: ReadonlyArray<TerminalContextDraft>,\n  skillMetadata: ReadonlyMap<string, ComposerSkillMetadata>,\n): void {'
);

content = content.replace(
  `    if (segment.type === "terminal-context") {
      if (segment.context) {
        paragraph.append($createComposerTerminalContextNode(segment.context));
      }
      continue;
    }`,
  `    if (segment.type === "skill") {
      const metadata = skillMetadata.get(segment.name);
      paragraph.append(
        $createComposerSkillNode(
          segment.name,
          metadata?.label ?? formatProviderSkillDisplayName({ name: segment.name } as any),
          metadata?.description ?? null,
        ),
      );
      continue;
    }
    if (segment.type === "terminal-context") {
      if (segment.context) {
        paragraph.append($createComposerTerminalContextNode(segment.context));
      }
      continue;
    }`
);

// 4. Update Props
content = content.replace(
  'terminalContexts: ReadonlyArray<TerminalContextDraft>;',
  'terminalContexts: ReadonlyArray<TerminalContextDraft>;\n  skills: ReadonlyArray<ServerProviderSkill>;'
);

// 5. Update inside ComposerPromptEditor
content = content.replace(
  'const { cursor, editorRef, disabled, onCommandKeyDown, onChange, onPaste, placeholder, terminalContexts, value } = props;',
  'const { cursor, editorRef, disabled, onCommandKeyDown, onChange, onPaste, placeholder, terminalContexts, skills, value } = props;'
);

content = content.replace(
  'const terminalContextsSignatureRef = useRef(terminalContextsSignature);',
  `const terminalContextsSignatureRef = useRef(terminalContextsSignature);
  const skillsSignatureText = skillSignature(skills);
  const skillsSignatureRef = useRef(skillsSignatureText);
  const skillMetadataRef = useRef(skillMetadataByName(skills));
  useEffect(() => {
    skillMetadataRef.current = skillMetadataByName(skills);
  }, [skills]);`
);

content = content.replace(
  'terminalContextsSignatureRef.current = terminalContextsSignature;',
  `terminalContextsSignatureRef.current = terminalContextsSignature;
    skillsSignatureRef.current = skillsSignatureText;`
);

content = content.replace(
  '$setComposerEditorPrompt(value, terminalContexts);',
  '$setComposerEditorPrompt(value, terminalContexts, skillMetadataRef.current);'
);

content = content.replace(
  'const contextsChanged = terminalContextsSignatureRef.current !== terminalContextsSignature;',
  'const contextsChanged = terminalContextsSignatureRef.current !== terminalContextsSignature;\n    const skillsChanged = skillsSignatureRef.current !== skillsSignatureText;'
);

content = content.replace(
  'if (previousSnapshot.value === value && !contextsChanged && !isFocused) {',
  'if (previousSnapshot.value === value && !contextsChanged && !skillsChanged && !isFocused) {'
);

content = content.replace(
  'previousSnapshot.value !== value || contextsChanged;',
  'previousSnapshot.value !== value || contextsChanged || skillsChanged;'
);

content = content.replace(
  'cursor, editor, terminalContexts, terminalContextsSignature, value',
  'cursor, editor, terminalContexts, terminalContextsSignature, skillsSignatureText, value'
);

// 6. Update nodes in LexicalComposer
content = content.replace(
  'nodes: [ComposerMentionNode, ComposerTerminalContextNode],',
  'nodes: [ComposerMentionNode, ComposerSkillNode, ComposerTerminalContextNode],'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log("Patch applied successfully.");
