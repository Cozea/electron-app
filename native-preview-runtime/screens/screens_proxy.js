// NOTE: babel_transformer injects an import of this function into the `react-native-screens` library
// and calls it with the InnerScreen component defined in `components/Screen.tsx`.
function proxyInnerScreenRender() {
  if (!InnerScreen) {
    console.log("__COZEA_NATIVE_PREVIEW_INTERNAL", "InnerScreen is not defined, skipping screens proxy");
    return;
  }

  // NOTE: we expect the InnerScreen to be a `React.forwardRef` component, which internally
  // stores its render function in the `render` property.
  // This has been the case for at least 2 years at this point:
  // https://github.com/facebook/react/commit/bc70441c8b3fa85338283af3eeb47b5d15e9dbfe#diff-311cc788120033519c2d51b9e0fd90086cbe0e4efeaf8bcb1e1ca3405614bf6bR25
  // https://github.com/software-mansion/react-native-screens/commit/6274fb72bce2b6dce8cab300a9b8bed298159da4#diff-b7373bc65141848ff27f4140814a307072ad6f78581293bdc10b805fc3033714R44
  // and before that, it was a class component which also defined the `render` property.
  // If in the future this changes, we will need to update this code appropriately.
  const origRender = InnerScreen.render;

  if (!origRender) {
    console.log("__COZEA_NATIVE_PREVIEW_INTERNAL", "InnerScreen.render is not defined, skipping screens proxy");
    return;
  }

  InnerScreen.render = function (...args) {
    const origProps = args[0];
    const props = Object.assign({}, origProps);
    if (!props.active && !props.activityState) {
      props.pointerEvents = "none";
    }
    return origRender.apply(this, [props, ...args.slice(1)]);
  };
}

try {
  proxyInnerScreenRender();
} catch (e) {
  console.log("__COZEA_NATIVE_PREVIEW_INTERNAL", "Failed to proxy InnerScreen render function", e);
}
