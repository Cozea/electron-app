import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

// This execution adapter creates unreachable Git objects only. A separately
// reviewed, non-forced connector ref update is required to publish the candidate.
const repository = "Cozea/electron-app";
const head = process.env.EXPECTED_HEAD;
const token = process.env.GH_TOKEN;
if (!head || !/^[a-f0-9]{40}$/.test(head) || !token || process.env.GITHUB_REPOSITORY !== repository) throw new Error("Expected scoped CI authority and immutable head");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
if (git("rev-parse", "HEAD").trim() !== head) throw new Error("Execution checkout changed");
const manifest = JSON.parse(readFileSync(".agent/collaboration-candidate.json", "utf8"));
if (!Array.isArray(manifest.paths) || manifest.paths.length === 0 || manifest.paths.length > 100 || typeof manifest.message !== "string" || manifest.message.length > 1024) throw new Error("Invalid candidate manifest");
const paths = [...new Set(manifest.paths)];
for (const path of paths) {
  if (typeof path !== "string" || path.includes("..") || path.includes("\\") || /[\0\r\n]/.test(path) || !/^(shared\/|cloudflare\/worker\/src\/|convex\/|apps\/desktop\/(electron\/collaboration\/|src\/)|tests\/collaboration\/|docs\/collaboration\/)/.test(path)) throw new Error("Candidate path is outside the approved implementation surface");
}
git("add", "--", ...paths);
const staged = git("diff", "--cached", "--name-only", "-z").split("\0").filter(Boolean);
if (staged.some(path => !paths.includes(path)) || !staged.length) throw new Error("Unexpected staged candidate changes");
const api = async (route, body) => {
  const response = await fetch(`https://api.github.com/repos/${repository}${route}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(`Git object API failed (${response.status}, ${route})`);
  return response.json();
};
const parent = await api(`/git/commits/${head}`);
const tree = [];
for (const path of staged) {
  const entry = git("ls-files", "--stage", "--", path).trim();
  if (!entry) { tree.push({ path, mode: "100644", type: "blob", sha: null }); continue; }
  const [mode, expectedBlob] = entry.split(/\s+/);
  if (mode !== "100644" && mode !== "100755") throw new Error("Candidate must contain regular source files");
  const bytes = execFileSync("git", ["show", `:${path}`], { maxBuffer: 32 * 1024 * 1024 });
  const blob = await api("/git/blobs", { content: bytes.toString("base64"), encoding: "base64" });
  if (blob.sha !== expectedBlob) throw new Error("Uploaded source blob did not match the tested bytes");
  tree.push({ path, mode, type: "blob", sha: blob.sha });
}
const result = await api("/git/trees", { base_tree: parent.tree.sha, tree });
const localTree = git("write-tree").trim();
if (result.sha !== localTree) throw new Error("Remote tree differs from tested working tree");
const evidence = { schema: 1, parent: head, tree: result.sha, message: manifest.message, paths: staged, createdAt: new Date().toISOString(), branchUpdated: false };
mkdirSync(".agent/collaboration-evidence", { recursive: true });
writeFileSync(".agent/collaboration-evidence/candidate.json", JSON.stringify(evidence, null, 2) + "\n");
console.log(`CANDIDATE_PARENT=${head}`);
console.log(`CANDIDATE_TREE=${result.sha}`);
console.log(`CANDIDATE_MESSAGE=${manifest.message}`);
console.log("No branch was advanced. The connector must inspect and publish this tree explicitly.");
