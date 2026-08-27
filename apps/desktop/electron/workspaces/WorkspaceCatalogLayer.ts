import fs from "node:fs/promises"
import path from "node:path"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "@effect/sql/SqlClient"

import { layer as makeSqliteLayer, layerMemory } from "./SqliteClient.ts"
import { MigrationsLive } from "./Migrations.ts"
import { WorkspaceCatalogLive } from "./WorkspaceCatalog.ts"

const SqliteSetupLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`PRAGMA journal_mode = WAL`
    yield* sql`PRAGMA foreign_keys = ON`
  }),
)

const snakeToCamel = (s: string) =>
  s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

const makeBaseLayer = (sqliteLayer: Layer.Layer<SqlClient.SqlClient>) =>
  WorkspaceCatalogLive.pipe(
    Layer.provideMerge(
      MigrationsLive.pipe(
        Layer.provideMerge(SqliteSetupLayer),
        Layer.provideMerge(sqliteLayer),
      ),
    ),
  )

export const makeWorkspaceCatalogLayer = (dbPath: string) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => fs.mkdir(path.dirname(dbPath), { recursive: true }),
      catch: (e) => new Error(`Failed to create workspace catalog directory: ${String(e)}`),
    })
    return makeBaseLayer(makeSqliteLayer({ filename: dbPath, transformResultNames: snakeToCamel }))
  }).pipe(Layer.unwrap)

/** In-memory layer for tests. */
export const WorkspaceCatalogMemoryLayer = makeBaseLayer(
  layerMemory({ transformResultNames: snakeToCamel }),
)
