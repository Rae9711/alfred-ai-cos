/**
 * Single source of truth for wiring the AlfredKeyboard custom-keyboard app
 * extension into the generated iOS project.
 *
 * This module is consumed in two places:
 *   - plugins/withAlfredKeyboard.js  (runs automatically during `expo prebuild`,
 *     which is what EAS cloud builds execute — no manual Xcode steps required)
 *   - scripts/wire-alfred-keyboard.cjs (thin CLI wrapper for the local path)
 *
 * The functions here operate on a parsed `xcode` project object (the same object
 * that `withXcodeProject` hands the plugin via `config.modResults`) plus plain
 * filesystem paths, so both entry points share identical behavior.
 */

const fs = require("fs");
const path = require("path");

const KEYBOARD = "AlfredKeyboard";
const APP_GROUP = "group.com.haoruiwang.alfred";
const KEYCHAIN_ACCESS_GROUPS = [
  "$(AppIdentifierPrefix)com.haoruiwang.alfred",
  "$(AppIdentifierPrefix)com.haoruiwang.alfred.shared",
];
const DEFAULT_DEPLOYMENT_TARGET = "15.1";
const DEFAULT_SWIFT_VERSION = "5.0";

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

function stripQuotes(v) {
  return String(v == null ? "" : v).replace(/"/g, "");
}

function keyboardEntitlementsXml() {
  const keychain = KEYCHAIN_ACCESS_GROUPS.map(
    (g) => `\t\t<string>${g}</string>`,
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.security.application-groups</key>
\t<array>
\t\t<string>${APP_GROUP}</string>
\t</array>
\t<key>keychain-access-groups</key>
\t<array>
${keychain}
\t</array>
</dict>
</plist>
`;
}

/**
 * Copy Swift sources, Info.plist, and entitlements for the keyboard extension
 * from the committed `targets/AlfredKeyboard/` tree into the generated
 * `ios/AlfredKeyboard/` folder, and copy the shared-storage helper into the app
 * target folder. Safe to run repeatedly.
 *
 * @returns {{ destDir: string, infoPlistRel: string, entitlementsRel: string }}
 */
function copyKeyboardSources({ projectRoot, iosRoot, appName }) {
  const srcDir = path.join(projectRoot, "targets", KEYBOARD);
  if (!fs.existsSync(srcDir)) {
    throw new Error(`Missing keyboard sources at ${srcDir}`);
  }
  const destDir = path.join(iosRoot, KEYBOARD);
  copyDir(srcDir, destDir);

  // Xcode / INFOPLIST_FILE convention expects <Target>-Info.plist.
  const infoSrc = path.join(destDir, "Info.plist");
  const infoDest = path.join(destDir, `${KEYBOARD}-Info.plist`);
  if (fs.existsSync(infoSrc)) {
    fs.copyFileSync(infoSrc, infoDest);
  }

  // Authoritative entitlements for the keyboard target: App Group + keychain
  // access group so the extension can share the session + confirmed actions.
  fs.writeFileSync(
    path.join(destDir, `${KEYBOARD}.entitlements`),
    keyboardEntitlementsXml(),
  );

  // AlfredSharedStorage is linked via its podspec + expo autolinking — do NOT
  // copy the Swift sources into the app target (that never added them to
  // Compile Sources and would duplicate symbols once the pod is linked).

  return {
    destDir,
    infoPlistRel: `${KEYBOARD}/${KEYBOARD}-Info.plist`,
    entitlementsRel: `${KEYBOARD}/${KEYBOARD}.entitlements`,
  };
}

function pbxGroupByName(project, name) {
  const groups = project.hash.project.objects.PBXGroup;
  for (const key of Object.keys(groups)) {
    const g = groups[key];
    if (typeof g !== "object") continue;
    const n = stripQuotes(g.name || g.path || "");
    if (n === name) return key;
  }
  return null;
}

function ensureKeyboardGroup(project, mainGroupId) {
  let groupKey = pbxGroupByName(project, KEYBOARD);
  if (groupKey) return groupKey;

  groupKey = project.generateUuid();
  project.hash.project.objects.PBXGroup[groupKey] = {
    isa: "PBXGroup",
    children: [],
    name: `"${KEYBOARD}"`,
    path: `"${KEYBOARD}"`,
    sourceTree: '"<group>"',
  };
  project.hash.project.objects.PBXGroup[`${groupKey}_comment`] = KEYBOARD;

  const main = project.hash.project.objects.PBXGroup[mainGroupId];
  main.children = main.children || [];
  main.children.push({ value: groupKey, comment: KEYBOARD });
  return groupKey;
}

function ensureSourcesBuildPhase(project, target) {
  const phases = project.hash.project.objects.PBXSourcesBuildPhase || {};
  const existing = (target.buildPhases || [])
    .map((p) => p.value)
    .filter((id) => phases[id] && phases[id].isa === "PBXSourcesBuildPhase");
  if (existing.length) return existing[0];

  const uuid = project.generateUuid();
  if (!project.hash.project.objects.PBXSourcesBuildPhase) {
    project.hash.project.objects.PBXSourcesBuildPhase = {};
  }
  project.hash.project.objects.PBXSourcesBuildPhase[uuid] = {
    isa: "PBXSourcesBuildPhase",
    buildActionMask: 2147483647,
    files: [],
    runOnlyForDeploymentPostprocessing: 0,
  };
  project.hash.project.objects.PBXSourcesBuildPhase[`${uuid}_comment`] =
    "Sources";
  if (!target.buildPhases) target.buildPhases = [];
  target.buildPhases.push({ value: uuid, comment: "Sources" });
  return uuid;
}

function ensureFrameworksBuildPhase(project, target) {
  const phases = project.hash.project.objects.PBXFrameworksBuildPhase || {};
  const existing = (target.buildPhases || [])
    .map((p) => p.value)
    .filter((id) => phases[id] && phases[id].isa === "PBXFrameworksBuildPhase");
  if (existing.length) return existing[0];

  const uuid = project.generateUuid();
  if (!project.hash.project.objects.PBXFrameworksBuildPhase) {
    project.hash.project.objects.PBXFrameworksBuildPhase = {};
  }
  project.hash.project.objects.PBXFrameworksBuildPhase[uuid] = {
    isa: "PBXFrameworksBuildPhase",
    buildActionMask: 2147483647,
    files: [],
    runOnlyForDeploymentPostprocessing: 0,
  };
  project.hash.project.objects.PBXFrameworksBuildPhase[`${uuid}_comment`] =
    "Frameworks";
  if (!target.buildPhases) target.buildPhases = [];
  target.buildPhases.push({ value: uuid, comment: "Frameworks" });
  return uuid;
}

function ensureFileInGroup(project, groupKey, fileName, lastKnownFileType) {
  const group = project.hash.project.objects.PBXGroup[groupKey];
  group.children = group.children || [];
  const existing = group.children.find((c) => {
    const ref = project.hash.project.objects.PBXFileReference[c.value];
    return ref && stripQuotes(ref.path) === fileName;
  });
  if (existing) return existing.value;

  const fileRef = project.generateUuid();
  if (!project.hash.project.objects.PBXFileReference) {
    project.hash.project.objects.PBXFileReference = {};
  }
  project.hash.project.objects.PBXFileReference[fileRef] = {
    isa: "PBXFileReference",
    lastKnownFileType,
    name: `"${fileName}"`,
    path: `"${fileName}"`,
    sourceTree: '"<group>"',
    fileEncoding: 4,
  };
  project.hash.project.objects.PBXFileReference[`${fileRef}_comment`] = fileName;
  group.children.push({ value: fileRef, comment: fileName });
  return fileRef;
}

function addSwiftToTarget(project, target, groupKey, fileName) {
  const fileRef = ensureFileInGroup(
    project,
    groupKey,
    fileName,
    "sourcecode.swift",
  );

  const sourcesPhaseId = ensureSourcesBuildPhase(project, target);
  const buildFileId = project.generateUuid();
  if (!project.hash.project.objects.PBXBuildFile) {
    project.hash.project.objects.PBXBuildFile = {};
  }
  project.hash.project.objects.PBXBuildFile[buildFileId] = {
    isa: "PBXBuildFile",
    fileRef,
    fileRef_comment: fileName,
  };
  project.hash.project.objects.PBXBuildFile[`${buildFileId}_comment`] =
    `${fileName} in Sources`;

  const phase = project.hash.project.objects.PBXSourcesBuildPhase[sourcesPhaseId];
  phase.files = phase.files || [];
  const alreadyBuilt = phase.files.some((f) => {
    const bf = project.hash.project.objects.PBXBuildFile[f.value];
    if (!bf) return false;
    const fr = project.hash.project.objects.PBXFileReference[bf.fileRef];
    return fr && stripQuotes(fr.path) === fileName;
  });
  if (!alreadyBuilt) {
    phase.files.push({ value: buildFileId, comment: `${fileName} in Sources` });
  }
}

function ensureResourcesBuildPhase(project, target) {
  const phases = project.hash.project.objects.PBXResourcesBuildPhase || {};
  const existing = (target.buildPhases || [])
    .map((p) => p.value)
    .filter((id) => phases[id] && phases[id].isa === "PBXResourcesBuildPhase");
  if (existing.length) return existing[0];

  const uuid = project.generateUuid();
  if (!project.hash.project.objects.PBXResourcesBuildPhase) {
    project.hash.project.objects.PBXResourcesBuildPhase = {};
  }
  project.hash.project.objects.PBXResourcesBuildPhase[uuid] = {
    isa: "PBXResourcesBuildPhase",
    buildActionMask: 2147483647,
    files: [],
    runOnlyForDeploymentPostprocessing: 0,
  };
  project.hash.project.objects.PBXResourcesBuildPhase[`${uuid}_comment`] =
    "Resources";
  if (!target.buildPhases) target.buildPhases = [];
  target.buildPhases.push({ value: uuid, comment: "Resources" });
  return uuid;
}

function addPngToTarget(project, target, groupKey, fileName) {
  const fileRef = ensureFileInGroup(project, groupKey, fileName, "image.png");
  const resourcesPhaseId = ensureResourcesBuildPhase(project, target);
  const phase =
    project.hash.project.objects.PBXResourcesBuildPhase[resourcesPhaseId];
  phase.files = phase.files || [];
  const alreadyBuilt = phase.files.some((f) => {
    const bf = project.hash.project.objects.PBXBuildFile[f.value];
    if (!bf) return false;
    const fr = project.hash.project.objects.PBXFileReference[bf.fileRef];
    return fr && stripQuotes(fr.path) === fileName;
  });
  if (alreadyBuilt) return;

  const buildFileId = project.generateUuid();
  if (!project.hash.project.objects.PBXBuildFile) {
    project.hash.project.objects.PBXBuildFile = {};
  }
  project.hash.project.objects.PBXBuildFile[buildFileId] = {
    isa: "PBXBuildFile",
    fileRef,
    fileRef_comment: fileName,
  };
  project.hash.project.objects.PBXBuildFile[`${buildFileId}_comment`] =
    `${fileName} in Resources`;
  phase.files.push({
    value: buildFileId,
    comment: `${fileName} in Resources`,
  });
}

function getAppDeploymentTarget(project, appTarget) {
  const configLists = project.hash.project.objects.XCConfigurationList || {};
  const configs = project.pbxXCBuildConfigurationSection();
  const listId = appTarget && appTarget.buildConfigurationList;
  const list = listId && configLists[listId];
  if (list && Array.isArray(list.buildConfigurations)) {
    for (const entry of list.buildConfigurations) {
      const cfg = configs[entry.value];
      const dt = cfg && cfg.buildSettings && cfg.buildSettings.IPHONEOS_DEPLOYMENT_TARGET;
      if (dt) return stripQuotes(dt);
    }
  }
  return DEFAULT_DEPLOYMENT_TARGET;
}

/**
 * Rename the auto-generated "Copy Files" (PlugIns/13) phase on the app target to
 * "Embed App Extensions" and mark the embedded .appex as Code Sign On Copy.
 */
function configureEmbedAppExtensions(project, appUuid, productReference) {
  const copyPhases = project.hash.project.objects.PBXCopyFilesBuildPhase || {};
  const buildFiles = project.hash.project.objects.PBXBuildFile || {};
  const appTarget = project.pbxNativeTargetSection()[appUuid];
  if (!appTarget) return false;

  for (const ref of appTarget.buildPhases || []) {
    const phase = copyPhases[ref.value];
    if (!phase || phase.isa !== "PBXCopyFilesBuildPhase") continue;
    if (String(phase.dstSubfolderSpec) !== "13") continue;

    let contains = false;
    for (const fEntry of phase.files || []) {
      const bf = buildFiles[fEntry.value];
      if (bf && bf.fileRef === productReference) {
        bf.settings = { ATTRIBUTES: ["CodeSignOnCopy", "RemoveHeadersOnCopy"] };
        const comment = `${KEYBOARD}.appex in Embed App Extensions`;
        buildFiles[`${fEntry.value}_comment`] = comment;
        fEntry.comment = comment;
        contains = true;
      }
    }

    if (contains) {
      phase.name = '"Embed App Extensions"';
      copyPhases[`${ref.value}_comment`] = "Embed App Extensions";
      ref.comment = "Embed App Extensions";
      return true;
    }
  }
  return false;
}

function appDependsOn(project, appTarget, keyboardUuid) {
  const deps = project.hash.project.objects.PBXTargetDependency || {};
  for (const entry of appTarget.dependencies || []) {
    const dep = deps[entry.value];
    if (dep && dep.target === keyboardUuid) return true;
  }
  return false;
}

/**
 * Deterministically wire the AlfredKeyboard app-extension target into `project`.
 * Does NOT persist — the caller is responsible for writing the pbxproj (the
 * config plugin's withXcodeProject serializes automatically; the CLI wrapper
 * calls writeSync).
 *
 * @returns {{ created: boolean, keyboardUuid: string, embedded: boolean }}
 */
function wireKeyboardProject(project, { iosRoot, bundleId }) {
  const keyboardBundleId = bundleId || "com.haoruiwang.alfred.AlfredKeyboard";
  const keyboardDir = path.join(iosRoot, KEYBOARD);
  const infoPlistRel = `${KEYBOARD}/${KEYBOARD}-Info.plist`;
  const entitlementsRel = `${KEYBOARD}/${KEYBOARD}.entitlements`;

  const app = project.getFirstTarget();
  const appUuid = app.uuid;
  const appTarget = app.firstTarget;
  const deploymentTarget = getAppDeploymentTarget(project, appTarget);

  let created = false;
  let nativeTarget =
    project.pbxTargetByName(KEYBOARD) || project.pbxTargetByName(`"${KEYBOARD}"`);
  if (!nativeTarget) {
    project.addTarget(KEYBOARD, "app_extension", KEYBOARD, keyboardBundleId);
    nativeTarget =
      project.pbxTargetByName(KEYBOARD) ||
      project.pbxTargetByName(`"${KEYBOARD}"`);
    created = true;
  }
  if (!nativeTarget) throw new Error("Could not create/find AlfredKeyboard target");

  const keyboardUuid = project.findTargetKey(nativeTarget.name);
  nativeTarget.name = KEYBOARD;
  nativeTarget.productName = KEYBOARD;
  const productReference = nativeTarget.productReference;

  ensureFrameworksBuildPhase(project, nativeTarget);

  const mainGroupId = project.getFirstProject().firstProject.mainGroup;
  const groupKey = ensureKeyboardGroup(project, mainGroupId);

  const swiftFiles = fs
    .readdirSync(keyboardDir)
    .filter((f) => f.endsWith(".swift"))
    .sort();
  for (const file of swiftFiles) {
    addSwiftToTarget(project, nativeTarget, groupKey, file);
  }

  const pngFiles = fs
    .readdirSync(keyboardDir)
    .filter((f) => f.endsWith(".png"))
    .sort();
  for (const file of pngFiles) {
    addPngToTarget(project, nativeTarget, groupKey, file);
  }

  // Build settings for the keyboard target's configurations only.
  const configs = project.pbxXCBuildConfigurationSection();
  for (const key of Object.keys(configs)) {
    const cfg = configs[key];
    if (typeof cfg !== "object" || !cfg.buildSettings) continue;
    const bs = cfg.buildSettings;
    const name = stripQuotes(bs.PRODUCT_NAME);
    const bundle = stripQuotes(bs.PRODUCT_BUNDLE_IDENTIFIER);
    if (name !== KEYBOARD && !bundle.endsWith(".AlfredKeyboard")) continue;

    bs.INFOPLIST_FILE = `"${infoPlistRel}"`;
    bs.CODE_SIGN_ENTITLEMENTS = `"${entitlementsRel}"`;
    bs.PRODUCT_BUNDLE_IDENTIFIER = `"${keyboardBundleId}"`;
    bs.PRODUCT_NAME = `"${KEYBOARD}"`;
    bs.INFOPLIST_KEY_CFBundleDisplayName = '"Alfred"';
    bs.GENERATE_INFOPLIST_FILE = "NO";
    bs.LD_RUNPATH_SEARCH_PATHS =
      '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"';
    bs.SKIP_INSTALL = "YES";
    bs.TARGETED_DEVICE_FAMILY = '"1"';
    bs.IPHONEOS_DEPLOYMENT_TARGET = deploymentTarget;
    bs.CLANG_ENABLE_MODULES = "YES";
    bs.SWIFT_VERSION = bs.SWIFT_VERSION || DEFAULT_SWIFT_VERSION;
    bs.SWIFT_EMIT_LOC_STRINGS = "YES";
    bs.CURRENT_PROJECT_VERSION = bs.CURRENT_PROJECT_VERSION || "1";
    bs.MARKETING_VERSION = bs.MARKETING_VERSION || "1.0";
  }

  // Embed into the app + build ordering.
  const embedded = configureEmbedAppExtensions(project, appUuid, productReference);
  if (keyboardUuid && !appDependsOn(project, appTarget, keyboardUuid)) {
    // xcode@3's addTargetDependency silently no-ops unless these sections
    // already exist — a fresh Expo app (no extensions) has neither, so create
    // them before adding the dependency.
    if (!project.hash.project.objects.PBXTargetDependency) {
      project.hash.project.objects.PBXTargetDependency = {};
    }
    if (!project.hash.project.objects.PBXContainerItemProxy) {
      project.hash.project.objects.PBXContainerItemProxy = {};
    }
    project.addTargetDependency(appUuid, [keyboardUuid]);
  }

  // Stamp a marker for humans / debugging.
  try {
    fs.writeFileSync(
      path.join(keyboardDir, ".alfred-keyboard-target"),
      [
        `target=${KEYBOARD}`,
        `bundleId=${keyboardBundleId}`,
        `appGroup=${APP_GROUP}`,
        `infoPlist=${infoPlistRel}`,
        `entitlements=${entitlementsRel}`,
        `deploymentTarget=${deploymentTarget}`,
        `sources=${swiftFiles.join(",")}`,
        `resources=${pngFiles.join(",")}`,
        `embeddedAppExtension=${embedded}`,
        `wired=true`,
      ].join("\n") + "\n",
    );
  } catch {
    /* non-fatal */
  }

  return { created, keyboardUuid, embedded };
}

module.exports = {
  KEYBOARD,
  APP_GROUP,
  KEYCHAIN_ACCESS_GROUPS,
  copyKeyboardSources,
  wireKeyboardProject,
  keyboardEntitlementsXml,
};
