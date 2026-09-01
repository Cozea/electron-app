/**
 * A durable, transportable handle for a DevApp.
 *
 * Publication refs are cloud-resolvable without carrying release internals such as
 * storage ids, content hashes, or entry paths. Development refs deliberately carry an
 * opaque source id rather than a local path.
 */
export type DevAppRef =
  | { kind: "builtin"; appId: string }
  | { kind: "development"; sourceId: string }
  | {
      kind: "publication";
      organizationId: string;
      publicationId: string;
      version: number | "latest";
    };

export const DEV_APP_REF_SCHEME = "cozea-devapp";

/** Refs arrive from stored config and agents, so the grammar is deliberately tight. */
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_REF_LENGTH = 512;

function isValidSegment(value: string): boolean {
  return SEGMENT_PATTERN.test(value);
}

export function formatDevAppRef(ref: DevAppRef): string {
  if (ref.kind === "builtin") return `${DEV_APP_REF_SCHEME}:builtin/${ref.appId}`;
  if (ref.kind === "development") return `${DEV_APP_REF_SCHEME}:dev/${ref.sourceId}`;
  const version = ref.version === "latest" ? "" : `@${ref.version}`;
  return `${DEV_APP_REF_SCHEME}:${ref.organizationId}/${ref.publicationId}${version}`;
}

/** Parses a ref and fails closed on malformed or untrusted input. */
export function parseDevAppRef(value: string): DevAppRef | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_REF_LENGTH) return null;

  const prefix = `${DEV_APP_REF_SCHEME}:`;
  if (!value.startsWith(prefix)) return null;
  const body = value.slice(prefix.length);

  const slash = body.indexOf("/");
  if (slash <= 0) return null;
  const owner = body.slice(0, slash);
  const rest = body.slice(slash + 1);
  if (!rest || rest.includes("/")) return null;

  if (owner === "builtin") {
    if (rest.includes("@") || !isValidSegment(rest)) return null;
    return { kind: "builtin", appId: rest };
  }

  if (owner === "dev") {
    if (rest.includes("@") || !isValidSegment(rest)) return null;
    return { kind: "development", sourceId: rest };
  }

  if (!isValidSegment(owner)) return null;

  const at = rest.lastIndexOf("@");
  if (at === -1) {
    return isValidSegment(rest)
      ? { kind: "publication", organizationId: owner, publicationId: rest, version: "latest" }
      : null;
  }

  const publicationId = rest.slice(0, at);
  const versionText = rest.slice(at + 1);
  if (!isValidSegment(publicationId)) return null;
  if (!/^[0-9]{1,9}$/.test(versionText)) return null;
  const version = Number.parseInt(versionText, 10);
  if (!Number.isSafeInteger(version) || version < 1) return null;
  return { kind: "publication", organizationId: owner, publicationId, version };
}

export function devAppRefsEqual(left: DevAppRef, right: DevAppRef): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "builtin" && right.kind === "builtin") return left.appId === right.appId;
  if (left.kind === "development" && right.kind === "development") {
    return left.sourceId === right.sourceId;
  }
  if (left.kind === "publication" && right.kind === "publication") {
    return (
      left.organizationId === right.organizationId &&
      left.publicationId === right.publicationId &&
      left.version === right.version
    );
  }
  return false;
}

/** True when both refs name the same app, disregarding the selected release. */
export function devAppRefsSameApp(left: DevAppRef, right: DevAppRef): boolean {
  if (left.kind === "builtin" && right.kind === "builtin") return left.appId === right.appId;
  if (left.kind === "development" && right.kind === "development") {
    return left.sourceId === right.sourceId;
  }
  if (left.kind === "publication" && right.kind === "publication") {
    return (
      left.organizationId === right.organizationId && left.publicationId === right.publicationId
    );
  }
  return false;
}
