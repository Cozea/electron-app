const { Dimensions, AppState, Platform } = require("react-native");
const inspectorBridge = require("./inspector_bridge");
const DimensionsObserver = require("./dimensions_observer");

const eps = 1;

const INSPECTOR_AVAILABLE_STATUS = "available";
const INSPECTOR_UNAVAILABLE_EDGE_TO_EDGE_STATUS = "unavailableEdgeToEdge";
const INSPECTOR_UNAVAILABLE_INACTIVE_STATUS = "unavailableInactive";

let isAppStateActive = true;
let isEdgeToEdge = true;
let isFocused = true;
let lastEstablishedAvailability = null;

const determineIfEdgeToEdge = () => {
  const { width: screenWidth, height: screenHeight } = Dimensions.get("screen");
  const { width: windowWidth, height: windowHeight } = DimensionsObserver.getWindowDimensions();

  const { screenGreater, screenLesser } =
    screenWidth > screenHeight
      ? { screenGreater: screenWidth, screenLesser: screenHeight }
      : { screenGreater: screenHeight, screenLesser: screenWidth };

  const { windowGreater, windowLesser } =
    windowWidth > windowHeight
      ? { windowGreater: windowWidth, windowLesser: windowHeight }
      : { windowGreater: windowHeight, windowLesser: windowWidth };

  return (
    Math.abs(screenGreater - windowGreater) <= eps &&
    Math.abs(screenLesser - windowLesser) <= eps
  );
};

const updateAvailabilityAndSendMessage = () => {
  let availabilityStatus = INSPECTOR_AVAILABLE_STATUS;
  if (!isEdgeToEdge) {
    availabilityStatus = INSPECTOR_UNAVAILABLE_EDGE_TO_EDGE_STATUS;
  }
  if (!isAppStateActive || !isFocused) {
    availabilityStatus = INSPECTOR_UNAVAILABLE_INACTIVE_STATUS;
  }

  if (availabilityStatus !== lastEstablishedAvailability) {
    lastEstablishedAvailability = availabilityStatus;
    inspectorBridge.sendMessage({
      type: "inspectorAvailabilityChanged",
      data: availabilityStatus,
    });
  }
};

const initializeInspectorAvailability = () => {
  isEdgeToEdge = determineIfEdgeToEdge();
  isAppStateActive = AppState.currentState === "active";
  updateAvailabilityAndSendMessage();
};

export function setup() {
  initializeInspectorAvailability();

  const handleDimensionsChange = () => {
    isEdgeToEdge = determineIfEdgeToEdge();
    updateAvailabilityAndSendMessage();
  };

  const handleAppStateChange = (appState) => {
    isAppStateActive = appState === "active";
    updateAvailabilityAndSendMessage();
  };

  const handleBlurChange = () => {
    isFocused = false;
    updateAvailabilityAndSendMessage();
  };

  const handleFocusChange = () => {
    isFocused = true;
    updateAvailabilityAndSendMessage();
  };

  let appBlurSubscription = null;
  let appFocusSubscription = null;

  const dimensionEventSubscription = DimensionsObserver.addListener(handleDimensionsChange);
  const appStateSubscription = AppState.addEventListener("change", handleAppStateChange);

  if (Platform.OS === "android") {
    appBlurSubscription = AppState.addEventListener("blur", handleBlurChange);
    appFocusSubscription = AppState.addEventListener("focus", handleFocusChange);
  }

  return function cleanup() {
    dimensionEventSubscription?.remove();
    appStateSubscription?.remove();
    appBlurSubscription?.remove();
    appFocusSubscription?.remove();
  };
}
