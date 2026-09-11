/**
 * In-memory stand-in for the Convex ctx used by function handlers in tests.
 *
 * Covers what the session control plane and its auth helpers call: the auth
 * identity, db.get/insert/patch, and query().withIndex().filter() with
 * first/unique/collect. Index ranges are applied as equality filters.
 */

type StoredDoc = Record<string, unknown> & { _id: string; _creationTime: number }
type Predicate = (doc: StoredDoc) => boolean

interface FieldRef {
  readonly __field: string
}

function isFieldRef(value: unknown): value is FieldRef {
  return typeof value === "object" && value !== null && "__field" in value
}

function operand(doc: StoredDoc, value: unknown): unknown {
  return isFieldRef(value) ? doc[value.__field] : value
}

const filterBuilder = {
  field: (name: string): FieldRef => ({ __field: name }),
  eq: (a: unknown, b: unknown): Predicate => (doc) => operand(doc, a) === operand(doc, b),
  neq: (a: unknown, b: unknown): Predicate => (doc) => operand(doc, a) !== operand(doc, b),
  gt: (a: unknown, b: unknown): Predicate => (doc) => (operand(doc, a) as number) > (operand(doc, b) as number),
  gte: (a: unknown, b: unknown): Predicate => (doc) => (operand(doc, a) as number) >= (operand(doc, b) as number),
  lt: (a: unknown, b: unknown): Predicate => (doc) => (operand(doc, a) as number) < (operand(doc, b) as number),
  lte: (a: unknown, b: unknown): Predicate => (doc) => (operand(doc, a) as number) <= (operand(doc, b) as number),
  and: (...predicates: Predicate[]): Predicate => (doc) => predicates.every((p) => p(doc)),
  or: (...predicates: Predicate[]): Predicate => (doc) => predicates.some((p) => p(doc)),
  not: (predicate: Predicate): Predicate => (doc) => !predicate(doc),
}

class IndexRange {
  readonly constraints: Array<[string, unknown]> = []

  eq(field: string, value: unknown): this {
    this.constraints.push([field, value])
    return this
  }
}

class FakeQuery {
  private readonly rows: StoredDoc[]

  constructor(rows: StoredDoc[]) {
    this.rows = rows
  }

  withIndex(_name: string, range?: (q: IndexRange) => IndexRange): FakeQuery {
    const constraints = range ? range(new IndexRange()).constraints : []
    return new FakeQuery(this.rows.filter((doc) => constraints.every(([field, value]) => doc[field] === value)))
  }

  filter(build: (q: typeof filterBuilder) => Predicate): FakeQuery {
    return new FakeQuery(this.rows.filter(build(filterBuilder)))
  }

  order(): FakeQuery {
    return this
  }

  async first(): Promise<StoredDoc | null> {
    return this.rows[0] ?? null
  }

  async unique(): Promise<StoredDoc | null> {
    if (this.rows.length > 1) throw new Error("unique() matched more than one document")
    return this.rows[0] ?? null
  }

  async collect(): Promise<StoredDoc[]> {
    return [...this.rows]
  }

  async take(count: number): Promise<StoredDoc[]> {
    return this.rows.slice(0, count)
  }
}

export class FakeConvexDb {
  private readonly tables = new Map<string, Map<string, StoredDoc>>()
  private counter = 0

  seed(table: string, doc: Record<string, unknown>): string {
    const id = `${table}|${++this.counter}`
    const rows = this.tables.get(table) ?? new Map<string, StoredDoc>()
    rows.set(id, { ...doc, _id: id, _creationTime: this.counter })
    this.tables.set(table, rows)
    return id
  }

  rows(table: string): StoredDoc[] {
    return [...(this.tables.get(table)?.values() ?? [])].map((doc) => ({ ...doc }))
  }

  async insert(table: string, doc: Record<string, unknown>): Promise<string> {
    const clean = Object.fromEntries(Object.entries(doc).filter(([, value]) => value !== undefined))
    return this.seed(table, clean)
  }

  async get(id: string): Promise<StoredDoc | null> {
    const doc = this.tables.get(id.split("|")[0])?.get(id)
    return doc ? { ...doc } : null
  }

  async patch(id: string, fields: Record<string, unknown>): Promise<void> {
    const doc = this.tables.get(id.split("|")[0])?.get(id)
    if (!doc) throw new Error(`patch: no document ${id}`)
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) delete doc[key]
      else doc[key] = value
    }
  }

  query(table: string): FakeQuery {
    return new FakeQuery(this.rows(table))
  }
}

export function fakeConvexCtx(db: FakeConvexDb, identity: Record<string, unknown> | null) {
  return {
    db,
    auth: { getUserIdentity: async () => identity },
    storage: { getUrl: async () => null },
  }
}

/** Runs a registered Convex function's handler, including any wrapper around it. */
export async function runConvexHandler<T = any>(fn: unknown, ctx: unknown, args: Record<string, unknown>): Promise<T> {
  const handler = (fn as { _handler?: (ctx: unknown, args: unknown) => Promise<T> })._handler
  if (!handler) throw new Error("Not a registered Convex function")
  return await handler(ctx, args)
}
