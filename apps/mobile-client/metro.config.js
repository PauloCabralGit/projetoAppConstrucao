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

// Force these modules to always resolve from this app's node_modules
// to prevent duplicate instances and version mismatches in the monorepo.
const FORCED_MODULES = [
  'react',
  'react-native',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'expo-linking',
  'expo-constants',
  'expo-modules-core',
];

const _resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    FORCED_MODULES.includes(moduleName) ||
    moduleName.startsWith('react-native/')
  ) {
    return (
      _resolveRequest
        ? _resolveRequest(
            { ...context, originModulePath: path.join(projectRoot, 'package.json') },
            moduleName,
            platform,
          )
        : context.resolveRequest(
            { ...context, originModulePath: path.join(projectRoot, 'package.json') },
            moduleName,
            platform,
          )
    );
  }
  return _resolveRequest
    ? _resolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
