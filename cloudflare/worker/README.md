# Cloudflare Collaboration Worker

This package is the replacement for the current Railway-hosted collaboration gateway.

Target responsibilities:

- `GET /health`
- `GET /collab/capabilities`
- `POST /collab/session`
- websocket upgrade routing
- collab JWT signing and verification
- Durable Object room fanout and ephemeral presence

Principles:

- Convex remains the durable system of record
- Durable Objects are coordinators, not databases of record
- Electron collaboration auth is device-first, not cookie-first
- the deployed backend must match the repository layout

Files:

- `src/index.ts`: Worker entrypoint and routing
- `src/routes/*`: HTTP route handlers
- `src/durableObjects/CollabRoom.ts`: room coordinator
- `src/lib/convex.ts`: Convex bridge interface
- `src/lib/jwt.ts`: short-lived collab token signing helpers
- `src/lib/protocol.ts`: websocket protocol constants and message shapes
- `PROTOCOL.md`: canonical protocol contract
