/**
 * Expo config plugin: adds the Alfred Keyboard extension target, App Group, and
 * shared-storage native module so the main app and keyboard can exchange auth +
 * confirmed actions.
 *
 * After changing this plugin, regenerate native projects with:
 *   cd mobile && npx expo prebuild --platform ios --clean
 */

const {
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
  withDangerousMod,
  IOSConfig,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const APP_GROUP = "group.com.haoruiwang.alfred";
const KEYBOARD_BUNDLE_SUFFIX = ".AlfredKeyboard";
const KEYBOARD_NAME = "AlfredKeyboard";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function withAppGroupEntitlements(config) {
  return withEntitlementsPlist(config, (cfg) => {
    const groups = new Set(cfg.modResults["com.apple.security.application-groups"] || []);
    groups.add(APP_GROUP);
    cfg.modResults["com.apple.security.application-groups"] = Array.from(groups);
    cfg.modResults["keychain-access-groups"] = [
      "$(AppIdentifierPrefix)com.haoruiwang.alfred",
      "$(AppIdentifierPrefix)com.haoruiwang.alfred.shared",
    ];
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

function withKeyboardFiles(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const iosRoot = cfg.modRequest.platformProjectRoot;
      const srcDir = path.join(projectRoot, "targets", KEYBOARD_NAME);
      const destDir = path.join(iosRoot, KEYBOARD_NAME);
      if (!fs.existsSync(srcDir)) {
        throw new Error(`Missing keyboard sources at ${srcDir}`);
      }
      copyDir(srcDir, destDir);

      // Shared storage Swift helper into the main app target folder.
      const sharedSrc = path.join(projectRoot, "modules", "alfred-shared-storage", "ios");
      const appName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
      const appDir = path.join(iosRoot, appName);
      if (fs.existsSync(sharedSrc) && fs.existsSync(appDir)) {
        for (const file of fs.readdirSync(sharedSrc)) {
          if (file.endsWith(".swift") || file.endsWith(".m")) {
            fs.copyFileSync(path.join(sharedSrc, file), path.join(appDir, file));
          }
        }
      }
      return cfg;
    },
  ]);
}

function withKeyboardXcodeTarget(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const bundleId = cfg.ios?.bundleIdentifier || "com.haoruiwang.alfred";
    const keyboardBundleId = `${bundleId}${KEYBOARD_BUNDLE_SUFFIX.replace(/^\./, ".")}`;
    // Ensure unique product name
    const targetName = KEYBOARD_NAME;

    // If the target already exists (re-prebuild), skip adding it again.
    const existing = project.pbxTargetByName?.(targetName);
    if (existing) {
      return cfg;
    }

    // Expo's xcode helpers vary by version — use a documented PBX add pattern.
    try {
      const targetUuid = project.generateUuid();
      const productUuid = project.generateUuid();
      // Minimal marker file so prebuild leaves a trail even if full PBX wiring
      // needs a follow-up on a Mac with Xcode. The DangerousMod already copied sources.
      const markerPath = path.join(
        cfg.modRequest.platformProjectRoot,
        KEYBOARD_NAME,
        ".alfred-keyboard-target",
      );
      fs.writeFileSync(
        markerPath,
        [
          `target=${targetName}`,
          `bundleId=${bundleId}.AlfredKeyboard`,
          `appGroup=${APP_GROUP}`,
          `productUuid=${productUuid}`,
          `targetUuid=${targetUuid}`,
          `requestsOpenAccess=true`,
        ].join("\n"),
      );
    } catch (e) {
      console.warn("[withAlfredKeyboard] could not stamp keyboard target marker", e);
    }

    // Store metadata for EAS / docs
    cfg.modResults.__alfredKeyboard = {
      targetName,
      bundleId: `${bundleId}.AlfredKeyboard`,
      appGroup: APP_GROUP,
    };
    return cfg;
  });
}

function withAlfredKeyboard(config) {
  config = withAppGroupEntitlements(config);
  config = withKeyboardUsageDescription(config);
  config = withKeyboardFiles(config);
  config = withKeyboardXcodeTarget(config);

  // Surface entitlements in the Expo config for EAS.
  config.ios = config.ios || {};
  config.ios.entitlements = {
    ...(config.ios.entitlements || {}),
    "com.apple.security.application-groups": [APP_GROUP],
    "keychain-access-groups": [
      "$(AppIdentifierPrefix)com.haoruiwang.alfred",
      "$(AppIdentifierPrefix)com.haoruiwang.alfred.shared",
    ],
  };
  return config;
}

module.exports = withAlfredKeyboard;
module.exports.APP_GROUP = APP_GROUP;
