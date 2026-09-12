import type { ProjectdDatabase } from "../storage/Database"

export type SessionPullRequestState = "open" | "closed" | "merged"

export interface SessionPullRequestRecord {
  publicSessionId: string
  repository: string
  branch: string
  targetBranch: string
  number: number
  url: string
  state: SessionPullRequestState
  headOid: string
  targetOid: string
  checkedAt: number
}

interface PullRequestRow {
  session_id: string
  repository: string
  branch_name: string
  target_branch: string
  pr_number: number
  url: string
  state: string
  head_oid: string
  target_oid: string
  checked_at: number
}

function parseState(value: string): SessionPullRequestState {
  if (value === "open" || value === "closed" || value === "merged") return value
  throw new Error("Invalid persisted pull request state")
}

function validate(record: SessionPullRequestRecord): void {
  if (!record.publicSessionId || !record.repository || !record.branch || !record.targetBranch) {
    throw new Error("Pull request identity is incomplete")
  }
  if (!Number.isSafeInteger(record.number) || record.number < 1 || !Number.isSafeInteger(record.checkedAt) || record.checkedAt < 0) {
    throw new Error("Pull request number or timestamp is invalid")
  }
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/.test(record.url) ||
    !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(record.headOid) || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(record.targetOid)) {
    throw new Error("Pull request repository metadata is invalid")
  }
}

/** Device-local durable record of the PR that carries one collaboration branch. */
export class SessionPullRequestStore {
  constructor(private readonly database: ProjectdDatabase) {
    this.database.db.exec(`CREATE TABLE IF NOT EXISTS session_pull_requests (
      session_id TEXT NOT NULL,
      repository TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      target_branch TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      url TEXT NOT NULL,
      state TEXT NOT NULL,
      head_oid TEXT NOT NULL,
      target_oid TEXT NOT NULL,
      checked_at INTEGER NOT NULL,
      PRIMARY KEY(session_id, repository, branch_name, target_branch)
    );
    CREATE INDEX IF NOT EXISTS idx_session_pull_requests_session
      ON session_pull_requests(session_id, checked_at DESC);`)
  }

  save(record: SessionPullRequestRecord): SessionPullRequestRecord {
    validate(record)
    this.database.db.prepare(`INSERT INTO session_pull_requests
      (session_id, repository, branch_name, target_branch, pr_number, url, state, head_oid, target_oid, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, repository, branch_name, target_branch) DO UPDATE SET
        pr_number=excluded.pr_number,
        url=excluded.url,
        state=excluded.state,
        head_oid=excluded.head_oid,
        target_oid=excluded.target_oid,
        checked_at=excluded.checked_at`).run(
      record.publicSessionId,
      record.repository,
      record.branch,
      record.targetBranch,
      record.number,
      record.url,
      record.state,
      record.headOid,
      record.targetOid,
      record.checkedAt,
    )
    return record
  }

  get(publicSessionId: string, repository: string, branch: string, targetBranch: string): SessionPullRequestRecord | null {
    const row = this.database.db.prepare(`SELECT session_id, repository, branch_name, target_branch, pr_number, url,
      state, head_oid, target_oid, checked_at FROM session_pull_requests
      WHERE session_id=? AND repository=? AND branch_name=? AND target_branch=?`)
      .get(publicSessionId, repository, branch, targetBranch) as PullRequestRow | undefined
    return row ? this.fromRow(row) : null
  }

  list(publicSessionId: string): SessionPullRequestRecord[] {
    const rows = this.database.db.prepare(`SELECT session_id, repository, branch_name, target_branch, pr_number, url,
      state, head_oid, target_oid, checked_at FROM session_pull_requests
      WHERE session_id=? ORDER BY checked_at DESC, pr_number DESC`)
      .all(publicSessionId) as unknown as PullRequestRow[]
    return rows.map((row) => this.fromRow(row))
  }

  private fromRow(row: PullRequestRow): SessionPullRequestRecord {
    const record: SessionPullRequestRecord = {
      publicSessionId: row.session_id,
      repository: row.repository,
      branch: row.branch_name,
      targetBranch: row.target_branch,
      number: row.pr_number,
      url: row.url,
      state: parseState(row.state),
      headOid: row.head_oid,
      targetOid: row.target_oid,
      checkedAt: row.checked_at,
    }
    validate(record)
    return record
  }
}
