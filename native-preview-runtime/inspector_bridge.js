let agent = globalThis.__cozea_native_preview_agent;

if (!agent) {
  agent = require("./react_devtools_agent");
}

const messageListeners = [];
let nextMessageId = 1;
const unacknowledgedMessages = [];

const inspectorBridge = {
  sendMessage(message) {
    const messageWithId = { id: nextMessageId++, ...message };
    unacknowledgedMessages.push(messageWithId);
    agent.postMessage(messageWithId);
  },
  addMessageListener(listener) {
    messageListeners.push(listener);
  },
  removeMessageListener(listener) {
    const index = messageListeners.indexOf(listener);
    if (index !== -1) {
      messageListeners.splice(index, 1);
    }
  },
};

let wakeupTimeout = null;
agent.onmessage = (message) => {
  const { Platform } = require("react-native");

  if (
    wakeupTimeout === null &&
    Platform.constants.reactNativeVersion.major === 0 &&
    Platform.constants.reactNativeVersion.minor === 76
  ) {
    wakeupTimeout = setTimeout(() => {
      wakeupTimeout = null;
    }, 0);
  }

  if (message.type === "ack") {
    const nextUnreceivedIndex = unacknowledgedMessages.findIndex((entry) => entry.id > message.id);
    unacknowledgedMessages.splice(
      0,
      nextUnreceivedIndex === -1 ? unacknowledgedMessages.length : nextUnreceivedIndex
    );
    return;
  }

  if (message.type === "retransmit") {
    const lastReceivedId = message.id;
    unacknowledgedMessages.forEach((entry) => {
      if (entry.id > lastReceivedId) {
        agent.postMessage(entry);
      }
    });
    unacknowledgedMessages.length = 0;
    return;
  }

  messageListeners.forEach((listener) => listener(message));
};

module.exports = inspectorBridge;
