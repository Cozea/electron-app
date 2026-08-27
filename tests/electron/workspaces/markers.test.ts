import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  deleteWorkspaceMarker,
  readWorkspaceMarker,
  writeWorkspaceMarker,
} from "../../../apps/desktop/electron/workspaces/markers"

const tempRoots: string[] = []

async function makeTempProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-marker-test-"))
  tempRoots.push(root)
  return root
}

describe("workspace markers", () => {
  afterEach(async () => {
    await Promise.allSettled(
      tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
    )
  })

  it("deletes a marker when the expected project and workspace match", async () => {
    const projectRoot = await makeTempProject()
    await fs.mkdir(path.join(projectRoot, ".git"), { recursive: true })

    await writeWorkspaceMarker(projectRoot, {
      version: 1,
      projectId: "project_1",
      workspaceId: "workspace_1",
      createdBy: "cozea",
      createdAt: 123,
    })

    await expect(readWorkspaceMarker(projectRoot)).resolves.toMatchObject({
      marker: {
        projectId: "project_1",
        workspaceId: "workspace_1",
      },
    })

    await expect(
      deleteWorkspaceMarker(projectRoot, {
        projectId: "project_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toBe(true)
    await expect(readWorkspaceMarker(projectRoot)).resolves.toBeNull()
  })

  it("leaves a marker in place when the expected identity does not match", async () => {
    const projectRoot = await makeTempProject()

    await writeWorkspaceMarker(projectRoot, {
      version: 1,
      projectId: "project_1",
      workspaceId: "workspace_1",
      createdBy: "cozea",
      createdAt: 123,
    })

    await expect(
      deleteWorkspaceMarker(projectRoot, {
        projectId: "project_2",
        workspaceId: "workspace_1",
      }),
    ).resolves.toBe(false)
    await expect(readWorkspaceMarker(projectRoot)).resolves.toMatchObject({
      marker: {
        projectId: "project_1",
        workspaceId: "workspace_1",
      },
    })
  })
})
