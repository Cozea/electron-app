const fs = require('fs');

let content = fs.readFileSync('src/components/wizard/steps/ReviewStep.tsx', 'utf8');

// Remove Badge import
content = content.replace(/import { Badge } from '@\/components\/ui\/badge'\n/, '');

// Move SectionLabel outside ReviewStep
// It is currently defined as:
//   const SectionLabel = ({ children }: { children: React.ReactNode }) => (
//     <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-500 mb-6">
//       {children}
//     </div>
//   )
content = content.replace(/  const SectionLabel = \(\{ children \}: \{ children: React\.ReactNode \}\) => \(\n    <div className="text-\[10px\] font-semibold tracking-\[0\.1em\] uppercase text-zinc-500 mb-6">\n      \{children\}\n    <\/div>\n  \)\n\n/, '');

// Add it to top
const SectionLabelStr = `const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-500 mb-6">
    {children}
  </div>
)

`;
content = content.replace(/export function ReviewStep/, SectionLabelStr + 'export function ReviewStep');

// Remove fillHeight from props destructuring
content = content.replace(/  fillHeight = false,\n\}: ReviewStepProps\) \{/, '}: ReviewStepProps) {');

// Remove fillHeight from interface
content = content.replace(/  fillHeight\?: boolean\n/, '');

// Fix useEffect missing dependency
//   state.repoSource?.repoUrl,
//   userId,
// ])
content = content.replace(/    state\.repoSource\?\.repoUrl,\n    userId,\n  \]\)/, '    state.repoSource?.repoUrl,\n    state.repoSource?.branch,\n    userId,\n  ])');

// Fix lastCommitLabel
content = content.replace(/  const lastCommitLabel = formatRelativeLastCommit\(state\.repoSource\?\.lastActivityAt\)\n/, '');

fs.writeFileSync('src/components/wizard/steps/ReviewStep.tsx', content);
