const inspectorBridge = require("../inspector_bridge");

let ExpoOrientation;

try {
  ExpoOrientation = require("expo-screen-orientation");
  if (!ExpoOrientation.getOrientationAsync) {
    ExpoOrientation = null;
  }
} catch {
  ExpoOrientation = null;
}

let currentAppOrientation = null;

const mapExpoOrientationToAppOrientation = (expoOrientation) => {
  switch (expoOrientation) {
    case ExpoOrientation.Orientation.LANDSCAPE_RIGHT:
      return "LandscapeLeft";
    case ExpoOrientation.Orientation.LANDSCAPE_LEFT:
      return "LandscapeRight";
    case ExpoOrientation.Orientation.PORTRAIT_DOWN:
      return "PortraitUpsideDown";
    default:
      return "Portrait";
  }
};

function initializeOrientationAndSendInitMessage() {
  ExpoOrientation.getOrientationAsync()
    .then((orientation) => {
      currentAppOrientation = mapExpoOrientationToAppOrientation(orientation);
      inspectorBridge.sendMessage({
        type: "appOrientationChanged",
        data: currentAppOrientation,
      });
    })
    .catch(() => {
      currentAppOrientation = "Portrait";
      inspectorBridge.sendMessage({
        type: "appOrientationChanged",
        data: currentAppOrientation,
      });
    });
}

function updateOrientationAndSendMessage(orientationInfo) {
  const mappedOrientation = mapExpoOrientationToAppOrientation(orientationInfo.orientation);

  if (currentAppOrientation !== mappedOrientation) {
    currentAppOrientation = mappedOrientation;
    inspectorBridge.sendMessage({
      type: "appOrientationChanged",
      data: mappedOrientation,
    });
  }
}

function setupOrientationListener(callback) {
  function handleOrientationChange(event) {
    updateOrientationAndSendMessage(event.orientationInfo);
    callback?.(event.orientationInfo);
  }

  const subscription = ExpoOrientation.addOrientationChangeListener(handleOrientationChange);

  return function cleanup() {
    subscription?.remove();
  };
}

if (!ExpoOrientation) {
  module.exports = undefined;
} else {
  module.exports = {
    getStrategy() {
      return {
        initializeOrientationAndSendInitMessage,
        updateOrientationAndSendMessage,
        setupOrientationListener,
      };
    },
  };
}
