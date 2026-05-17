const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Force singleton packages (react, react-native) to always resolve from
// the app's own node_modules, preventing duplicate copies when the root
// node_modules also has them hoisted.
config.resolver.extraNodeModules = new Proxy(
  {},
  {
    get: (target, name) =>
      path.join(projectRoot, 'node_modules', String(name)),
  }
);

module.exports = config;
