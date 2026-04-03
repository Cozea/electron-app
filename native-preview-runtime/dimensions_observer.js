const { Dimensions, Platform } = require("react-native");

class DimensionsObserver {
  constructor() {
    this.dimensionsListeners = [];
    const { width, height } = Dimensions.get("window");
    this.currentWindowDimensions = { width, height };
  }

  emitDimensionsChange(nextDimensions) {
    this.currentWindowDimensions = nextDimensions;

    this.dimensionsListeners.forEach((listener) => {
      try {
        listener(nextDimensions);
      } catch (error) {
        console.error("Error in native preview dimension listener:", error);
      }
    });
  }

  getWindowDimensions() {
    return this.currentWindowDimensions;
  }

  getScreenDimensions() {
    if (Platform.isPad) {
      return this.getWindowDimensions();
    }

    const { width, height } = Dimensions.get("screen");
    return { width, height };
  }

  addListener(callback) {
    this.dimensionsListeners.push(callback);

    return {
      remove: () => {
        this.dimensionsListeners = this.dimensionsListeners.filter(
          (listener) => listener !== callback
        );
      },
    };
  }

  removeAllListeners() {
    this.dimensionsListeners = [];
  }
}

module.exports = new DimensionsObserver();
