# Provider conversations

An agent can ask an asynchronous question while it keeps working. Answer in the
question panel; your ordinary message and image draft stays separate. Unsent
answers survive closing the tile and restarting Cozea. If sending fails, retry
uses the same answer and submission identity. Native blocking questions still
use the existing composer question flow. Number shortcuts apply only while the
question card itself has focus.

For providers that advertise compaction, choose **Compact context** in the
composer's plus menu or use `/compact`. Compaction requires an existing idle
conversation with no pending questions or approvals. It summarizes the provider's
context while keeping visible history, your message draft, and attachments.
Errors appear through the normal conversation error surface; reconnect before
retrying an interrupted operation. Token savings are not estimated locally.

These features use the pinned runtime. A mismatched or unstamped server bundle
must be prepared again before it can run.

## Controlled application updates

**Continue active chats after updates** is a device-local preference in the update
menu, off by default. When enabled for **Install now**, Electron waits for every
running workspace server to persist continuation markers before handing control
to the updater. A failed preparation or installer handoff cancels those markers
and leaves the downloaded update available for an explicit retry. If the old
server remains alive, its preparation expires after 30 seconds.

The replacement T3 server is the only continuation owner. It reconciles the
marked turn against the original workspace, provider instance and native
conversation. The renderer never sends an additional Continue message. Stop,
pending questions/approvals, missing instances and invalid bindings retain the
upstream reconciliation rules. Ordinary Quit, renderer reload and an unexpected
crash do not create continuation markers. A crash after an external action but
before its acknowledgement is ambiguous; this feature does not promise exactly
once execution of external tools. It is not a substitute for reviewing a failed
conversation before retrying it.

## OpenCode permissions

The approval card uses the provider's actual decision labels and scope warnings.
**Allow for workspace** can apply across sessions; it must not be described as a
one-session permission. Failed replies remain available to retry. Unknown request
kinds keep their details and allow decline/cancel rather than inventing a grant.
Each managed chat retains its own server and thread-specific Cozea preview/MCP
context. Stop and permission settlement are owned by the provider runtime.

## Local Antigravity setup

Open **Settings → Tooling → Antigravity**, or **Set up Antigravity** from a blocked
chat. Enable the account explicitly, then install the managed runtime or save a
supported manual binary path. Installation shows progress, cancellation and
failure; removing a managed runtime is offered only when the server reports that
it can be removed. Active runtime leases protect versions that are still in use.

Choose **Sign in with Google** to open the provider's browser flow. The local
runtime owns its callback, expiry and cancellation. Cozea never asks you to paste
credentials into chat. Add another account to create a distinct provider instance;
its profile, sign-in and conversations remain separate. Sign out clears that
instance's provider auth; Disable stops offering it for new work. Neither action
is a request to delete native conversation history. Managed runtime removal and
account sign-out are separate actions. Manual binaries are not deleted by the
managed-runtime action.

This surface requires a local loopback Cozea runtime. Unsupported architectures
show the provider's unavailable state; remote/mobile and API-key/enterprise setup
are not exposed. Account setup is separate from Cozea device and organization
authentication. Background discovery does not install a binary or start sign-in.

Antigravity hides generic Plan and conversation rewind controls when unsupported;
its own native `/plan` remains available. Fixed-choice answers send native option
IDs even when labels are identical. Image input accepts BMP, JPEG, PNG and WebP,
up to 10 MiB each and 50 MiB in one message; invalid input is rejected before send.
Skills come from the provider's native catalog. The four-provider Cozea skill
library remains unchanged; it does not silently create an Antigravity copy.

## Compatibility and diagnostics

Settings → Tooling includes the adapter revision and installed provider versions.
The machine-readable qualification record is `shared/provider-compatibility.json`.
An observed or fixture-tested version is not automatically a qualified native
runtime. Unfamiliar versions are marked **Unverified** and remain usable. A
confirmed decoding incompatibility preserves the original native conversation
binding and reports that the integration needs updating; it never silently
replaces the conversation or downgrades the user's CLI.

Existing history can contain file attachment variants that Cozea cannot compose.
These remain decodable and display their names; they are not rendered as broken
images or opened as arbitrary local paths. Normal image and artifact views remain
available. See `docs/upstream-provider-integration-plan.md` for qualification
coverage, rollback constraints and unverified live-platform cases.
