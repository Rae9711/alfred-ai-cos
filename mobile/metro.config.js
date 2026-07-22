// Metro config for the bun-workspace monorepo. Albert's mobile app lives in
// mobile/ but depends on the @albert/shared-types workspace package and on
// dependencies that bun hoists to the repo-root node_modules (and nests under
// node_modules/.bun/). Watch the repo root and resolve both node_modules trees so
// expo-router and the shared-types package resolve from inside mobile/.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// Append the workspace root to Expo's default watchFolders (don't replace them, or
// Metro can miss folders Expo expects to watch — flagged by expo-doctor).
config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
// bun does not always create symlinks the way npm/yarn do; let Metro follow the
// real paths under node_modules/.bun.
config.resolver.disableHierarchicalLookup = false;

// Pin a single React / RN instance for the whole bundle.
// Hierarchical lookup otherwise resolves `@tanstack/react-query` (hoisted under
// repo-root node_modules) to a *different physical copy* of react than app code
// under mobile/node_modules — Metro then ships both, and hooks blow up with
// "Cannot read property 'useEffect' of null".
const PINNED = new Set(["react", "react-dom", "react-native", "scheduler"]);
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const pinned =
    PINNED.has(moduleName) ||
    moduleName.startsWith("react/") ||
    moduleName.startsWith("react-dom/") ||
    moduleName.startsWith("react-native/");
  if (pinned) {
    return {
      type: "sourceFile",
      filePath: require.resolve(moduleName, { paths: [projectRoot] }),
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
