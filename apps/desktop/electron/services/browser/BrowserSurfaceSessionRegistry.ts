import { type Session, session } from "electron";

import type { BrowserSurfaceDescriptor } from "../../../../../shared/browserSurfaceTypes";
import { partitionForDescriptor } from "../../../../../shared/browserSurfaceSessions";

/**
 * Owns the Electron sessions behind browser surfaces.
 *
 * Extracted from `T3BrowserSurfaceService` so the storage boundary is one
 * reviewable object rather than a private method on a service that also does
 * navigation policy, T3 wiring and DevApp bridging. The partition rules
 * themselves are unchanged and still live in `shared/browserSurfaceSessions`:
 * this decides how a session is *configured*, not which surfaces share one.
 */

/**
 * Protocol handlers a session may need before any content loads.
 *
 * Injected rather than imported so the registry does not depend on the DevApp
 * services, and so tests can observe exactly which surface kinds trigger a
 * registration.
 */
export interface BrowserSurfaceProtocolRegistrar {
  registerOrgDevAppProtocol(browserSession: Session, publicationId: string): void;
  registerDevAppPreviewProtocol(browserSession: Session, devSourceId: string): void;
}

export interface BrowserSurfaceSessionRegistryOptions {
  readonly allowedPermissions: ReadonlySet<string>;
  readonly protocols: BrowserSurfaceProtocolRegistrar;
}

export class BrowserSurfaceSessionRegistry {
  private readonly sessionsByPartition = new Map<string, Session>();
  private readonly options: BrowserSurfaceSessionRegistryOptions;

  constructor(options: BrowserSurfaceSessionRegistryOptions) {
    this.options = options;
  }

  /** The storage boundary a descriptor belongs to. */
  partitionFor(descriptor: BrowserSurfaceDescriptor): string {
    return partitionForDescriptor(descriptor);
  }

  /**
   * Whether a descriptor's storage survives the surface being closed.
   *
   * Ephemeral surfaces get a non-`persist:` partition, so Electron discards
   * their cookies and storage with the session.
   */
  isPersistent(descriptor: BrowserSurfaceDescriptor): boolean {
    return this.partitionFor(descriptor).startsWith("persist:");
  }

  /**
   * The configured session for a descriptor, created once per partition.
   *
   * Surfaces that resolve to the same partition deliberately receive the same
   * session object -- that is what sharing storage means.
   */
  resolve(descriptor: BrowserSurfaceDescriptor): Session {
    return this.ensure(this.partitionFor(descriptor), descriptor);
  }

  /** Resolve a bare partition, for callers that hold no descriptor. */
  resolvePartition(partition: string): Session {
    return this.ensure(partition, null);
  }

  private ensure(partition: string, descriptor: BrowserSurfaceDescriptor | null): Session {
    const existing = this.sessionsByPartition.get(partition);
    if (existing) return existing;

    const browserSession = session.fromPartition(partition);
    // Present as an ordinary browser: neither the Electron version nor Cozea's
    // belongs in a request a third-party site sees.
    const userAgent = browserSession
      .getUserAgent()
      .replace(/Electron\/[\d.]+ /, "")
      .replace(/\s*Cozea\/[\d.]+/, "");
    browserSession.setUserAgent(userAgent);
    browserSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(this.options.allowedPermissions.has(permission));
    });
    browserSession.setPermissionCheckHandler((_webContents, permission) =>
      this.options.allowedPermissions.has(permission),
    );
    browserSession.on("will-download", (event) => event.preventDefault());
    if (descriptor?.kind === "orgDevApp" && descriptor.publicationId) {
      this.options.protocols.registerOrgDevAppProtocol(browserSession, descriptor.publicationId);
    } else if (descriptor?.kind === "devAppPreview" && descriptor.devSourceId) {
      this.options.protocols.registerDevAppPreviewProtocol(browserSession, descriptor.devSourceId);
    }
    this.sessionsByPartition.set(partition, browserSession);
    return browserSession;
  }

  /** Every session created so far, for scope-wide clears. */
  sessions(): ReadonlyArray<Session> {
    return Array.from(this.sessionsByPartition.values());
  }

  hasPartition(partition: string): boolean {
    return this.sessionsByPartition.has(partition);
  }

  /** An already-created session, without creating one as a side effect. */
  peek(partition: string): Session | undefined {
    return this.sessionsByPartition.get(partition);
  }

  /**
   * Drop a partition so the next resolve reconfigures a fresh session.
   *
   * Used when the last surface on an ephemeral partition goes away and its
   * storage has been cleared; the session object itself is owned by Electron.
   */
  forget(partition: string): void {
    this.sessionsByPartition.delete(partition);
  }
}
