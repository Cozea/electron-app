const RNInternals = require("./rn-internals/rn-internals");
const { AppRegistry } = require("react-native");

const parseErrorStack = RNInternals.parseErrorStack;

console.log("__COZEA_NATIVE_PREVIEW_INTERNAL", "cozea native preview runtime loaded");

function calculateStackOffset(stack, reentryStack) {
  for (let index = 0; index < Math.min(stack.length, reentryStack.length); index += 1) {
    const diffLine = stack[index].lineNumber !== reentryStack[index].lineNumber;
    const diffColumn = stack[index].column !== reentryStack[index].column;

    if (diffLine || diffColumn) {
      return index;
    }
  }

  return 0;
}

function wrapConsole(logFunctionKey) {
  let currentLogFunction = null;

  const originalConsoleObject = console;
  const originalLogFunction = console[logFunctionKey];

  let stackOffset = 1;
  let logFunctionReentryStack = null;
  let logFunctionReentryFlag = false;

  if (parseErrorStack === undefined) {
    // Intentionally empty. This forces parseErrorStack to be resolved before the
    // wrapped console function is returned, avoiding runtime bootstrap recursion.
  }

  return function (...args) {
    const stack = parseErrorStack(new Error().stack);

    if (logFunctionReentryFlag) {
      logFunctionReentryStack = stack;
      return;
    }

    if (currentLogFunction !== console[logFunctionKey]) {
      logFunctionReentryFlag = true;
      console[logFunctionKey]();
      logFunctionReentryFlag = false;
      stackOffset = calculateStackOffset(stack, logFunctionReentryStack);
      currentLogFunction = console[logFunctionKey];
    }

    const location = stack[stackOffset];
    if (location) {
      args.push(location.file, location.lineNumber, location.column);
    }

    return originalLogFunction.apply(originalConsoleObject, args);
  };
}

console.log = wrapConsole("log");
console.warn = wrapConsole("warn");
console.error = wrapConsole("error");
console.info = wrapConsole("info");

global.__COZEA_NATIVE_PREVIEW_enabled = true;

global.__COZEA_NATIVE_PREVIEW_register_navigation_plugin = function (name, plugin) {
  require("__COZEA_NATIVE_PREVIEW_lib__/wrapper.js").registerNavigationPlugin(name, plugin);
};

global.__COZEA_NATIVE_PREVIEW_register_dev_plugin = function (name) {
  require("__COZEA_NATIVE_PREVIEW_lib__/wrapper.js").registerDevtoolPlugin(name);
};

AppRegistry.setWrapperComponentProvider(() => {
  return require("__COZEA_NATIVE_PREVIEW_lib__/wrapper.js").AppWrapper;
});

const originalSetWrapperComponentProvider = AppRegistry.setWrapperComponentProvider;
AppRegistry.setWrapperComponentProvider = (provider) => {
  console.info("COZEA Native Preview: app is using a custom wrapper component provider");
  originalSetWrapperComponentProvider((appParameters) => {
    const CustomWrapper = provider(appParameters);
    return require("__COZEA_NATIVE_PREVIEW_lib__/wrapper.js").createNestedAppWrapper(CustomWrapper);
  });
};

require("./plugins/redux-devtools");
