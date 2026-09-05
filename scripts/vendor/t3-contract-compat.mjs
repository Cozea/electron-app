/** Explicit schema syntax adaptation for Cozea's pinned Effect snapshot.
 * This changes construction APIs only; serialized protocol shapes stay upstream-owned.
 */
import ts from "typescript";

export function adaptT3Contract(name, source) {
  const tree = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  const edits = [];
  const replace = (node, text) => edits.push({ start: node.getStart(tree), end: node.end, text });
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(tree);
      if (callee === "Schema.Defect" && node.arguments.length === 0) {
        replace(node, "Schema.Defect");
        return;
      }
      if ((callee === "Schema.withDecodingDefault" || callee === "Schema.withDecodingDefaultKey") && node.arguments.length >= 1) {
        const value = node.arguments[0];
        if (ts.isCallExpression(value) && value.expression.getText(tree) === "Effect.succeed" && value.arguments.length === 1) {
          replace(value, `() => (${value.arguments[0].getText(tree).replaceAll("ProviderInstanceId.make(", "ProviderInstanceId.makeUnsafe(")})`);
          return;
        }
        throw new Error(`Review new Effect decoding default syntax in ${name}`);
      }
      if (callee === "Schema.withConstructorDefault" && node.arguments.length === 1) {
        const value = node.arguments[0];
        if (ts.isCallExpression(value) && value.expression.getText(tree) === "Effect.succeed" && value.arguments.length === 1) {
          replace(value, `() => Option.some(${value.arguments[0].getText(tree)})`);
          return;
        }
        throw new Error(`Review new Effect constructor default syntax in ${name}`);
      }
      if (/^(ProviderDriverKind|ProviderInstanceId)\.make$/.test(callee)) {
        replace(node.expression, callee.replace(/\.make$/, ".makeUnsafe"));
      }
    }
    if (ts.isNewExpression(node) && node.expression.getText(tree) === "SchemaIssue.InvalidValue" && node.arguments?.length === 1) {
      replace(node, `new SchemaIssue.InvalidValue(Option.none(), ${node.arguments[0].getText(tree)})`);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  let output = source;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  if ((output.includes("Option.none()") || output.includes("Option.some(")) && !source.includes('from "effect/Option"')) {
    output = 'import * as Option from "effect/Option";\n' + output;
  }
  if (!output.includes("Effect.")) output = output.replace(/^import \* as Effect from "effect\/Effect";\n/m, "");
  return output;
}
