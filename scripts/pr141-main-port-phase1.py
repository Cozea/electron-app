#!/usr/bin/env python3
from pathlib import Path
import re
import subprocess

ARCHIVE = "origin/archive/pr141-pre-main-port"


def old(path: str) -> str:
    return subprocess.check_output(["git", "show", f"{ARCHIVE}:{path}"], text=True)


def write(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def principalize(text: str) -> str:
    replacements = [
        ("createdByUserId", "createdByPrincipalId"),
        ("commitLeaseUserId", "commitLeasePrincipalId"),
        ("publishedByUserId", "publishedByPrincipalId"),
        ("actorUserId", "actorPrincipalId"),
        ("by_session_and_user", "by_session_and_principal"),
        ("by_project_and_user", "by_project_and_principal"),
        ("by_user_and_last_seen", "by_principal_and_last_seen"),
        ('Id<"users">', 'Id<"devicePrincipals">'),
        ('v.id("users")', 'v.id("devicePrincipals")'),
    ]
    for before, after in replacements:
        text = text.replace(before, after)
    text = re.sub(r"\buserId\b", "principalId", text)
    text = text.replace("Creating user ID", "Creating principal ID")
    text = text.replace("Publishing user ID", "Publishing principal ID")
    text = text.replace("authenticated user", "authenticated principal")
    text = text.replace("This user", "This principal")
    return text


# Port the reviewed state machine, but onto the device-principal identity model.
write(
    "shared/collaborationSession.ts",
    principalize(old("shared/collaborationSession.ts")),
)
write(
    "convex/schema/collaboration.ts",
    principalize(old("convex/schema/collaboration.ts")),
)
write(
    "convex/collaborationSessions.ts",
    principalize(old("convex/collaborationSessions.ts")),
)

# Register the collaboration control-plane tables without replacing current main's schema.
schema_path = Path("convex/schema.ts")
schema = schema_path.read_text()
import_line = 'import { collaborationTables } from "./schema/collaboration"\n'
if import_line not in schema:
    anchor = 'import { v } from "convex/values"\n'
    if anchor not in schema:
        raise SystemExit("schema import anchor missing")
    schema = schema.replace(anchor, anchor + import_line, 1)
if "  ...collaborationTables," not in schema:
    anchor = "export default defineSchema({\n"
    if anchor not in schema:
        raise SystemExit("defineSchema anchor missing")
    schema = schema.replace(anchor, anchor + "  ...collaborationTables,\n", 1)
schema_path.write_text(schema)

# Keep the checked-in Convex API declaration aligned with the new module.
api_path = Path("convex/_generated/api.d.ts")
api = api_path.read_text()
import_line = 'import type * as collaborationSessions from "../collaborationSessions.js";\n'
if import_line not in api:
    anchor = 'import type * as clean from "../clean.js";\n'
    if anchor not in api:
        raise SystemExit("api import anchor missing")
    api = api.replace(anchor, anchor + import_line, 1)
module_line = "  collaborationSessions: typeof collaborationSessions;\n"
if module_line not in api:
    anchor = "  clean: typeof clean;\n"
    if anchor not in api:
        raise SystemExit("api module anchor missing")
    api = api.replace(anchor, anchor + module_line, 1)
api_path.write_text(api)

# Make project deletion aware of the new low-volume session control plane.
projects_path = Path("convex/projects.ts")
projects = projects_path.read_text()
if 'query("collaborationSessionEvents")' not in projects:
    marker = '    case 19: {'
    index = projects.find(marker)
    if index < 0:
        raise SystemExit("project purge case anchor missing")
    block = '''    case 19: {\n      const rows = await ctx.db\n        .query("collaborationSessionEvents")\n        .withIndex("by_project_and_created_at", (q) => q.eq("projectId", projectId))\n        .take(PROJECT_PURGE_BATCH_SIZE)\n      await deleteRows(ctx, rows)\n      return { deleted: rows.length, nextStage: rows.length === 0 ? 20 : 19 }\n    }\n    case 20: {\n      const rows = await ctx.db\n        .query("collaborationParticipants")\n        .withIndex("by_project_and_principal", (q) => q.eq("projectId", projectId))\n        .take(PROJECT_PURGE_BATCH_SIZE)\n      await deleteRows(ctx, rows)\n      return { deleted: rows.length, nextStage: rows.length === 0 ? 21 : 20 }\n    }\n    case 21: {\n      const rows = await ctx.db\n        .query("collaborationSessions")\n        .withIndex("by_project_and_updated", (q) => q.eq("projectId", projectId))\n        .take(PROJECT_PURGE_BATCH_SIZE)\n      await deleteRows(ctx, rows)\n      return { deleted: rows.length, nextStage: rows.length === 0 ? 22 : 21 }\n    }\n'''
    # Do not renumber the historical cascade in this phase. Insert the new control-plane
    # cleanup immediately before the existing collaboration-key stage and shift later cases.
    # A deterministic renumber pass keeps all existing stage bodies intact.
    tail = projects[index:]
    for n in range(80, 18, -1):
        tail = tail.replace(f"case {n}:", f"case {n + 3}:")
        tail = tail.replace(f"nextStage: {n}", f"nextStage: {n + 3}")
        tail = tail.replace(f"? {n + 1} : {n}", f"? {n + 4} : {n + 3}")
    projects = projects[:index] + block + tail
    projects_path.write_text(projects)

print("PR141 phase 1 principal-native collaboration session port applied")
