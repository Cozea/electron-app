// Temporary deterministic source-edit transport for the isolated repair branch.
// Removed before final review. No shell evaluation, path traversal, or .git edits.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const batchPath = 'scripts/navigation-repair/batch.json';
const batch = JSON.parse(fs.readFileSync(batchPath, 'utf8'));
const modified = new Set();
function safePath(relative) {
  if (typeof relative !== 'string' || !/^(apps|shared|tests|scripts|docs)\//.test(relative) || relative.split('/').includes('..')) throw new Error(`Refusing source path: ${relative}`);
  const full = path.resolve(root, relative);
  if (!full.startsWith(root + path.sep)) throw new Error('Source path escapes repository');
  return full;
}
function blobHash(bytes) {
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
}
function uniqueOffset(text, anchor, file) {
  if (!anchor || text.split(anchor).length !== 2) throw new Error(`Expected one unique source anchor: ${file}`);
  return text.indexOf(anchor);
}
for (const operation of batch.operations) {
  const full = safePath(operation.path);
  const previous = fs.existsSync(full) ? fs.readFileSync(full) : null;
  if (operation.expectedSha && (!previous || blobHash(previous) !== operation.expectedSha)) throw new Error(`Unexpected source version: ${operation.path}`);
  if (operation.kind === 'replace') {
    if (!previous || !operation.search) throw new Error(`Missing replacement input: ${operation.path}`);
    const text = previous.toString('utf8');
    const count = text.split(operation.search).length - 1;
    if (count !== (operation.count ?? 1)) throw new Error(`Expected ${operation.count ?? 1} anchors, found ${count}: ${operation.path}`);
    fs.writeFileSync(full, text.split(operation.search).join(operation.replacement));
  } else if (operation.kind === 'replaceRegion') {
    if (!previous) throw new Error(`Missing source: ${operation.path}`);
    const text = previous.toString('utf8');
    const start = uniqueOffset(text, operation.start, operation.path);
    const end = uniqueOffset(text, operation.end, operation.path);
    if (end <= start) throw new Error(`Invalid source region: ${operation.path}`);
    fs.writeFileSync(full, text.slice(0, start) + operation.replacement + text.slice(end));
  } else if (operation.kind === 'copy') {
    if (previous && !operation.expectedSha) throw new Error(`Refusing unchecked overwrite: ${operation.path}`);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.copyFileSync(safePath(operation.from), full);
  } else if (operation.kind === 'remove') {
    if (!operation.expectedSha) throw new Error('Deletion requires an expected source hash');
    fs.unlinkSync(full);
  } else throw new Error(`Unknown source operation: ${operation.kind}`);
  modified.add(operation.path);
}
fs.unlinkSync(batchPath);
console.log(JSON.stringify({ modified: [...modified], removedBatch: batchPath }));
