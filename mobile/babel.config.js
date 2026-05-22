// Babel config for the Expo app. babel-preset-expo includes the expo-router
// transform that replaces process.env.EXPO_ROUTER_APP_ROOT at build time. In this
// bun-workspace monorepo, expo-router is hoisted under node_modules/.bun, which
// defeats the preset's automatic app-root detection. Set the app root explicitly so
// the transform always resolves it (the app/ dir holds the routes).
const path = require("path");

process.env.EXPO_ROUTER_APP_ROOT =
  process.env.EXPO_ROUTER_APP_ROOT || path.resolve(__dirname, "app");

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
  };
};
