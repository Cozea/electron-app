# Target branch changes

New sessions record the verified target commit at creation in `targetCommitSha`.
Publication updates the shared base while retaining that starting target identity.
Older descriptors remain readable but explicitly show an unknown starting target;
the current published base is never substituted for missing evidence.

The session control checks the target through the existing authorized repository
resolver when opened and on explicit refresh. It validates repository, branch and
SHA identity. It does not poll this resolver every few seconds: each resolution
creates a short-lived server proof intended for a possible Start.

When the target differs, participants can continue on the session branch. Editors
can end for everyone and return to a reviewed Start with the same target selected.
This checks repository access and the original workspace association before End,
clears previously selected imports, and uses a new creation identity. Start itself
resolves the latest remote SHA again. Existing work remains in the retained old
session workspace. These controls never merge, rebase or reset session work.
Observer sessions expose no End action. Failed access checks retain the current
session and offer retry; interrupted End does not report a successful restart.

Validation: five behavioral tests use temporary Git repositories, a bare remote
and a linked session worktree. They verify independent target/publication changes,
unchanged dirty text/binaries/index, restart selection and access/failure handling.
Together with the existing session model suite, 21 tests passed. Renderer, test
and Convex typechecks and focused lint passed. End dependencies are controlled in
the orchestration tests; real Host teardown and packaged UI remain separate gates.
