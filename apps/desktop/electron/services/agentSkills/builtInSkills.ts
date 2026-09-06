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
      "id": "auth_session",
      "label": "session.ts",
      "file_type": "code",
      "source_file": "auth/session.ts",
      "source_location": "L1",
      "community": 0,
      "community_name": "Session Lifecycle",
      "norm_label": "session.ts",
      "rationale": null,
      "_origin": "ast"
    },
    {
      "id": "auth_session_createsession",
      "label": "createSession()",
      "file_type": "code",
      "source_file": "auth/session.ts",
      "source_location": "L42",
      "community": 0,
      "community_name": "Session Lifecycle",
      "norm_label": "createsession",
      "rationale": null,
      "_origin": "ast",
      "_callable": true,
      "_callable_class": null
    }
  ],
  "links": [
    {
      "source": "auth_session",
      "target": "auth_session_createsession",
      "relation": "contains",
      "weight": 1,
      "confidence": "EXTRACTED",
      "confidence_score": 1,
      "source_file": "auth/session.ts",
      "source_location": "L42",
      "_origin": "ast"
    },
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

- \`contains\` — a file holds a symbol, or a symbol holds a nested one. **The spine of the
  map.** In a well built map this is the single most common relation, around a third of all
  links. A map without it is a pile of symbols with no sense of where anything lives.
- \`calls\`, \`imports\`, \`imports_from\`, \`re_exports\`, \`defines\`, \`extends\`, \`method\` —
  structural, read directly from code. \`imports_from\` names the module a symbol came from;
  \`method\` ties a method to its class.
- \`indirect_call\` — reached through a handler, callback or dispatch table rather than a
  direct call site.
- \`implements\` — a thing realises a named concept or interface
- \`references\` — one thing mentions another
- \`cites\` — a paper or document points at external work
- \`rationale_for\` — a decision explains a thing
- \`conceptually_related_to\`, \`semantically_similar_to\` — same idea, different place
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
3. **Emit a node for the file itself**, then a node for each symbol inside it, then link
   file to symbol with \`contains\`. Nest further where the code nests: a function defined
   inside another is contained by it, not by the file. This hierarchy is most of what makes a
   map navigable, and skipping it costs roughly a third of the links.
   - File node: \`label\` is the file name (\`session.ts\`), \`source_location\` is \`L1\`.
   - Symbol node: \`label\` carries \`()\` for callables (\`createSession()\`), \`_callable\` is
     \`true\`, and \`_callable_class\` names the owning class or is \`null\`.
   - Set \`_origin\` to \`ast\` for anything read out of code, \`curated\` for anything you
     reasoned into existence.
4. Add the relations you can see. Structural ones from code, the rest from what documents and
   diagrams actually say.
   - Carry \`source_file\` and \`source_location\` on **every link**, naming the file the
     evidence was read from. Updates depend on this: it is how a later pass knows which links
     belong to a file it is about to re-read.
   - When an import or call leaves the set of files you extracted, emit a node for the target
     **file** and point the link at that. Never point a link at an id you have not created,
     and never invent symbol nodes for a file you have not read: a link that resolves to
     nothing is worse than a coarser link that resolves.
   - For a document or image node that came from somewhere citable, record \`source_url\`,
     \`author\`, \`contributor\` and \`captured_at\` when you know them.
5. Deduplicate by \`id\`. The same thing described in code and in a doc is one node with both
   sources, not two nodes.
6. Cluster into communities: group nodes that link to each other far more than to the rest, then
   give each group a short human name for its job ("Session Lifecycle", not "Community 3").
   Assign the index to \`community\` and the name to \`community_name\`. Aim for groups of
   roughly 5 to 25 nodes; a handful of giant communities tells the reader nothing, and one
   community per node tells them nothing either. **Every node gets a name**, not just the big
   groups: an unnamed community reads as a hole in the map.
7. Write the file, creating \`graphify-out/\` if needed.

Prefer breadth over depth. A map covering the whole project shallowly is more useful than a
perfect map of one directory.

### What a finished map looks like

Check your output against these before writing. They are what real maps of this shape measure,
and falling far short of them means extraction stopped early rather than the project being small:

- **Every source file that holds anything is a node**, and its symbols hang off it.
- **Links per node between about 1.5 and 2.5.** Below 1 the map is a list, not a graph.
- **\`contains\` is roughly a third of all links**, and \`calls\` plus the import family most
  of the rest.
- **\`EXTRACTED\` dominates.** Structural edges read out of code should be the bulk of the
  graph; if most of your links are \`INFERRED\` you are guessing, not reading.
- **Every node carries \`community\` and \`community_name\`.**
- **No link points at an id that is not in \`nodes\`.**

If the project has \`scripts/score-memory-map.mjs\`, run it on what you wrote and fix what it
reports before you call the map done.

## Never destroy a good map

Check before writing, because a failed extraction that overwrites a working map costs more than
no update at all:

- If your extraction produced zero nodes, write nothing and say why.
- If it produced dramatically fewer nodes than the existing graph, stop and report the
  difference rather than shrinking the map silently. A real deletion is gradual; a cliff means
  extraction failed.
- Never write a partial file. Build the whole object, then write once.

## Keeping it current

**Updating must not re-read the project.** A rebuild of a large repo is minutes of tokens; an
update should touch only the files git says moved. If you find yourself walking the whole tree
on an update, stop: you are rebuilding, and it will be slower and will churn ids.

1. Read the existing graph and take \`built_at_commit\` from it.
2. Ask git exactly what moved, with status letters, not just names:

   \`\`\`
   git diff --name-status <built_at_commit> HEAD
   \`\`\`

   \`A\` added, \`M\` modified, \`D\` deleted, \`R\` renamed. If the command fails, or
   \`built_at_commit\` is missing or no longer in history, fall back to a full build and say so.
   If it returns nothing, the map is current: change nothing and say that.
3. Let **touched** be the added, modified and renamed paths, and **gone** the deleted ones.
4. Drop from the graph:
   - every node whose \`source_file\` is in touched or gone,
   - every link whose \`source_file\` is in touched or gone,
   - every remaining link that now points at an id no longer present. This last one is the step
     that is easy to miss: a link recorded against an untouched file can still name a symbol
     that has just been deleted, and leaving it behind puts a dangling edge in the map.
5. Re-extract **only the touched files**, exactly as a full build would, and add their nodes
   and links back.
6. Leave every other node and link byte for byte as it was, \`community\` and
   \`community_name\` included. Re-cluster only when the node set moved by more than about a
   tenth, and say so when you do, because re-clustering renames communities and the tile shows
   that as change.
7. Set \`built_at_commit\` to \`git rev-parse HEAD\` and write the file once.

A rename is a delete plus an add: ids derive from the path, so the old ids go and new ones
arrive. That is honest, and the tile will show it.

Preserving untouched ids is what makes the Memory tile's new and changed colouring meaningful.
An id must be stable: derive it from path plus symbol, lowercased, non-alphanumerics as
underscores. A churning id reads as delete-plus-add and destroys the signal.

The tile decides what is new or changed by comparing \`label\`, \`source_file\`,
\`source_location\` and \`community_name\` against the previous build. The first three move only
when the code moves, which is what you want. \`community_name\` is the fragile one: re-cluster
needlessly and every node in the project turns "changed" while nothing actually moved. That is
the strongest reason to leave untouched communities alone.

## Scale

Do not truncate a real project to keep the file small. Maps of tens of thousands of nodes are
normal for a large repo, and the Memory tile already renders only the busiest few thousand, so
detail you record is never wasted even when it is not all drawn at once.

Past roughly 40,000 nodes, start dropping private helpers before anything else, and keep every
exported and cross-file symbol. Breadth first: a file with no node at all is a hole, while a
file whose private helpers were skipped is still findable.

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
