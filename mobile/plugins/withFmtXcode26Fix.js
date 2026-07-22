/**
 * Expo config plugin: force the CocoaPods `fmt` target to C++17.
 *
 * Xcode 26.4+ (Apple Clang 21) rejects fmt 11.x FMT_STRING consteval paths
 * that React Native 0.81 still vendors. Compiling only `fmt` as C++17 skips
 * consteval and unblocks local / EAS iOS archives without downgrading RN.
 *
 * Safe to keep after RN bumps fmt — the override is a no-op once consteval works.
 */

const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "# [withFmtXcode26Fix]";

const PATCH = `
    ${MARKER} Xcode 26+: fmt 11.x consteval breaks Apple Clang — build fmt as C++17
    installer.pods_project.targets.each do |target|
      next unless target.name == 'fmt'
      target.build_configurations.each do |bc|
        bc.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
      end
    end
`;

function withFmtXcode26Fix(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      if (!fs.existsSync(podfilePath)) return cfg;

      let contents = fs.readFileSync(podfilePath, "utf8");
      if (contents.includes(MARKER)) return cfg;

      // Insert immediately after react_native_post_install(...) block closes,
      // which is the last statement inside post_install before `end`.
      const needle = /(:ccache_enabled\s*=>\s*ccache_enabled\?\(podfile_properties\),\s*\n\s*\))/;
      if (needle.test(contents)) {
        contents = contents.replace(needle, `$1\n${PATCH}`);
      } else {
        // Fallback: before the final `end` of post_install (last end before target end).
        const idx = contents.lastIndexOf("  post_install do |installer|");
        if (idx < 0) {
          console.warn("[withFmtXcode26Fix] post_install not found; skipping");
          return cfg;
        }
        const endIdx = contents.indexOf("\n  end\n", idx);
        if (endIdx < 0) {
          console.warn("[withFmtXcode26Fix] post_install end not found; skipping");
          return cfg;
        }
        contents =
          contents.slice(0, endIdx) + "\n" + PATCH + contents.slice(endIdx);
      }

      fs.writeFileSync(podfilePath, contents);
      return cfg;
    },
  ]);
}

module.exports = withFmtXcode26Fix;
