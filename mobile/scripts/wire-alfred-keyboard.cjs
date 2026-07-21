/**
 * Finish wiring the AlfredKeyboard app-extension target after `expo prebuild`.
 *
 * Usage:
 *   cd mobile && npx expo prebuild --platform ios
 *   node scripts/wire-alfred-keyboard.cjs
 */

const fs = require("fs");
const path = require("path");
const xcode = require("xcode");

const KEYBOARD = "AlfredKeyboard";
const APP_GROUP = "group.com.haoruiwang.alfred";
const BUNDLE_ID = "com.haoruiwang.alfred.AlfredKeyboard";

function findPbxproj(iosRoot) {
  const proj = fs.readdirSync(iosRoot).find((e) => e.endsWith(".xcodeproj"));
  if (!proj) throw new Error(`No .xcodeproj under ${iosRoot}`);
  return path.join(iosRoot, proj, "project.pbxproj");
}

function ensureInfoPlist(keyboardDir) {
  const src = path.join(keyboardDir, "Info.plist");
  const dest = path.join(keyboardDir, `${KEYBOARD}-Info.plist`);
  if (!fs.existsSync(src)) throw new Error(`Missing ${src}`);
  fs.copyFileSync(src, dest);
  return `${KEYBOARD}/${KEYBOARD}-Info.plist`;
}

function pbxGroupByName(project, name) {
  const groups = project.hash.project.objects.PBXGroup;
  for (const key of Object.keys(groups)) {
    const g = groups[key];
    if (typeof g !== "object") continue;
    const n = (g.name || g.path || "").replace(/"/g, "");
    if (n === name) return key;
  }
  return null;
}

function ensureSourcesBuildPhase(project, target) {
  const phases = project.hash.project.objects.PBXSourcesBuildPhase || {};
  // Reuse existing phase referenced by target if present.
  const existingPhaseIds = (target.buildPhases || [])
    .map((p) => p.value)
    .filter((id) => phases[id] && phases[id].isa === "PBXSourcesBuildPhase");
  if (existingPhaseIds.length) return existingPhaseIds[0];

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
  project.hash.project.objects.PBXSourcesBuildPhase[`${uuid}_comment`] = "Sources";
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
  project.hash.project.objects.PBXFrameworksBuildPhase[`${uuid}_comment`] = "Frameworks";
  if (!target.buildPhases) target.buildPhases = [];
  target.buildPhases.push({ value: uuid, comment: "Frameworks" });
  return uuid;
}

function addSwiftToTarget(project, target, groupKey, relPath, fileName) {
  // File reference
  const fileRef = project.generateUuid();
  if (!project.hash.project.objects.PBXFileReference) {
    project.hash.project.objects.PBXFileReference = {};
  }
  project.hash.project.objects.PBXFileReference[fileRef] = {
    isa: "PBXFileReference",
    lastKnownFileType: "sourcecode.swift",
    name: `"${fileName}"`,
    path: `"${fileName}"`,
    sourceTree: '"<group>"',
    fileEncoding: 4,
  };
  project.hash.project.objects.PBXFileReference[`${fileRef}_comment`] = fileName;

  // Add to group children if missing
  const group = project.hash.project.objects.PBXGroup[groupKey];
  group.children = group.children || [];
  const alreadyInGroup = group.children.some((c) => {
    const ref = project.hash.project.objects.PBXFileReference[c.value];
    return ref && String(ref.path || "").replace(/"/g, "") === fileName;
  });
  if (!alreadyInGroup) {
    group.children.push({ value: fileRef, comment: fileName });
  }

  // Build file + sources phase
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
  project.hash.project.objects.PBXBuildFile[`${buildFileId}_comment`] = `${fileName} in Sources`;

  const phase = project.hash.project.objects.PBXSourcesBuildPhase[sourcesPhaseId];
  phase.files = phase.files || [];
  const alreadyBuilt = phase.files.some((f) => {
    const bf = project.hash.project.objects.PBXBuildFile[f.value];
    if (!bf) return false;
    const fr = project.hash.project.objects.PBXFileReference[bf.fileRef];
    return fr && String(fr.path || "").replace(/"/g, "") === fileName;
  });
  if (!alreadyBuilt) {
    phase.files.push({ value: buildFileId, comment: `${fileName} in Sources` });
  }

  return { fileRef, relPath };
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

function main() {
  const mobileRoot = path.resolve(__dirname, "..");
  const iosRoot = path.join(mobileRoot, "ios");
  const keyboardDir = path.join(iosRoot, KEYBOARD);
  if (!fs.existsSync(keyboardDir)) {
    throw new Error(`Missing ${keyboardDir} — run: npx expo prebuild --platform ios`);
  }

  const infoPlistRel = ensureInfoPlist(keyboardDir);
  const entitlementsRel = `${KEYBOARD}/${KEYBOARD}.entitlements`;
  const pbxPath = findPbxproj(iosRoot);
  const project = xcode.project(pbxPath);
  project.parseSync();

  let target =
    project.pbxTargetByName(KEYBOARD) || project.pbxTargetByName(`"${KEYBOARD}"`);
  if (!target) {
    project.addTarget(KEYBOARD, "app_extension", KEYBOARD, BUNDLE_ID);
    target =
      project.pbxTargetByName(KEYBOARD) || project.pbxTargetByName(`"${KEYBOARD}"`);
  }
  if (!target) throw new Error("Could not create/find AlfredKeyboard target");

  // Normalize target name (strip quotes in nativeTarget entry)
  target.name = KEYBOARD;
  target.productName = KEYBOARD;

  ensureFrameworksBuildPhase(project, target);

  const mainGroupId = project.getFirstProject().firstProject.mainGroup;
  const groupKey = ensureKeyboardGroup(project, mainGroupId);

  const swiftFiles = fs.readdirSync(keyboardDir).filter((f) => f.endsWith(".swift"));
  for (const file of swiftFiles) {
    addSwiftToTarget(project, target, groupKey, `${KEYBOARD}/${file}`, file);
    console.log(`[wire] source ${file}`);
  }

  // Build settings
  const configs = project.pbxXCBuildConfigurationSection();
  for (const key of Object.keys(configs)) {
    const cfg = configs[key];
    if (typeof cfg !== "object" || !cfg.buildSettings) continue;
    const bs = cfg.buildSettings;
    const name = String(bs.PRODUCT_NAME || "").replace(/"/g, "");
    const bundle = String(bs.PRODUCT_BUNDLE_IDENTIFIER || "").replace(/"/g, "");
    if (name !== KEYBOARD && !bundle.endsWith(".AlfredKeyboard")) continue;
    bs.INFOPLIST_FILE = `"${infoPlistRel}"`;
    bs.CODE_SIGN_ENTITLEMENTS = `"${entitlementsRel}"`;
    bs.PRODUCT_BUNDLE_IDENTIFIER = `"${BUNDLE_ID}"`;
    bs.LD_RUNPATH_SEARCH_PATHS =
      '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"';
    bs.SKIP_INSTALL = "YES";
    bs.TARGETED_DEVICE_FAMILY = '"1"';
    bs.IPHONEOS_DEPLOYMENT_TARGET = bs.IPHONEOS_DEPLOYMENT_TARGET || "15.1";
    bs.CLANG_ENABLE_MODULES = "YES";
    bs.SWIFT_VERSION = bs.SWIFT_VERSION || "5.0";
    console.log(`[wire] buildSettings ${cfg.name || key}`);
  }

  fs.writeFileSync(pbxPath, project.writeSync());

  fs.writeFileSync(
    path.join(keyboardDir, ".alfred-keyboard-target"),
    [
      `target=${KEYBOARD}`,
      `bundleId=${BUNDLE_ID}`,
      `appGroup=${APP_GROUP}`,
      `infoPlist=${infoPlistRel}`,
      `entitlements=${entitlementsRel}`,
      `sources=${swiftFiles.join(",")}`,
      `wired=true`,
      `note=Sources + entitlements attached by scripts/wire-alfred-keyboard.cjs — verify Embed App Extensions in Xcode before archive`,
    ].join("\n") + "\n",
  );

  console.log(`[wire] wrote ${pbxPath}`);
  console.log("[wire] next: Xcode → Embed App Extensions, then eas build / archive");
}

main();
