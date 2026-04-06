const { UIManager, NativeEventEmitter, NativeModules } = require("react-native");
const NativeUIManager = NativeModules.UIManager ?? UIManager;
const inspectorBridge = require("../inspector_bridge");
const DimensionsObserver = require("../dimensions_observer");

const iosOrientationMapping = {
  "portrait-primary": "Portrait",
  "portrait-secondary": "PortraitUpsideDown",
  "landscape-primary": "LandscapeRight",
  "landscape-secondary": "LandscapeLeft",
};

let currentAppOrientation = null;
let lastRegisteredOrientation = null;

const getMappedOrientation = (orientation, isLandscape) => {
  if (orientation === null) {
    return isLandscape ? "Landscape" : "Portrait";
  }

  if (
    isLandscape &&
    (orientation === "portrait-primary" || orientation === "portrait-secondary")
  ) {
    if (currentAppOrientation === "LandscapeLeft" || currentAppOrientation === "LandscapeRight") {
      return currentAppOrientation;
    }
    return "Landscape";
  }

  if (
    !isLandscape &&
    (orientation === "landscape-primary" || orientation === "landscape-secondary")
  ) {
    if (currentAppOrientation === "Portrait" || currentAppOrientation === "PortraitUpsideDown") {
      return currentAppOrientation;
    }
    return "Portrait";
  }

  return iosOrientationMapping[orientation];
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
  const { width: screenWidth, height: screenHeight } = DimensionsObserver.getScreenDimensions();
  const isLandscape = screenWidth > screenHeight;
  const mappedOrientation = getMappedOrientation(orientation, isLandscape);

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
    lastRegisteredOrientation = orientation;
    updateOrientationAndSendMessage(orientation);
    callback?.(orientation);
  };

  const handleDimensionsChange = () => {
    updateOrientationAndSendMessage(lastRegisteredOrientation);
    callback?.(lastRegisteredOrientation);
  };

  const originalConsoleWarn = console.warn;
  console.warn = () => {};

  const orientationEventSubscription = new NativeEventEmitter(NativeUIManager).addListener(
    "namedOrientationDidChange",
    handleOrientationChange
  );

  const dimensionsChangeSubscription = DimensionsObserver.addListener(handleDimensionsChange);
  console.warn = originalConsoleWarn;

  return function cleanup() {
    orientationEventSubscription?.remove();
    dimensionsChangeSubscription?.remove();
  };
}

export function getStrategy() {
  return {
    initializeOrientationAndSendInitMessage,
    updateOrientationAndSendMessage,
    setupOrientationListener,
  };
}
