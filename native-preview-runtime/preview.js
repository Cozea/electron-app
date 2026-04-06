const { useEffect, useState } = require("react");
const { AppRegistry, View } = require("react-native");
const RNInternals = require("./rn-internals/rn-internals");

export const PREVIEW_APP_KEY = "COZEA_NATIVE_PREVIEW_preview";

global.__COZEA_NATIVE_PREVIEW_previews ||= new Map();

export function Preview({ __cozea_native_previewKey }) {
  "use no memo";

  const previewData = global.__COZEA_NATIVE_PREVIEW_previews.get(__cozea_native_previewKey);
  if (!previewData || !previewData.component) {
    return null;
  }

  const [_, setDummyState] = useState(0);
  useEffect(() => {
    previewData.renderTrigger = () => {
      setDummyState((state) => state + 1);
    };

    return () => {
      previewData.renderTrigger = null;
    };
  }, [previewData]);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      {previewData.component}
    </View>
  );
}

function getComponentName({ type }) {
  const name = type.name;
  if (name !== undefined) {
    return name;
  }

  const isForwardedRef = type["$$typeof"] === Symbol.for("react.forward_ref");
  if (isForwardedRef) {
    return "(forwarded ref)";
  }

  return "(unnamed)";
}

async function getCallSourceFromStack(stack) {
  const parsedStack = RNInternals.parseErrorStack(stack);
  const callerFrame = parsedStack[1];
  const symbolicatedCallerFrame = (await RNInternals.symbolicateStackTrace([callerFrame])).stack[0];

  return {
    fileName: symbolicatedCallerFrame.file,
    lineNumber: symbolicatedCallerFrame.lineNumber,
    columnNumber: symbolicatedCallerFrame.column,
  };
}

export function preview(component) {
  if (!component) {
    return;
  }

  getCallSourceFromStack(new Error().stack).then((callSource) => {
    const key = `preview:/${callSource.fileName}:${callSource.lineNumber}`;
    const lastPreview = global.__COZEA_NATIVE_PREVIEW_previews.get(key);

    global.__COZEA_NATIVE_PREVIEW_previews.set(key, {
      component,
      name: getComponentName(component),
    });

    if (lastPreview && lastPreview.renderTrigger) {
      setTimeout(lastPreview.renderTrigger, 0);
    }
  });
}

AppRegistry.registerComponent(PREVIEW_APP_KEY, () => Preview);
