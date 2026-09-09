// Read actual declarations using the TypeScript compiler, including inline groups.
const ts = require(process.env.AID_TYPESCRIPT_ROOT || 'typescript');
const fs = require('fs');
const file = ts.createSourceFile('aid-sdk.d.ts', fs.readFileSync(process.argv[2], 'utf8'), ts.ScriptTarget.Latest, true);
const result = [];
function members(nodes, prefix) {
  for (const node of nodes) {
    if (ts.isMethodSignature(node)) result.push({
      name: `${prefix}.${node.name.getText(file)}`,
      parameters: node.parameters.map(p => p.getText(file)),
      returns: node.type.getText(file),
    });
    else if (ts.isPropertySignature(node) && node.type && ts.isTypeLiteralNode(node.type)) {
      members(node.type.members, `${prefix}.${node.name.getText(file)}`);
    }
  }
}
for (const node of file.statements) {
  if (ts.isInterfaceDeclaration(node) && node.name.text !== 'HostApi') members(node.members, node.name.text);
}
process.stdout.write(JSON.stringify(result, null, 2));
