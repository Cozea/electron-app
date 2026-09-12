import { generateKeyPairSync, verify } from "node:crypto"
import { expect, it } from "vitest"
import { repositoryGrant, issueRepositoryInstallationToken } from "../../convex/sessionRepositoryCredentials"

it("requires an exact operator grant and requests a single-repository minimal token with a signed JWT", async () => {
  const grant = { projectId: "project", repositoryUrl: "https://github.com/team/app.git", installationId: 123, repositoryId: 456 }
  expect(repositoryGrant(JSON.stringify([grant]), grant.projectId, grant.repositoryUrl)).toEqual(grant)
  expect(() => repositoryGrant(JSON.stringify([grant]), "other", grant.repositoryUrl)).toThrow()
  expect(() => repositoryGrant(JSON.stringify([grant]), grant.projectId, "https://github.com/team/other.git")).toThrow()
  expect(() => repositoryGrant(JSON.stringify([grant, grant]), grant.projectId, grant.repositoryUrl)).toThrow()
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const privateKey = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString()
  const fetchFn = (async (url, init) => {
    expect(url).toBe("https://api.github.com/app/installations/123/access_tokens")
    expect(init?.redirect).toBe("error")
    expect(JSON.parse(String(init?.body))).toEqual({ repository_ids: [456], permissions: { contents: "read", pull_requests: "write" } })
    const jwt = new Headers(init?.headers).get("Authorization")!.slice(7)
    const [header, claims, signature] = jwt.split(".")
    expect(verify("RSA-SHA256", Buffer.from(`${header}.${claims}`), keys.publicKey, Buffer.from(signature!, "base64url"))).toBe(true)
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toMatchObject({ iss: "app" })
    return Response.json({ token: "fixture-token", expires_at: new Date(Date.now() + 3600_000).toISOString() })
  }) as typeof fetch
  expect(await issueRepositoryInstallationToken(grant, "app", privateKey, fetchFn)).toMatchObject({ token: "fixture-token" })
  await expect(issueRepositoryInstallationToken(grant, "app", privateKey, fetchFn, "git_write")).rejects.toThrow("not provisioned")
  const gitFetch = (async (_url, init) => {
    expect(JSON.parse(String(init?.body))).toEqual({ repository_ids: [456], permissions: { contents: "write" } })
    return Response.json({ token: "git-token", expires_at: new Date(Date.now() + 3600_000).toISOString() })
  }) as typeof fetch
  expect(await issueRepositoryInstallationToken({ ...grant, allowGitWrite: true }, "app", privateKey, gitFetch, "git_write")).toMatchObject({ token: "git-token" })
  await expect(issueRepositoryInstallationToken(grant, "app", privateKey, (async () => Response.json({ token: "expired", expires_at: "2000-01-01" })) as typeof fetch)).rejects.toThrow("Invalid")
})
