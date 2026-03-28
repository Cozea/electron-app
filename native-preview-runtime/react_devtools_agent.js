const BRIDGE_MESSAGE_CHANNEL = "COZEA_NATIVE_PREVIEW_message";

let currentDevtoolsAgent = undefined;
let queuedMessages = [];
let runtimeBridgeSocket = undefined;
let runtimeBridgeReconnectTimer = null;

function clearRuntimeBridgeReconnectTimer() {
  if (runtimeBridgeReconnectTimer !== null) {
    clearTimeout(runtimeBridgeReconnectTimer);
    runtimeBridgeReconnectTimer = null;
  }
}

function flushQueuedMessages(send) {
  const pendingMessages = queuedMessages;
  queuedMessages = [];
  pendingMessages.forEach((message) => {
    send(message);
  });
}

function getRuntimeBridgeUrl() {
  const port = globalThis.__COZEA_NATIVE_PREVIEW_RUNTIME_BRIDGE_PORT__;
  if (typeof port !== "number" || !Number.isFinite(port) || port <= 0) {
    return null;
  }
  return `ws://127.0.0.1:${port}`;
}

function scheduleRuntimeBridgeReconnect() {
  if (currentDevtoolsAgent || runtimeBridgeReconnectTimer !== null) {
    return;
  }

  runtimeBridgeReconnectTimer = setTimeout(() => {
    runtimeBridgeReconnectTimer = null;
    ensureRuntimeBridgeSocket();
  }, 500);
}

function ensureRuntimeBridgeSocket() {
  if (currentDevtoolsAgent || runtimeBridgeSocket) {
    return;
  }

  const runtimeBridgeUrl = getRuntimeBridgeUrl();
  if (!runtimeBridgeUrl || typeof WebSocket === "undefined") {
    return;
  }

  const socket = new WebSocket(runtimeBridgeUrl);
  runtimeBridgeSocket = socket;

  socket.onopen = () => {
    clearRuntimeBridgeReconnectTimer();
    flushQueuedMessages((message) => {
      socket.send(JSON.stringify({ event: "RNIDE_message", payload: message }));
    });
  };

  socket.onmessage = (event) => {
    try {
      const envelope = JSON.parse(event.data);
      if (envelope?.event === "RNIDE_message") {
        previewAgent.onmessage?.(envelope.payload);
      }
    } catch {
      // Ignore malformed bridge envelopes.
    }
  };

  socket.onclose = () => {
    if (runtimeBridgeSocket === socket) {
      runtimeBridgeSocket = undefined;
    }
    scheduleRuntimeBridgeReconnect();
  };

  socket.onerror = () => {
    try {
      socket.close();
    } catch {
      // Ignore shutdown errors.
    }
  };
}

const previewAgent = {
  postMessage(message) {
    if (currentDevtoolsAgent) {
      currentDevtoolsAgent._bridge.send(BRIDGE_MESSAGE_CHANNEL, message);
      return;
    }
    ensureRuntimeBridgeSocket();
    if (runtimeBridgeSocket && runtimeBridgeSocket.readyState === WebSocket.OPEN) {
      runtimeBridgeSocket.send(JSON.stringify({ event: "RNIDE_message", payload: message }));
      return;
    }
    queuedMessages.push(message);
  },
  onmessage: undefined,
};

function attachDevtoolsAgent(nextDevtoolsAgent) {
  if (!nextDevtoolsAgent) {
    currentDevtoolsAgent = undefined;
    return;
  }

  currentDevtoolsAgent = nextDevtoolsAgent;
  const bridge = nextDevtoolsAgent._bridge;

  function handleBridgeMessage(message) {
    previewAgent.onmessage?.(message);
  }

  function handleBridgeShutdown() {
    if (currentDevtoolsAgent === nextDevtoolsAgent) {
      currentDevtoolsAgent = undefined;
      ensureRuntimeBridgeSocket();
    }
  }

  bridge.addListener(BRIDGE_MESSAGE_CHANNEL, handleBridgeMessage);
  bridge.addListener("shutdown", handleBridgeShutdown);

  flushQueuedMessages((message) => {
    bridge.send(BRIDGE_MESSAGE_CHANNEL, message);
  });
}

const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
if (hook.reactDevtoolsAgent) {
  attachDevtoolsAgent(hook.reactDevtoolsAgent);
}
hook.on("react-devtools", attachDevtoolsAgent);

if (!hook.reactDevtoolsAgent) {
  ensureRuntimeBridgeSocket();
}

globalThis.__cozea_native_preview_agent = previewAgent;
module.exports = previewAgent;
