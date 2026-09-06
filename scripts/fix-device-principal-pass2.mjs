import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const file = (rel) => path.join(root, rel)

function edit(rel, transform) {
  const target = file(rel)
  if (!fs.existsSync(target)) return
  const before = fs.readFileSync(target, 'utf8')
  const after = transform(before)
  if (after !== before) fs.writeFileSync(target, after)
}

edit('apps/desktop/src/features/projects/layouts/ProjectLayout.tsx', (text) =>
  text.replace(
    'userName={displayUserName ?? "User"}',
    'userName={user?.displayName ?? "This device"}',
  ),
)

edit('apps/desktop/src/features/tasks/pages/TasksPage.tsx', (text) =>
  text
    .replace('          email: candidate.email,', '          identityKey: candidate.identityKey,')
    .replace('              identityKey: assignee.identityKey,\n', ''),
)

edit('convex/projectTasks.ts', (text) =>
  text.replace(
`          safeAssignee = {
            name: assignee.name,
            email: assignee.email,
            avatarUrl: assignee.avatarUrl,
          }`,
`          safeAssignee = {
            name: assignee.name,
            avatarUrl: assignee.avatarUrl,
          }`,
  ),
)

console.log('Applied device-principal compiler repair pass 2.')
