const { adaptMetroConfig, requireFromAppDependency } = require("./metro_helpers");

// Below is the main code of the config overrider.
const { loadConfig } = requireFromAppDependency("react-native", "metro-config");

module.exports = async function () {
  const customMetroConfigPath = process.env.COZEA_NATIVE_PREVIEW_METRO_CONFIG_PATH;
  let options = {};
  if (customMetroConfigPath) {
    options = { config: customMetroConfigPath };
  }
  const config = await loadConfig(options, {});
  return adaptMetroConfig(config);
};
