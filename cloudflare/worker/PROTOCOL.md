# Collaboration Protocol v2

This is the Cloudflare-native collaboration protocol that replaces the current Railway/Fastify socket contract.

## Goals

- keep the protocol small
- make reconnection deterministic
- separate durable sync from ephemeral presence
- keep Electron auth device-based

## Session Bootstrap

### `POST /collab/session`

Request body:

```json
{
  "projectId": "project_123",
  "clientType": "electron",
  "deviceId": "device_123",
  "deviceLabel": "Admin MacBook Pro",
  "platform": "darwin",
  "publicKeyJwk": "{...}",
  "publicKeyAlgorithm": "ECDH",
  "fingerprint": "fingerprint_123"
}
```

Response body:

```json
{
  "projectId": "project_123",
  "roomId": "project:project_123",
  "collabWsUrl": "wss://collab.example.com/collab/ws",
  "token": "<jwt>",
  "protocolVersion": "2.0",
  "deviceId": "device_123",
  "encryption": {
    "roomId": "project:project_123",
    "encryptionRequired": true,
    "status": "ready",
    "activeKeyVersion": 1,
    "wrappedRoomKey": "base64",
    "wrapAlgorithm": "RSA-OAEP-256",
    "senderPublicKeyJwk": "{...}"
  }
}
```

## Websocket Handshake

Client opens websocket on `/collab/ws?roomId=<roomId>` and immediately sends:

```json
{
  "type": "hello",
  "payload": {
    "protocolVersion": "2.0",
    "projectId": "project_123",
    "roomId": "project:project_123",
    "sessionToken": "<jwt>",
    "clientId": "yjs-client-id",
    "knownSeq": 42,
    "clientType": "electron"
  }
}
```

Server replies:

```json
{
  "type": "ready",
  "payload": {
    "roomId": "project:project_123",
    "serverTime": 1776500000000,
    "headSeq": 45,
    "resyncRequired": true
  }
}
```

## Durable Sync Messages

### Client to server

`sync.request`

```json
{
  "type": "sync.request",
  "payload": {
    "roomId": "project:project_123",
    "knownSeq": 42
  }
}
```

`update.push`

```json
{
  "type": "update.push",
  "payload": {
    "roomId": "project:project_123",
    "idempotencyKey": "update_abc",
    "updateBinary": "base64",
    "authorType": "user",
    "authorId": "user_123",
    "timestamp": 1776500000000
  }
}
```

### Server to client

`sync.delta`

```json
{
  "type": "sync.delta",
  "payload": {
    "roomId": "project:project_123",
    "fromSeq": 42,
    "toSeq": 45,
    "updatesBinary": ["base64", "base64", "base64"]
  }
}
```

`update.ack`

```json
{
  "type": "update.ack",
  "payload": {
    "roomId": "project:project_123",
    "seq": 46,
    "idempotencyKey": "update_abc",
    "persisted": true
  }
}
```

## Ephemeral Presence Messages

`presence.push`

```json
{
  "type": "presence.push",
  "payload": {
    "roomId": "project:project_123",
    "clientId": "yjs-client-id",
    "awarenessBinary": "base64",
    "ttlMs": 45000
  }
}
```

`presence.snapshot`

```json
{
  "type": "presence.snapshot",
  "payload": {
    "roomId": "project:project_123",
    "entries": [
      {
        "clientId": "123",
        "awarenessBinary": "base64",
        "expiresAt": 1776500045000
      }
    ]
  }
}
```

`presence.remove`

```json
{
  "type": "presence.remove",
  "payload": {
    "roomId": "project:project_123",
    "clientIds": ["123"]
  }
}
```

## Error Contract

All protocol errors use:

```json
{
  "type": "error",
  "payload": {
    "code": "INVALID_SESSION_TOKEN",
    "message": "Session token verification failed",
    "recoverable": false,
    "retryAfterMs": 0
  }
}
```

Recommended error codes:

- `BAD_REQUEST`
- `INVALID_PROTOCOL_VERSION`
- `INVALID_SESSION_TOKEN`
- `ROOM_MISMATCH`
- `PROJECT_ACCESS_DENIED`
- `RATE_LIMITED`
- `INTERNAL_ERROR`

## Design Notes

- Durable sync goes through Convex for persistence
- presence lives in Durable Object memory and DO storage only as short-lived coordination state
- reconnects always begin with `hello`, then `sync.request`
- the Worker signs the session token and the Durable Object verifies it
