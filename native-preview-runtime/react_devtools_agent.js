const BRIDGE_MESSAGE_CHANNEL = "COZEA_NATIVE_PREVIEW_message";

let currentDevtoolsAgent = undefined;
let queuedMessages = [];

const previewAgent = {
  postMessage(message) {
    if (currentDevtoolsAgent) {
      currentDevtoolsAgent._bridge.send(BRIDGE_MESSAGE_CHANNEL, message);
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
    }
  }

  bridge.addListener(BRIDGE_MESSAGE_CHANNEL, handleBridgeMessage);
  bridge.addListener("shutdown", handleBridgeShutdown);

  const pendingMessages = queuedMessages;
  queuedMessages = [];
  pendingMessages.forEach((message) => {
    bridge.send(BRIDGE_MESSAGE_CHANNEL, message);
  });
}

const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
if (hook.reactDevtoolsAgent) {
  attachDevtoolsAgent(hook.reactDevtoolsAgent);
}
hook.on("react-devtools", attachDevtoolsAgent);

globalThis.__cozea_native_preview_agent = previewAgent;
module.exports = previewAgent;
