#!/usr/bin/env python3
from pathlib import Path

projects_path = Path("convex/projects.ts")
projects = projects_path.read_text()
projects = projects.replace(
    'return { deleted: rows.length, nextStage: rows.length === 0 ? 20 : 19 }',
    'return rows.length',
)
projects = projects.replace(
    'return { deleted: rows.length, nextStage: rows.length === 0 ? 21 : 20 }',
    'return rows.length',
)
projects = projects.replace(
    'return { deleted: rows.length, nextStage: rows.length === 0 ? 22 : 21 }',
    'return rows.length',
)
projects_path.write_text(projects)

print("PR141 current-main compatibility fixes applied")
