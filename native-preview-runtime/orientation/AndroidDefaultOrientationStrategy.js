const { UIManager, NativeEventEmitter, NativeModules } = require("react-native");
const NativeUIManager = NativeModules.UIManager ?? UIManager;
const inspectorBridge = require("../inspector_bridge");
const DimensionsObserver = require("../dimensions_observer");

const androidOrientationMapping = {
  "portrait-primary": "Portrait",
  "portrait-secondary": "PortraitUpsideDown",
  "landscape-primary": "LandscapeLeft",
  "landscape-secondary": "LandscapeRight",
};

let currentAppOrientation = null;

const getMappedOrientation = (orientation) => {
  return androidOrientationMapping[orientation] ?? "Portrait";
};

function initializeOrientationAndSendInitMessage() {
  const { width: screenWidth, height: screenHeight } = DimensionsObserver.getScreenDimensions();
  const isLandscape = screenWidth > screenHeight;
  currentAppOrientation = isLandscape ? "Landscape" : "Portrait";
  inspectorBridge.sendMessage({
    type: "appOrientationChanged",
    data: currentAppOrientation,
  });
}

function updateOrientationAndSendMessage(orientation) {
  const mappedOrientation = getMappedOrientation(orientation);

  if (currentAppOrientation !== mappedOrientation) {
    currentAppOrientation = mappedOrientation;
    inspectorBridge.sendMessage({
      type: "appOrientationChanged",
      data: mappedOrientation,
    });
  }
}

function setupOrientationListener(callback) {
  const handleOrientationChange = ({ name: orientation }) => {
    updateOrientationAndSendMessage(orientation);
    callback?.(orientation);
  };

  const originalConsoleWarn = console.warn;
  console.warn = () => {};

  const orientationEventSubscription = new NativeEventEmitter(NativeUIManager).addListener(
    "namedOrientationDidChange",
    handleOrientationChange
  );

  console.warn = originalConsoleWarn;

  return function cleanup() {
    orientationEventSubscription?.remove();
  };
}

export function getStrategy() {
  return {
    initializeOrientationAndSendInitMessage,
    updateOrientationAndSendMessage,
    setupOrientationListener,
  };
}
