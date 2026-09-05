# Repository authority during lifecycle changes

Repository credentials and connected-room authority now require the project's
current organization to match its verified repository binding. Moving a project
does not transfer access to the previous organization's installation. The project
must select an authorized repository under its current organization before live
collaboration can continue.

Start rechecks installation-wide revocation, repository identity, owner/name and
organization after branch resolution. An expired proof, changed binding or removed
installation cannot create a new session. Creation retries compare their original
target SHA with the immutable starting target, so session publication does not
invalidate an otherwise identical request.

Fourteen behavioral tests invoke production handlers and the real device-claim,
project and organization authorization helpers. They cover forged installations,
cross-organization catalogs, project moves, revoked devices and token boundaries,
viewer/observer denial, revoked/expired branch proofs, repository rebinding,
creation gating and creation retry after publication. Registration, database
queries and the platform's verified-JWT boundary are controlled fixtures; these
tests do not claim live Convex transaction concurrency or OAuth acceptance.
Related key-rotation fixtures now include the project's organization and verified
repository names instead of omitting those authority inputs.
