# Agent Skills

Agent Skills is a first-class desktop surface at `/projects/skills` for inspecting and managing reusable agent instructions across Codex, Claude, Cursor, and OpenCode.

## Local testing architecture

The testing release has no hosted runtime or database dependency. Cozea stores the user's editable canonical library below Electron's `userData/agent-skills/library` directory and treats each provider's native skill folder as execution authority:

| Provider | User skill folder | External-app refresh behavior |
| --- | --- | --- |
| Codex | `~/.agents/skills` | Restart standalone Codex processes |
| Claude | `~/.claude/skills` | Claude detects changes live |
| Cursor | `~/.cursor/skills` | Restart is recommended |
| OpenCode | `~/.config/opencode/skills` | Restart is recommended |

Cozea's provider runtime is refreshed after a binding changes. Restart guidance in the UI refers to separately running provider apps or CLIs, not the Cozea assistant tile.

Skill state is local to the current operating-system user and device. Remote environments, cloud agents, different user homes, and other devices keep independent provider folders.

## Library and bindings

A Cozea-managed skill has one canonical folder containing `SKILL.md` and `.cozea-skill.json`. Enabling it for a provider creates a provider-native copy with a binding marker. Updating the canonical skill refreshes only those provider copies carrying the matching marker.

Provider folders are also scanned for skills that were installed outside Cozea. Those appear as **External** and remain read-only until the user copies one into their personal library. Cozea never overwrites an unmarked provider folder. Disabling or removing a provider-owned skill moves it into Cozea's local recoverable trash instead of deleting it permanently.

The surface supports:

- Search and source/provider filtering.
- Full instruction inspection.
- Personal skill creation and editing.
- Folder import for an existing `SKILL.md` package.
- Per-provider enable and disable controls.
- Copying provider-owned skills into the personal library.
- Recoverable removal.
- Portable setup export, read-only inspection, and selective copying.

Imports reject symbolic links, unsafe paths, more than 250 files, more than 12 nested levels, and skill packages larger than 5 MB. Provider binding conflicts are surfaced instead of overwritten.

## Portable setup packs

The zero-cost organization-discovery path is a JSON file named `*.cozea-skills.json`. It contains sanitized skill metadata, instruction bodies, declared compatibility, and enabled-provider choices. It deliberately excludes local absolute paths, account credentials, provider settings, and arbitrary support files.

Opening a setup pack is read-only. Copying a skill creates a new personal library entry; it never grants the author write access to the recipient's setup. Users may distribute packs through a shared folder, Git repository, chat, email, or another transport they control.

## Future hosted synchronization

A future organization catalog may move setup-pack manifests and revisions into Convex or another authenticated transport. The personal library and provider-native bindings must remain device authority. Hosted organization setups should stay read-only discovery sources, and copying should continue to create a personal fork with explicit provenance.

## Manual QA

1. Open **Agent Skills** from the project sidebar.
2. Create a skill and enable it for each installed provider.
3. Confirm `SKILL.md` appears in the provider roots above and that disabling moves only the selected binding to recoverable trash.
4. Edit the skill and confirm enabled managed copies update.
5. Place an unmarked skill in a provider root, refresh the page, and confirm it appears as External.
6. Disable and restore the external skill; confirm the original path returns.
7. Export a setup pack, reopen it in read-only mode, and copy one skill into the personal library.
8. Confirm Light, Dark, Navy, Wine, Clay, Forest, and System themes remain readable at narrow and wide desktop sizes.
