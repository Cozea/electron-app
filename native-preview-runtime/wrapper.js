"use no memo";

const { useContext, useState, useEffect, useRef, useCallback } = require("react");
const {
  LogBox,
  AppRegistry,
  RootTagContext,
  View,
  Linking,
  findNodeHandle,
  Platform,
  Dimensions,
  DevSettings,
} = require("react-native");
const { storybookPreview } = require("./storybook/storybook_helper");
require("./react_devtools_agent");
const inspectorBridge = require("./inspector_bridge");
const DimensionsObserver = require("./dimensions_observer");

const OffscreenComponentReactTag = 22;

const navigationPlugins = [];
export function registerNavigationPlugin(name, plugin) {
  navigationPlugins.push({ name, plugin });
}

const devtoolPlugins = new Set(["network"]);
const devtoolPluginsChangedListeners = new Set();
export function registerDevtoolPlugin(name) {
  if (devtoolPlugins.has(name)) {
    return;
  }
  devtoolPlugins.add(name);
  devtoolPluginsChangedListeners.forEach((listener) => listener());
}

globalThis.__COZEA_NATIVE_PREVIEW_reloadJS = function () {
  DevSettings.reload("Cozea Native Preview");
};

let navigationHistory = new Map();
let mainApplicationKey = undefined;

AppRegistry.registerComponent("__cozea_native_preview_dummy_component", () => View);

const InternalImports = {
  get PREVIEW_APP_KEY() {
    return require("./preview").PREVIEW_APP_KEY;
  },
  get setupNetworkPlugin() {
    return require("./network/network").setup;
  },
  get setupRenderOutlinesPlugin() {
    return require("./render_outlines").setup;
  },
  get setupOrientationListeners() {
    return require("./orientation/orientation").setup;
  },
  get setupInspectorAvailabilityListeners() {
    return require("./inspector_availability").setup;
  },
};

const RNInternals = require("./rn-internals/rn-internals");

function getCurrentScene() {
  return RNInternals.SceneTracker.getActiveScene().name;
}

function defaultNavigationHook({ onNavigationChange }) {
  return {
    getCurrentNavigationDescriptor: () => undefined,
    requestNavigationChange: (navigationDescriptor) => {
      if (navigationDescriptor.id === "__BACK__" || navigationDescriptor.id === "__HOME__") {
        onNavigationChange({ id: "__HOME__", name: undefined, canGoBack: false });
      } else {
        onNavigationChange(navigationDescriptor);
      }
    },
  };
}

function getRendererConfig() {
  const renderers = Array.from(window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.values());
  if (!renderers) {
    return undefined;
  }
  for (const renderer of renderers) {
    if (renderer.rendererConfig?.getInspectorDataForInstance) {
      return renderer.rendererConfig;
    }
  }
  return undefined;
}

function sourceInfoFromInspectorData(inspectorData) {
  const source = inspectorData.source;
  if (source) {
    return {
      fileName: source.fileName,
      line0Based: source.lineNumber - 1,
      column0Based: source.columnNumber - 1,
    };
  }
  return undefined;
}

function extractComponentStack(startNode, viewDataHierarchy) {
  const rendererConfig = getRendererConfig();
  const componentStack = [];

  if (rendererConfig) {
    let node = startNode;

    while (node && node.tag !== OffscreenComponentReactTag) {
      try {
        const data = rendererConfig.getInspectorDataForInstance(node);
        const item = data.hierarchy[data.hierarchy.length - 1];
        const inspectorData = item.getInspectorData(findNodeHandle);
        let source = sourceInfoFromInspectorData(inspectorData);

        const debugStack = node._debugStack;
        if (debugStack && debugStack.stack) {
          const parsedStack = RNInternals.parseErrorStack(debugStack.stack);
          if (parsedStack.length > 1) {
            const { file, lineNumber, column } = parsedStack[1];
            source = {
              fileName: file,
              line0Based: lineNumber - 1,
              column0Based: column - 1,
            };
          }
        }

        if (source) {
          componentStack.push({
            name: item.name,
            source,
            measure: inspectorData.measure,
          });
        }

        node = node.return;
      } catch {
        break;
      }
    }
  } else if (viewDataHierarchy && viewDataHierarchy.length > 0) {
    viewDataHierarchy.reverse().forEach((item) => {
      let inspectorData = {};
      if (item.getInspectorData) {
        inspectorData = item.getInspectorData(findNodeHandle);
      }
      const source = sourceInfoFromInspectorData(inspectorData);
      if (source) {
        componentStack.push({
          name: item.name,
          source,
          measure: inspectorData.measure,
        });
      }
    });
  }

  return componentStack;
}

function getInspectorDataForCoordinates(mainContainerRef, x, y, requestStack, callback) {
  const { width: screenWidth, height: screenHeight } = DimensionsObserver.getScreenDimensions();

  RNInternals.getInspectorDataForViewAtPoint(
    mainContainerRef.current,
    x * screenWidth,
    y * screenHeight,
    (viewData) => {
      const frame = viewData.frame;
      const scaledFrame = {
        x: frame.left / screenWidth,
        y: frame.top / screenHeight,
        width: frame.width / screenWidth,
        height: frame.height / screenHeight,
      };

      if (!requestStack) {
        callback({ frame: scaledFrame });
        return;
      }

      const inspectorDataStack = extractComponentStack(viewData.closestInstance, viewData.hierarchy);
      Promise.all(
        inspectorDataStack.map(
          (inspectorData) =>
            new Promise((resolve) => {
              try {
                inspectorData.measure((_x, _y, viewWidth, viewHeight, pageX, pageY) => {
                  resolve({
                    componentName: inspectorData.name,
                    source: inspectorData.source,
                    frame: {
                      x: pageX / screenWidth,
                      y: pageY / screenHeight,
                      width: viewWidth / screenWidth,
                      height: viewHeight / screenHeight,
                    },
                  });
                });
              } catch {
                resolve({ componentName: inspectorData.name, source: inspectorData.source });
              }
            })
        )
      ).then((componentDataStack) => {
        callback({
          frame: scaledFrame,
          stack: componentDataStack,
        });
      });
    }
  );
}

export function AppWrapper({ children, initialProps, fabric }) {
  "use no memo";

  if (!mainApplicationKey) {
    mainApplicationKey = getCurrentScene();
  }

  const rootTag = useContext(RootTagContext);
  const [hasLayout, setHasLayout] = useState(false);
  const mainContainerRef = useRef();

  const handleNavigationChange = useCallback((navigationDescriptor) => {
    navigationHistory.set(navigationDescriptor.id, navigationDescriptor);
    inspectorBridge.sendMessage({
      type: "navigationChanged",
      data: {
        displayName: navigationDescriptor.name,
        id: navigationDescriptor.id,
        canGoBack: navigationDescriptor.canGoBack,
      },
    });
  });

  const handleRouteListChange = useCallback((routeList) => {
    inspectorBridge.sendMessage({
      type: "navigationRouteListUpdated",
      data: routeList,
    });
  }, []);

  const navigationPluginHook = navigationPlugins[0]?.plugin.mainHook;
  const usesDefaultNavigationHook =
    initialProps?.__cozea_native_previewKey !== undefined || !navigationPluginHook;
  const useNavigationMainHook = usesDefaultNavigationHook ? defaultNavigationHook : navigationPluginHook;
  const { requestNavigationChange } = useNavigationMainHook({
    onNavigationChange: handleNavigationChange,
    onRouteListChange: handleRouteListChange,
  });

  const openPreview = useCallback(
    (previewKey) => {
      const preview = global.__COZEA_NATIVE_PREVIEW_previews.get(previewKey);
      if (!preview) {
        console.error(
          "Requested preview has not been registered. Previews currently work only for files loaded by the main application bundle."
        );
        throw new Error("Preview not found");
      }

      const urlPrefix = previewKey.startsWith("sb://") ? "sb:" : "preview:";
      AppRegistry.runApplication(InternalImports.PREVIEW_APP_KEY, {
        rootTag,
        initialProps: {
          ...initialProps,
          __cozea_native_onLayout: undefined,
          __cozea_native_nextNavigationDescriptor: {
            id: previewKey,
            name: urlPrefix + preview.name,
            canGoBack: true,
          },
          __cozea_native_previewKey: previewKey,
        },
        fabric,
      });
    },
    [rootTag, initialProps, fabric]
  );

  const openMainApp = useCallback(
    (nextNavigationDescriptor, forceRerender) => {
      let appOpenPromiseResolve;
      const appOpenPromise = new Promise((resolve) => {
        appOpenPromiseResolve = resolve;
      });

      const mainAppKey = mainApplicationKey ?? "main";
      if (getCurrentScene() !== mainAppKey || forceRerender) {
        const runApplication = () =>
          AppRegistry.runApplication(mainAppKey, {
            rootTag,
            initialProps: {
              ...initialProps,
              __cozea_native_onLayout: appOpenPromiseResolve,
              __cozea_native_nextNavigationDescriptor: nextNavigationDescriptor,
              __cozea_native_previewKey: undefined,
            },
            fabric,
          });

        if (forceRerender) {
          AppRegistry.runApplication("__cozea_native_preview_dummy_component", { rootTag, fabric });
          setTimeout(runApplication, 0);
        } else {
          runApplication();
        }
      } else {
        nextNavigationDescriptor && requestNavigationChange(nextNavigationDescriptor);
        appOpenPromiseResolve();
      }

      return appOpenPromise;
    },
    [rootTag, initialProps, fabric]
  );

  const showStorybookStory = useCallback(
    async (componentTitle, storyName) => {
      const previewKey = await storybookPreview(componentTitle, storyName);
      if (previewKey !== undefined) {
        openPreview(previewKey);
      }
    },
    [openPreview]
  );

  const openNavigation = useCallback(
    (message) => {
      const isPreviewUrl = message.id.startsWith("preview://") || message.id.startsWith("sb://");
      if (isPreviewUrl) {
        openPreview(message.id);
        return;
      }

      const navigationDescriptor = navigationHistory.get(message.id) || {
        id: message.id,
        name: message.name || message.id,
        pathname: message.id,
        params: message.params || {},
      };

      const forceRerenderMainApp =
        navigationDescriptor.id === "__HOME__" && usesDefaultNavigationHook;
      openMainApp(navigationDescriptor, forceRerenderMainApp);
    },
    [openPreview, openMainApp, requestNavigationChange, usesDefaultNavigationHook]
  );

  useEffect(() => {
    const listener = (message) => {
      const { type, data } = message;
      switch (type) {
        case "openPreview":
          openPreview(data.previewId);
          break;
        case "openUrl":
          openMainApp(undefined, false).then(() => {
            Linking.openURL(data.url);
          });
          break;
        case "openNavigation":
          openNavigation(data);
          break;
        case "inspect": {
          const { id, x, y, requestStack } = data;
          getInspectorDataForCoordinates(mainContainerRef, x, y, requestStack, (inspectorData) => {
            inspectorBridge.sendMessage({
              type: "inspectData",
              data: {
                id,
                ...inspectorData,
              },
            });
          });
          break;
        }
        case "showStorybookStory":
          showStorybookStory(data.componentTitle, data.storyName);
          break;
      }
    };

    inspectorBridge.addMessageListener(listener);
    return () => inspectorBridge.removeMessageListener(listener);
  }, [openPreview, openMainApp, openNavigation, showStorybookStory]);

  useEffect(() => {
    const LoadingView = RNInternals.LoadingView;
    LoadingView.showMessage = () => {
      inspectorBridge.sendMessage({
        type: "fastRefreshStarted",
      });
    };

    const originalHide = LoadingView.hide;
    LoadingView.hide = () => {
      originalHide();
      inspectorBridge.sendMessage({
        type: "fastRefreshComplete",
      });
    };

    InternalImports.setupRenderOutlinesPlugin();
    InternalImports.setupNetworkPlugin();
    const orientationListenersCleanup = InternalImports.setupOrientationListeners();
    const inspectorAvailabilityListenersCleanup =
      InternalImports.setupInspectorAvailabilityListeners();

    const originalErrorHandler = global.ErrorUtils.getGlobalHandler();
    LogBox.ignoreAllLogs(true);

    function wrappedGlobalErrorHandler(error, isFatal) {
      try {
        RNInternals.LogBoxData.clear();
        originalErrorHandler(error, isFatal);
      } catch {}
    }

    global.ErrorUtils.setGlobalHandler(wrappedGlobalErrorHandler);
    return () => {
      global.ErrorUtils.setGlobalHandler(originalErrorHandler);
      orientationListenersCleanup();
      inspectorAvailabilityListenersCleanup();
    };
  }, []);

  useEffect(() => {
    if (hasLayout) {
      const appKey = getCurrentScene();
      inspectorBridge.sendMessage({
        type: "appReady",
        data: {
          appKey,
          navigationPlugins: navigationPlugins.map((plugin) => plugin.name),
        },
      });

      const nextNavigationDescriptor = initialProps?.__cozea_native_nextNavigationDescriptor;
      nextNavigationDescriptor && requestNavigationChange(nextNavigationDescriptor);

      const pluginsChangedCallback = () => {
        inspectorBridge.sendMessage({
          type: "devtoolPluginsChanged",
          data: {
            plugins: Array.from(devtoolPlugins.values()),
          },
        });
      };

      pluginsChangedCallback();
      devtoolPluginsChangedListeners.add(pluginsChangedCallback);
      return () => {
        devtoolPluginsChangedListeners.delete(pluginsChangedCallback);
      };
    }
  }, [hasLayout, initialProps, requestNavigationChange]);

  const onLayoutCallback = initialProps?.__cozea_native_onLayout;

  return (
    <View
      key="__COZEA_NATIVE_PREVIEW_APP_WRAPPER"
      ref={mainContainerRef}
      style={{ flex: 1 }}
      onLayout={(event) => {
        onLayoutCallback?.();
        setHasLayout(true);

        if (Platform.OS === "android") {
          const { width, height } = Dimensions.get("window");
          DimensionsObserver.emitDimensionsChange({ width, height });
        } else {
          const { width, height } = event.nativeEvent.layout;
          DimensionsObserver.emitDimensionsChange({ width, height });
        }
      }}
    >
      {children}
    </View>
  );
}

export function createNestedAppWrapper(InnerWrapperComponent) {
  function WrapperComponent(props) {
    const { children, ...rest } = props;
    return (
      <AppWrapper {...rest}>
        <InnerWrapperComponent {...rest}>{children}</InnerWrapperComponent>
      </AppWrapper>
    );
  }

  return WrapperComponent;
}
