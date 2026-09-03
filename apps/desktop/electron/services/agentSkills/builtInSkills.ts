import type { AgentSkillProvider } from '../../../../../shared/electronApiTypes'

/**
 * Skills Cozea ships and seeds into the user's library on first run.
 *
 * `memory-skill` is Cozea's own: it instructs an agent to build and maintain a
 * project memory graph using nothing but the tools every agent already has —
 * reading files and writing JSON. That independence is the point. A skill that
 * shells out to an external CLI only works for users who installed it, whereas
 * project memory has to work in every agent tile on first launch.
 *
 * It is not a port of any third-party skill. It targets the same widely-used
 * node-link JSON shape so other graph tooling can read the output, and so a
 * user who prefers a different memory skill can switch to it without the
 * Memory tile changing.
 */

export interface BuiltInSkillDefinition {
  /** Stable identity for seeding; never shown to the user. */
  key: string
  name: string
  description: string
  instructions: string
  compatibleProviders: AgentSkillProvider[]
}

export const ALL_SKILL_PROVIDERS: AgentSkillProvider[] = ['claude', 'codex', 'cursor', 'opencode']

export const MEMORY_SKILL_KEY = 'cozea.memory-skill'
export const MEMORY_SKILL_NAME = 'memory-skill'

const MEMORY_SKILL_INSTRUCTIONS = `Build and maintain this project's memory map: a knowledge
graph of everything the project knows about itself, shared by every agent working here and
rendered by Cozea's Memory tile.

The map lives at \`graphify-out/graph.json\`. Nothing outside this skill is needed to produce
it: you read files and write JSON.

## Use it before you read files

For any question about architecture, what calls what, where an idea lives, or how a change
ripples, read the map first. It encodes relationships that are expensive to rediscover by
opening files at random.

The map says **where to look and what connects to what**. It does not carry current file
contents. Once it points you at a file, open that file for the exact detail, and if the file
disagrees with the map, the file wins and the map needs updating.

If \`graphify-out/graph.json\` does not exist, say so rather than guessing, and offer to build it.

## Schema

One JSON object. Keep the shape exactly, so the Memory tile and other graph tools can read it:

\`\`\`json
{
  "directed": false,
  "multigraph": false,
  "graph": {},
  "built_at_commit": "<git rev-parse HEAD>",
  "nodes": [
    {
      "id": "auth_session_createsession",
      "label": "createSession",
      "file_type": "code",
      "source_file": "auth/session.ts",
      "source_location": "L42",
      "community": 0,
      "community_name": "Session Lifecycle",
      "norm_label": "createsession",
      "rationale": null,
      "_origin": "ast"
    }
  ],
  "links": [
    {
      "source": "auth_session_createsession",
      "target": "auth_session_signtoken",
      "relation": "calls",
      "weight": 1,
      "confidence": "EXTRACTED",
      "confidence_score": 1,
      "context": "call",
      "source_file": "auth/session.ts",
      "source_location": "L47",
      "_origin": "ast"
    }
  ],
  "hyperedges": []
}
\`\`\`

## The six memory types

\`file_type\` MUST be exactly one of these six. Nothing else. The vocabulary is shared with
other memory skills, so a map built by one can be read and continued by another; inventing a
type breaks that.

| type | what it holds | what to extract |
| --- | --- | --- |
| \`code\` | source files | exported and top-level symbols: functions, classes, components, types, modules |
| \`document\` | READMEs, specs, decks, notes written for people | the named things the document is about, not the document itself |
| \`paper\` | external research or reference material | claims, methods and cited works |
| \`image\` | diagrams and screenshots that carry meaning | the labelled parts and what they connect |
| \`rationale\` | why something exists: intent, trade-offs, decisions | the decision as a short statement |
| \`concept\` | a named idea, principle or pattern the project uses | the concept itself |

Two rules that keep the map honest:

1. A node is a **named thing**, never a fragment. "Session rotation on privilege change" is a
   node. "Paragraph 3 of the security doc" is not. If you cannot name it, do not add it.
2. \`concept\` is for real ideas. Do not emit a node for every string in a config file: a
   \`tsconfig.json\` \`lib\` array is not eight concepts.

Where a decision explains an existing node, prefer setting that node's \`rationale\` field over
creating a separate \`rationale\` node. Create a \`rationale\` node only when the decision stands
on its own and other things point at it.

## Relations

\`relation\` MUST be one of:

- \`calls\`, \`imports\`, \`defines\`, \`extends\` — structural, read directly from code
- \`implements\` — a thing realises a named concept or interface
- \`references\` — one thing mentions another
- \`cites\` — a paper or document points at external work
- \`rationale_for\` — a decision explains a thing
- \`conceptually_related_to\` — same idea, different place
- \`shares_data_with\` — two things read or write the same state

Prefer the most specific relation that is true. \`references\` is the fallback, not the default.

### Confidence

- \`EXTRACTED\`, score 1: read directly from the source. The call is in the file.
- \`INFERRED\`, score 0.5: concluded from naming, structure or prose.
- \`AMBIGUOUS\`, score 0.25: plausible but unresolved, such as two symbols with the same name.

Never label a guess EXTRACTED. A map that overstates itself is worse than a smaller honest one,
because it cannot be trusted where it matters.

### Hyperedges

When three or more things participate in one relationship, record it once in \`hyperedges\`
rather than as a mesh of pairs:

\`\`\`json
{ "id": "checkout_flow", "label": "Checkout flow", "nodes": ["cart", "payment", "receipt"],
  "relation": "participate_in", "confidence": "INFERRED", "confidence_score": 0.5 }
\`\`\`

Use \`participate_in\`, \`implement\` or \`form\`. Leave the array empty if nothing qualifies.

## Building it

1. Record the commit: \`git rev-parse HEAD\` into \`built_at_commit\`.
2. Walk the project, skipping anything git ignores plus \`node_modules\`, build output, vendored
   code, lockfiles and minified bundles.
3. Extract per file according to the table above. Code first: it is the spine everything else
   attaches to.
4. Add the relations you can see. Structural ones from code, the rest from what documents and
   diagrams actually say.
5. Deduplicate by \`id\`. The same thing described in code and in a doc is one node with both
   sources, not two nodes.
6. Cluster into communities: group nodes that link to each other far more than to the rest, then
   give each group a short human name for its job ("Session Lifecycle", not "Community 3").
   Assign the index to \`community\` and the name to \`community_name\`.
7. Write the file, creating \`graphify-out/\` if needed.

Prefer breadth over depth. A map covering the whole project shallowly is more useful than a
perfect map of one directory.

## Never destroy a good map

Check before writing, because a failed extraction that overwrites a working map costs more than
no update at all:

- If your extraction produced zero nodes, write nothing and say why.
- If it produced dramatically fewer nodes than the existing graph, stop and report the
  difference rather than shrinking the map silently. A real deletion is gradual; a cliff means
  extraction failed.
- Never write a partial file. Build the whole object, then write once.

## Keeping it current

After work that adds, removes or moves things, update rather than rebuild:

1. Read the existing graph.
2. Re-extract only what changed since \`built_at_commit\`: \`git diff --name-only <commit> HEAD\`.
3. Replace those files' nodes and links, leave the rest untouched, refresh \`built_at_commit\`.
4. Re-cluster only if the shape changed materially.

Preserving untouched ids is what makes the Memory tile's new and changed colouring meaningful.
An id must be stable: derive it from path plus symbol, lowercased, non-alphanumerics as
underscores. A churning id reads as delete-plus-add and destroys the signal.

## Scale

Cap at roughly 4000 nodes. Past that, keep exported and cross-file symbols and drop private
helpers. A map too large to read is a map nobody uses.

## Reporting

After building or updating, say in one short paragraph: how many nodes and links, the largest
communities by name, and what changed since the previous build. If you skipped anything
significant, say what and why.`

export const BUILT_IN_SKILLS: BuiltInSkillDefinition[] = [
  {
    key: MEMORY_SKILL_KEY,
    name: MEMORY_SKILL_NAME,
    description:
      "Build, consult, and maintain this project's memory map so every agent shares the same picture of the codebase.",
    instructions: MEMORY_SKILL_INSTRUCTIONS,
    compatibleProviders: ALL_SKILL_PROVIDERS,
  },
]
