import {
  buildConversationRows,
  reuseConversationRows,
  type ConversationRowsInput,
  type ConversationRow,
  type TimelineMessage,
} from "./conversationRows";

function equalFields(a: object, b: object, omit: readonly string[] = []): boolean {
  const left = Object.keys(a).filter((key) => !omit.includes(key));
  const right = Object.keys(b).filter((key) => !omit.includes(key));
  return (
    left.length === right.length &&
    left.every((key) => Object.hasOwn(b, key) && Reflect.get(a, key) === Reflect.get(b, key))
  );
}
function sameContext(a: ConversationRowsInput, b: ConversationRowsInput): boolean {
  return (
    equalFields(a, b, ["entries", "latestTurn", "expanded"]) &&
    (a.latestTurn === b.latestTurn ||
      Boolean(
        a.latestTurn &&
        b.latestTurn &&
        a.latestTurn.turnId === b.latestTurn.turnId &&
        a.latestTurn.state === b.latestTurn.state &&
        a.latestTurn.startedAt === b.latestTurn.startedAt &&
        a.latestTurn.completedAt === b.latestTurn.completedAt,
      )) &&
    equalFields(a.expanded, b.expanded)
  );
}
type PatchTree = Map<number, { message?: TimelineMessage; children: PatchTree }>;

/**
 * Per-mounted-timeline cache. Immutable text/attachment replacements only patch
 * message-bearing rows; semantic changes use the full canonical projector.
 */
export function createConversationRowProjector(
  build: typeof buildConversationRows = buildConversationRows,
) {
  let previous: ConversationRowsInput | undefined;
  let rows: ConversationRow[] = [];
  let paths = new Map<string, number[][]>();
  function indexRows(items: readonly ConversationRow[], prefix: number[] = []) {
    items.forEach((row, index) => {
      const path = [...prefix, index];
      if (row.kind === "message" || row.kind === "assistant-meta") {
        const existing = paths.get(row.message.id) ?? [];
        existing.push(path);
        paths.set(row.message.id, existing);
      }
      if (row.kind === "turn-fold" || row.kind === "turn-fold-content")
        indexRows(row.children, path);
    });
  }
  function patch(items: ConversationRow[], tree: PatchTree): ConversationRow[] {
    const result = [...items];
    for (const [index, node] of tree) {
      const row = items[index]!;
      if (node.message && (row.kind === "message" || row.kind === "assistant-meta"))
        result[index] = { ...row, message: node.message };
      else if (row.kind === "turn-fold" || row.kind === "turn-fold-content")
        result[index] = { ...row, children: patch(row.children, node.children) };
    }
    return result;
  }
  return {
    project(input: ConversationRowsInput): ConversationRow[] {
      const changed = new Map<string, TimelineMessage>();
      let contentOnly =
        previous !== undefined &&
        sameContext(previous, input) &&
        previous.entries.length === input.entries.length;
      if (contentOnly && previous) {
        for (let i = 0; i < input.entries.length; i++) {
          const before = previous.entries[i]!,
            after = input.entries[i]!;
          if (before === after) continue;
          if (
            before.kind !== after.kind ||
            before.id !== after.id ||
            before.createdAt !== after.createdAt
          ) {
            contentOnly = false;
            break;
          }
          if (before.kind === "work" && after.kind === "work" && before.entry === after.entry)
            continue;
          if (
            before.kind === "proposed-plan" &&
            after.kind === "proposed-plan" &&
            before.proposedPlan === after.proposedPlan
          )
            continue;
          if (
            before.kind === "message" &&
            after.kind === "message" &&
            before.message === after.message
          )
            continue;
          if (
            before.kind !== "message" ||
            after.kind !== "message" ||
            !equalFields(before.message, after.message, ["text", "attachments"])
          ) {
            contentOnly = false;
            break;
          }
          if (before.message !== after.message) changed.set(after.message.id, after.message);
        }
      }
      if (contentOnly) {
        const tree: PatchTree = new Map();
        for (const [id, message] of changed) {
          for (const path of paths.get(id) ?? []) {
            let branch = tree;
            path.forEach((index, depth) => {
              let node = branch.get(index);
              if (!node) {
                node = { children: new Map() };
                branch.set(index, node);
              }
              if (depth === path.length - 1) node.message = message;
              branch = node.children;
            });
          }
        }
        if (tree.size) rows = patch(rows, tree);
      } else {
        const next = build(input);
        rows = reuseConversationRows(rows, next);
        paths = new Map();
        indexRows(rows);
      }
      previous = input;
      return rows;
    },
    clear() {
      previous = undefined;
      rows = [];
      paths = new Map();
    },
  };
}
