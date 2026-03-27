const { Platform } = require("react-native");
const ExpoOrientationStrategy = require("./ExpoOrientationStrategy");
const OrientationLockerStrategy = require("./OrientationLockerStrategy");
const IosDefaultOrientationStrategy = require("./IosDefaultOrientationStrategy");
const AndroidDefaultOrientationStrategy = require("./AndroidDefaultOrientationStrategy");

const getOrientationStrategy = () => {
  if (Platform.OS === "android") {
    return AndroidDefaultOrientationStrategy.getStrategy();
  }

  if (ExpoOrientationStrategy) {
    return ExpoOrientationStrategy.getStrategy();
  }

  if (OrientationLockerStrategy) {
    return OrientationLockerStrategy.getStrategy();
  }

  return IosDefaultOrientationStrategy.getStrategy();
};

const orientationStrategy = getOrientationStrategy();

export function setup() {
  orientationStrategy.initializeOrientationAndSendInitMessage();
  return orientationStrategy.setupOrientationListener();
}
