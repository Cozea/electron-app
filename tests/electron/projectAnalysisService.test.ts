import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  clearProjectAnalysisCachesForTests,
  getProjectContextOptionsFromAnalysis,
  markProjectAnalysisStaleForFile,
  scanProjectRoutesFromAnalysis,
} from '../../electron/services/ProjectAnalysisService'
import {
  applyProjectFileMetaChangeToIndex,
  clearProjectFileIndexesForTests,
} from '../../electron/services/ProjectFileIndexService'

const tempRoots: string[] = []

async function createTempProject(): Promise<string> {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cozea-project-analysis-'))
  tempRoots.push(projectPath)
  return projectPath
}

async function writeProjectFile(projectPath: string, relativePath: string, content: string): Promise<string> {
  const filePath = path.join(projectPath, relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
  return filePath
}

async function applyMetaForFile(filePath: string): Promise<void> {
  const stats = await fs.stat(filePath)
  applyProjectFileMetaChangeToIndex({
    filePath,
    isDirectory: false,
    sizeBytes: stats.size,
  })
  markProjectAnalysisStaleForFile(filePath)
}

afterEach(async () => {
  clearProjectAnalysisCachesForTests()
  clearProjectFileIndexesForTests()
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('ProjectAnalysisService', () => {
  it('detects Next.js and scans app router routes from the file index', async () => {
    const projectPath = await createTempProject()
    await writeProjectFile(projectPath, 'package.json', JSON.stringify({ dependencies: { next: '^1.0.0' } }))
    await writeProjectFile(projectPath, 'app/page.tsx', 'export default function Home() { return null }')
    await writeProjectFile(projectPath, 'app/blog/[slug]/page.tsx', 'export default function Blog() { return null }')

    const result = await scanProjectRoutesFromAnalysis({ projectPath })

    expect(result.success).toBe(true)
    expect(result.framework).toBe('nextjs')
    expect(result.routes.map((route) => route.path)).toEqual(['/', '/blog/[slug]'])
    expect(result.routes.find((route) => route.path === '/blog/[slug]')?.type).toBe('dynamic')
  })

  it('returns task context files and routes through one cached analysis call', async () => {
    const projectPath = await createTempProject()
    await writeProjectFile(projectPath, 'package.json', JSON.stringify({ dependencies: { react: '^1.0.0', vite: '^1.0.0' } }))
    await writeProjectFile(
      projectPath,
      'src/App.tsx',
      `
import Home from './pages/Home'
import About from './pages/About'

export function App() {
  return (
    <>
      <Route path="/" element={<Home />} />
      <Route path="/about" element={<About />} />
    </>
  )
}
`,
    )
    await writeProjectFile(projectPath, 'src/pages/Home.tsx', 'export default function Home() { return null }')
    await writeProjectFile(projectPath, 'src/pages/About.tsx', 'export default function About() { return null }')

    const result = await getProjectContextOptionsFromAnalysis({
      projectPath,
      frameworkInfo: { framework: 'vite-react' },
    })

    expect(result.success).toBe(true)
    expect(result.files).toContain('src/App.tsx')
    expect(result.files).toContain('src/pages/About.tsx')
    expect(result.routes.map((route) => route.path)).toEqual(['/', '/about'])
  })

  it('refreshes derived routes after file-index metadata changes mark analysis stale', async () => {
    const projectPath = await createTempProject()
    await writeProjectFile(projectPath, 'package.json', JSON.stringify({ dependencies: { next: '^1.0.0' } }))
    await writeProjectFile(projectPath, 'app/page.tsx', 'export default function Home() { return null }')

    expect((await scanProjectRoutesFromAnalysis({ projectPath })).routes.map((route) => route.path)).toEqual(['/'])

    const contactPagePath = await writeProjectFile(
      projectPath,
      'app/contact/page.tsx',
      'export default function Contact() { return null }',
    )
    await applyMetaForFile(contactPagePath)

    expect((await scanProjectRoutesFromAnalysis({ projectPath })).routes.map((route) => route.path)).toEqual([
      '/',
      '/contact',
    ])
  })
})
