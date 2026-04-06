const { requireFromAppDir } = require("../metro_helpers");

function generateStorybookInternals() {
  try {
    requireFromAppDir("./node_modules/@storybook/csf");
    return `module.exports = {
    toId: require("__APPDIR__/node_modules/@storybook/csf").toId,
    storyNameFromExport: require("__APPDIR__/node_modules/@storybook/csf").storyNameFromExport
    };`
  } catch (_) {
    // this is expected to fail when "./node_modules/@storybook/csf" does not exist
  }

  try {
    requireFromAppDir("./node_modules/storybook/dist/csf");
    return `module.exports = {
    toId: require("__APPDIR__/node_modules/storybook/dist/csf").toId,
    storyNameFromExport: require("__APPDIR__/node_modules/storybook/dist/csf").storyNameFromExport
    };`
  } catch (_) {
    // this is expected to fail when "./node_modules/storybook/dist/csf") does not exist
  }
  return `module.exports = {};`
}

module.exports = {
  generateStorybookInternals
};



