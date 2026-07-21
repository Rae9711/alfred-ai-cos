/**
 * Expo config plugin: fully wires the Alfred custom-keyboard app extension during
 * `expo prebuild` — including on EAS cloud builds, which run a managed prebuild
 * and never execute local npm scripts. No manual Xcode steps are required.
 *
 * During prebuild this plugin:
 *   - stamps the App Group + keychain access group on the MAIN app entitlements,
 *   - copies the keyboard Swift sources / Info.plist / entitlements into ios/,
 *   - creates a real `AlfredKeyboard` app-extension PBX target (product type
 *     com.apple.product-type.app-extension) with bundle id
 *     `com.haoruiwang.alfred.AlfredKeyboard`,
 *   - adds an "Embed App Extensions" (PlugIns/13) copy-files phase to the app
 *     target with Code Sign On Copy, plus a target dependency,
 *   - attaches the keyboard's Info.plist + entitlements (App Group + keychain)
 *     via CODE_SIGN_ENTITLEMENTS / INFOPLIST_FILE.
 *
 * The heavy xcodeproj logic lives in scripts/keyboard-wiring.cjs so the local
 * CLI path (scripts/wire-alfred-keyboard.cjs) and this plugin stay in sync.
 *
 * After changing this plugin, regenerate native projects with:
 *   cd mobile && npx expo prebuild --platform ios --clean
 */

const {
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
  IOSConfig,
} = require("@expo/config-plugins");

const {
  APP_GROUP,
  KEYCHAIN_ACCESS_GROUPS,
  copyKeyboardSources,
  wireKeyboardProject,
} = require("../scripts/keyboard-wiring.cjs");

function withAppGroupEntitlements(config) {
  return withEntitlementsPlist(config, (cfg) => {
    const groups = new Set(
      cfg.modResults["com.apple.security.application-groups"] || [],
    );
    groups.add(APP_GROUP);
    cfg.modResults["com.apple.security.application-groups"] = Array.from(groups);
    cfg.modResults["keychain-access-groups"] = [...KEYCHAIN_ACCESS_GROUPS];
    return cfg;
  });
}

function withKeyboardUsageDescription(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.NSFaceIDUsageDescription =
      cfg.modResults.NSFaceIDUsageDescription ||
      "Alfred uses Face ID only when you enable it for confirmations.";
    return cfg;
  });
}

/**
 * Copy sources + wire the xcodeproj in a single xcode mod so ordering is
 * deterministic (files exist before we reference them) and withXcodeProject
 * serializes the pbxproj for us.
 */
function withKeyboardTarget(config) {
  return withXcodeProject(config, (cfg) => {
    const projectRoot = cfg.modRequest.projectRoot;
    const iosRoot = cfg.modRequest.platformProjectRoot;
    const appName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
    const bundleId = cfg.ios?.bundleIdentifier || "com.haoruiwang.alfred";

    copyKeyboardSources({ projectRoot, iosRoot, appName });

    const result = wireKeyboardProject(cfg.modResults, {
      iosRoot,
      bundleId: `${bundleId}.AlfredKeyboard`,
    });

    if (!result.embedded) {
      console.warn(
        "[withAlfredKeyboard] Could not confirm the Embed App Extensions phase — inspect the generated pbxproj.",
      );
    }

    cfg.modResults.__alfredKeyboard = {
      targetName: "AlfredKeyboard",
      bundleId: `${bundleId}.AlfredKeyboard`,
      appGroup: APP_GROUP,
      embedded: result.embedded,
      wired: true,
    };
    return cfg;
  });
}

function withAlfredKeyboard(config) {
  config = withAppGroupEntitlements(config);
  config = withKeyboardUsageDescription(config);
  config = withKeyboardTarget(config);

  // Surface entitlements in the Expo config for EAS credential management.
  config.ios = config.ios || {};
  config.ios.entitlements = {
    ...(config.ios.entitlements || {}),
    "com.apple.security.application-groups": [APP_GROUP],
    "keychain-access-groups": [...KEYCHAIN_ACCESS_GROUPS],
  };
  return config;
}

module.exports = withAlfredKeyboard;
module.exports.APP_GROUP = APP_GROUP;
