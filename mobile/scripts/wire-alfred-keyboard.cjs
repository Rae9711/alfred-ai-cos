/**
 * Thin CLI wrapper around scripts/keyboard-wiring.cjs for the LOCAL prebuild
 * path. The Expo config plugin (plugins/withAlfredKeyboard.js) already runs the
 * exact same wiring during `expo prebuild` (including EAS cloud builds), so this
 * script is idempotent — it is only needed if you want to (re)wire an already
 * generated ios/ project by hand.
 *
 * Usage:
 *   cd mobile && npx expo prebuild --platform ios
 *   node scripts/wire-alfred-keyboard.cjs
 */

const fs = require("fs");
const path = require("path");
const xcode = require("xcode");

const {
  KEYBOARD,
  copyKeyboardSources,
  wireKeyboardProject,
} = require("./keyboard-wiring.cjs");

function findPbxproj(iosRoot) {
  const proj = fs.readdirSync(iosRoot).find((e) => e.endsWith(".xcodeproj"));
  if (!proj) throw new Error(`No .xcodeproj under ${iosRoot}`);
  return path.join(iosRoot, proj, "project.pbxproj");
}

function getAppName(iosRoot, pbxPath) {
  // Best-effort: app target folder is the .xcodeproj basename.
  const projName = path
    .basename(path.dirname(pbxPath))
    .replace(/\.xcodeproj$/, "");
  return fs.existsSync(path.join(iosRoot, projName)) ? projName : null;
}

function main() {
  const mobileRoot = path.resolve(__dirname, "..");
  const iosRoot = path.join(mobileRoot, "ios");
  if (!fs.existsSync(iosRoot)) {
    throw new Error(`Missing ${iosRoot} — run: npx expo prebuild --platform ios`);
  }

  const pbxPath = findPbxproj(iosRoot);
  const appName = getAppName(iosRoot, pbxPath);

  copyKeyboardSources({ projectRoot: mobileRoot, iosRoot, appName });

  const project = xcode.project(pbxPath);
  project.parseSync();

  const result = wireKeyboardProject(project, {
    iosRoot,
    bundleId: "com.haoruiwang.alfred.AlfredKeyboard",
  });

  fs.writeFileSync(pbxPath, project.writeSync());

  console.log(`[wire] ${KEYBOARD} target ${result.created ? "created" : "found"}`);
  console.log(`[wire] embedded app extension: ${result.embedded}`);
  console.log(`[wire] wrote ${pbxPath}`);
}

main();
