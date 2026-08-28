import * as Migrator from "effect/unstable/sql/Migrator";
import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";

import Migration0001 from "./Migrations/001_InitialSchema.ts";
import Migration0002 from "./Migrations/002_ActiveUniqueIndexes.ts";
import Migration0003 from "./Migrations/003_WorkspaceStorageOwnership.ts";

export const migrationEntries = [
  [1, "InitialSchema", Migration0001],
  [2, "ActiveUniqueIndexes", Migration0002],
  [3, "WorkspaceStorageOwnership", Migration0003],
] as const;

export const makeMigrationLoader = (throughId?: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      migrationEntries
        .filter(([id]) => throughId === undefined || id <= throughId)
        .map(([id, name, migration]) => [`${id}_${name}`, migration]),
    ),
  );

const run = Migrator.make({});

export interface RunMigrationsOptions {
  readonly toMigrationInclusive?: number | undefined;
}

export const runMigrations = ({ toMigrationInclusive }: RunMigrationsOptions = {}) =>
  Effect.gen(function* () {
    yield* Effect.log(
      toMigrationInclusive === undefined
        ? "[WorkspaceCatalog] Running all migrations..."
        : `[WorkspaceCatalog] Running migrations 1 through ${toMigrationInclusive}...`,
    );
    const executed = yield* run({ loader: makeMigrationLoader(toMigrationInclusive) });
    yield* Effect.log("[WorkspaceCatalog] Migrations complete").pipe(
      Effect.annotateLogs({
        migrations: executed.map(([id, name]) => `${id}_${name}`),
      }),
    );
    return executed;
  });

export const MigrationsLive = Layer.effectDiscard(runMigrations());
