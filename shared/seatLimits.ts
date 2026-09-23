/**
 * How many devices a project or a group may hold. Counted seats include people
 * already in and invitations still outstanding, so a full project cannot be
 * over-filled by invitations that all get accepted later.
 *
 * Enforced in Convex (see `convex/lib/seatLimits.ts`); the desktop UI reads the
 * same numbers so it can stop short of asking for something the server refuses.
 */
export const MAX_PROJECT_USERS = 5
export const MAX_ORGANIZATION_USERS = 5
