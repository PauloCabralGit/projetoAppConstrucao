const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Mescla com os defaults do Expo (não sobrescreve) e adiciona a raiz do monorepo.
config.watchFolders = [...new Set([...(config.watchFolders ?? []), monorepoRoot])];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Force React (and react-native) to always resolve from this app's node_modules,
// preventing duplicate instances when packages like expo-router bundle their own copy.
const FORCED_MODULES = ['react', 'react-native', 'react/jsx-runtime', 'react/jsx-dev-runtime'];
const _resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (FORCED_MODULES.includes(moduleName) || moduleName.startsWith('react-native/')) {
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
