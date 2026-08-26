/**
 * Cozea substrate server — T3-shaped entry behind the shadow readiness contract.
 *
 * Today this package hosts the shadow HTTP/RPC server and assistant-runtime boot
 * for primary mode. Full upstream T3 `apps/server` DDD body replaces the runtime
 * boot incrementally without changing the readiness contract.
 */
export {
  bootstrapCozeaSubstrateServer,
  type BootstrapCozeaSubstrateServerOptions,
} from "./bootstrap";
