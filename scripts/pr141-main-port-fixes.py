#!/usr/bin/env python3
from pathlib import Path
import re

# Current main's purge helper returns a deletion count, not an explicit next-stage object.
projects_path = Path("convex/projects.ts")
projects = projects_path.read_text()
for old in (
    'return { deleted: rows.length, nextStage: rows.length === 0 ? 20 : 19 }',
    'return { deleted: rows.length, nextStage: rows.length === 0 ? 21 : 20 }',
    'return { deleted: rows.length, nextStage: rows.length === 0 ? 22 : 21 }',
):
    projects = projects.replace(old, 'return rows.length')
projects_path.write_text(projects)

# Keep the canonical repository fallback expressions syntactically unambiguous.
layout_path = Path("apps/desktop/src/features/projects/layouts/ProjectLayout.tsx")
layout = layout_path.read_text()
layout = re.sub(
    r'''const repoUrl = canonicalRepo\?\.url\?\.trim\(\) \|\|\s*\n\s*(\(project as \{ sourceControl\?: \{ repoUrl\?: string \| null \} \| null \} \| null \| undefined\)\?\.sourceControl\?\.repoUrl) \?\?\s*\n\s*null;''',
    r'''const repoUrl = canonicalRepo?.url?.trim() || (\1 ?? null);''',
    layout,
)
layout = re.sub(
    r'''const branch = canonicalRepo\?\.defaultBranch\?\.trim\(\) \|\|\s*\n\s*(\(project as \{ sourceControl\?: \{ defaultBranch\?: string \| null \} \| null \} \| null \| undefined\)\?\.sourceControl\?\.defaultBranch) \?\?\s*\n\s*undefined;''',
    r'''const branch = canonicalRepo?.defaultBranch?.trim() || (\1 ?? undefined);''',
    layout,
)
layout_path.write_text(layout)

# Route every public collaboration-session function through current main's canonical
# authenticated function builders. Gateway-secret server calls are already supported
# by those builders, so the server-only mutations retain their authority boundary.
session_path = Path("convex/collaborationSessions.ts")
session = session_path.read_text()
session = session.replace(
'''import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
''',
'''import type { MutationCtx, QueryCtx } from "./_generated/server"
import {
  authenticatedMutation as mutation,
  authenticatedQuery as query,
} from "./lib/authenticatedFunctions"
''',
)
# Avoid a lint-sensitive control-character range inside a regexp while retaining
# Git's prohibition on ASCII control/space characters.
old_branch = '''    branch.includes("//") ||
    /[\\u0000-\\u0020~^:?*\\\\[\\]]/.test(branch)
'''
new_branch = '''    branch.includes("//") ||
    [...branch].some((character) => character.charCodeAt(0) <= 0x20) ||
    /[~^:?*\\\\[\\]]/.test(branch)
'''
session = session.replace(old_branch, new_branch)
session_path.write_text(session)

# Extend the generic caller-identity guard to principal-native field names so a
# future endpoint cannot accidentally accept a forged actor principal.
auth_path = Path("convex/lib/authenticatedFunctions.ts")
auth = auth_path.read_text()
if '"createdByPrincipalId"' not in auth:
    auth = auth.replace(
        '  "deletedBy", "createdByUserId", "addedByUserId",\n',
        '  "deletedBy", "createdByUserId", "addedByUserId",\n  "createdByPrincipalId", "actorPrincipalId", "viewerPrincipalId",\n',
        1,
    )
auth = auth.replace(
    '/^(?:actor|viewer|requester|inviter|invited|added|deleted|created)UserId$/.test(field)',
    '/^(?:actor|viewer|requester|inviter|invited|added|deleted|created)(?:User|Principal)Id$/.test(field)',
)
auth_path.write_text(auth)

print("PR141 current-main compatibility and authority fixes applied")
