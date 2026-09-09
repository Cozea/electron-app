import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
const changed = new Set();
const edit = (name, transform) => { const before = readFileSync(name, "utf8"); const after = transform(before); if (before === after) throw new Error(`No transformation: ${name}`); writeFileSync(name, after); changed.add(name); };
const replace = (source, before, after) => { const at = source.indexOf(before); if (at < 0 || source.indexOf(before, at + before.length) >= 0) throw new Error(`Exact anchor changed: ${before.slice(0, 100)}`); return source.slice(0, at) + after + source.slice(at + before.length); };
const create = (name, content) => { if (existsSync(name)) throw new Error(`File already exists: ${name}`); mkdirSync(path.dirname(name), { recursive: true }); writeFileSync(name, content); changed.add(name); };

edit("shared/SessionFileDocument.ts", source => {
  source = 'import { changesFromPublishedBaseline, validatePublishedManifest, type SessionPublishedManifest } from "./collaborationPublication"\n' + source;
  source = replace(source, '  readonly doc: Y.Doc', '  readonly doc: Y.Doc\n  private readonly sessionId: string\n  private readonly publicationManifests: Y.Map<SessionPublishedManifest>');
  source = replace(source, '    this.doc.gc = false', '    this.doc.gc = false\n    this.sessionId = sessionId\n    this.publicationManifests = this.doc.getMap("published-file-baselines")');
  const begin = source.indexOf('  snapshotChanges(): CollaborationTextChange[] {');
  const end = source.indexOf('\n  checkpoint():', begin);
  if (begin < 0 || end < 0) throw new Error("Snapshot generator anchor changed");
  return source.slice(0, begin) + String.raw`  publicationManifest(commitSha: string): SessionPublishedManifest | null {
    const value = this.publicationManifests.get(commitSha)
    return value ? validatePublishedManifest(value, { sessionId: this.sessionId, commitSha }) : null
  }

  recordPublicationManifest(value: SessionPublishedManifest): void {
    const manifest = validatePublishedManifest(value, { sessionId: this.sessionId })
    const existing = this.publicationManifest(manifest.commitSha)
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(manifest)) throw new Error("The same published commit has conflicting file identities")
      return
    }
    this.doc.transact(() => this.publicationManifests.set(manifest.commitSha, manifest), "publication-manifest")
  }

  snapshotChanges(published?: SessionPublishedManifest): CollaborationTextChange[] {
    if (this.renameConflicts().length) throw new Error("Resolve competing shared renames before committing or projecting files")
    if (this.pathConflicts().length) throw new Error("Resolve shared path collisions before committing or projecting files")
    const baseline = published ? validatePublishedManifest(published, { sessionId: this.sessionId }) : undefined
    return changesFromPublishedBaseline(this.files(), baseline)
  }
` + source.slice(end);
});

edit("shared/collaborationDesktop.ts", source => {
  source = replace(source, '  preparedAt: number\n', '  preparedAt: number\n  publicationBasisId?: string\n  publicationBasisKeyVersion?: number\n');
  return replace(source, '  throughSequence: number\n  textChanges:', '  throughSequence: number\n  publicationBasisId?: string\n  publicationBasisKeyVersion?: number\n  textChanges:');
});

edit("apps/desktop/electron/collaboration/DurableSessionStore.ts", source => replace(source, '  readInitializationBasis(id: string): Promise<string | null> {', String.raw`  readPublicationBasis(id: string): Promise<string | null> {
    if (!idPattern.test(id)) throw new Error("Invalid publication basis identity")
    return this.serial(() => this.read<string>(` + '`publication-basis-${id}.json`' + String.raw`))
  }
  savePublicationBasis(id: string, encoded: string): Promise<void> {
    if (!idPattern.test(id)) throw new Error("Invalid publication basis identity")
    return this.serial(async () => {
      const name = ` + '`publication-basis-${id}.json`' + String.raw`
      const previous = await this.read<string>(name)
      if (previous && previous !== encoded) throw new Error("Prepared publication basis cannot be replaced")
      if (!previous) await this.write(name, encoded)
    })
  }

  readInitializationBasis(id: string): Promise<string | null> {`));

edit("apps/desktop/electron/collaboration/CollaborationSessionRuntime.ts", source => {
  source = 'import { encodePublicationBasis, manifestFromPublicationBasis } from "./PublicationBasis"\nimport type { PreparedCollaborationCommit } from "../../../../shared/collaborationDesktop"\n' + source;
  source = replace(source, '  offline?: boolean\n', '  offline?: boolean\n  readPublicationBasis?: (id: string, keyVersion: number) => Promise<{ encoded: string; roomKeyBase64: string } | null>\n');
  const begin = source.indexOf('  async captureCommit():');
  const end = source.indexOf('\n  async waitForSequence(', begin);
  if (begin < 0 || end < 0) throw new Error("Runtime commit capture anchor changed");
  return source.slice(0, begin) + String.raw`  async captureCommit(context: { baseCommitSha: string; publishedCommitSha: string | null }): Promise<{ sequence: number; textChanges: CollaborationTextChange[]; publicationBasisId: string; publicationBasisKeyVersion: number }> {
    // The fence covers work accepted before Commit, not future renderer input.
    const acceptedEditorFence = this.editorQueue
    await acceptedEditorFence
    await this.projectFiles()
    if (this.projectionPaused) throw new Error("Resolve paused file synchronization before committing; local bytes were retained")
    const snapshot = await this.assertEditor().captureCommitState()
    const acknowledged = new SessionFileDocument(this.options.sessionId)
    try {
      Y.applyUpdate(acknowledged.doc, snapshot.update)
      const published = acknowledged.publicationManifest(context.baseCommitSha)
      if (context.publishedCommitSha && !published) throw new Error("The verified Git base lacks its published file baseline; recover the retained publication before preparing another commit")
      const textChanges = acknowledged.snapshotChanges(published ?? undefined)
      const basis = await encodePublicationBasis({ sessionId: this.options.sessionId, projectId: this.options.session.projectId, roomId: this.options.session.roomId, ...this.options.encryption }, context.baseCommitSha, snapshot.sequence, snapshot.update)
      await this.options.store.savePublicationBasis(basis.id, basis.encoded)
      return { sequence: snapshot.sequence, textChanges, publicationBasisId: basis.id, publicationBasisKeyVersion: this.options.encryption.keyVersion }
    } finally { acknowledged.destroy() }
  }

  async publishPreparedManifest(prepared: PreparedCollaborationCommit): Promise<void> {
    const provider = this.assertEditor()
    const previous = this.files.publicationManifest(prepared.commitSha)
    if (previous) {
      if (previous.parentCommitSha !== prepared.parentCommitSha || previous.throughSequence !== prepared.throughSequence) throw new Error("Prepared publication identity changed")
    } else {
      const id = prepared.publicationBasisId, keyVersion = prepared.publicationBasisKeyVersion
      if (!id || !keyVersion) throw new Error("This retained prepared commit predates publication baselines; retain it for explicit recovery rather than guessing file identities")
      const material = keyVersion === this.options.encryption.keyVersion
        ? { encoded: await this.options.store.readPublicationBasis(id), roomKeyBase64: this.options.encryption.roomKeyBase64 }
        : await this.options.readPublicationBasis?.(id, keyVersion)
      if (!material?.encoded) throw new Error("The prepared publication basis is unavailable; all local work was retained")
      const manifest = await manifestFromPublicationBasis({ sessionId: this.options.sessionId, projectId: this.options.session.projectId, roomId: this.options.session.roomId, keyVersion, roomKeyBase64: material.roomKeyBase64 },
        { id, parentCommitSha: prepared.parentCommitSha, sequence: prepared.throughSequence }, prepared.commitSha, material.encoded)
      this.files.recordPublicationManifest(manifest)
    }
    await provider.flushLocalPersistence()
    // The manifest joins canonical encrypted history before Push. Later text
    // edits remain outside the prepared Git snapshot and keep their own clocks.
    await provider.captureCommitState()
  }
` + source.slice(end);
});

edit("apps/desktop/electron/collaboration/SessionRuntimeHost.ts", source => {
  source = replace(source, '      changedPaths: () => this.coordinator.changedPaths(sessionId),', String.raw`      changedPaths: () => this.coordinator.changedPaths(sessionId),
      readPublicationBasis: async (id, keyVersion) => {
        const recovered = await this.keys.recoverKey(binding.projectId, sessionId, keyVersion)
        if (!recovered) return null
        const encoded = await new DurableSessionStore(this.root, material.session.roomId, keyVersion).readPublicationBasis(id)
        return encoded ? { encoded, roomKeyBase64: recovered.roomKeyBase64 } : null
      },`);
  source = replace(source, '      const snapshot = await runtime.captureCommit()', '      const context = await this.gateway.post<CollaborationWorkspaceAuthority>("/collab/v2/workspace-context", { sessionId: input.sessionId })\n      const snapshot = await runtime.captureCommit({ baseCommitSha: context.session.baseCommitSha, publishedCommitSha: context.session.publishedCommitSha })');
  source = replace(source, 'throughSequence: snapshot.sequence, textChanges: snapshot.textChanges })', 'throughSequence: snapshot.sequence, textChanges: snapshot.textChanges, publicationBasisId: snapshot.publicationBasisId, publicationBasisKeyVersion: snapshot.publicationBasisKeyVersion })\n      await runtime.publishPreparedManifest(prepared)');
  source = replace(source, '    // A completed publication can be recovered without acquiring a new lease.', '    if (prepared.state === "discarded") throw new Error("This prepared commit was discarded")\n    if (prepared.state !== "published") await this.runtime(sessionId).publishPreparedManifest(prepared)\n    // A completed publication can be recovered without acquiring a new lease.');
  return source;
});

edit("apps/desktop/electron/collaboration/SessionWorkspaceCoordinator.ts", source => {
  source = replace(source, '      const previousRaw = await this.deps.read(preparedKey(input.sessionId))', '      if (input.publicationBasisId !== undefined && (!/^[A-Za-z0-9_-]{1,160}$/.test(input.publicationBasisId) || !Number.isSafeInteger(input.publicationBasisKeyVersion) || Number(input.publicationBasisKeyVersion) < 1)) throw new Error("Prepared publication capture identity is invalid")\n      const previousRaw = await this.deps.read(preparedKey(input.sessionId))');
  return replace(source, '          preparedAt: this.now(), state: "prepared",', '          preparedAt: this.now(), state: "prepared",\n          ...(input.publicationBasisId ? { publicationBasisId: input.publicationBasisId, publicationBasisKeyVersion: input.publicationBasisKeyVersion } : {}),');
});

create("tests/collaboration/publicationBaseline.test.ts", readFileSync("scripts/collaboration/publication-tests.template", "utf8"));
mkdirSync(".agent/collaboration-evidence", { recursive: true });
writeFileSync(".agent/collaboration-candidate.json", JSON.stringify({ message: "refactor: capture immutable published file baselines across commit cycles", paths: [...changed] }, null, 2));
console.log(`Prepared ${changed.size} publication transformations.`);
