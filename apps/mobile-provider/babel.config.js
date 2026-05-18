const { expoRouterBabelPlugin } = require('babel-preset-expo/build/expo-router-plugin');

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [expoRouterBabelPlugin],
    overrides: [
      {
        include: ['./src/**', './app/**'],
        plugins: [
          ['module-resolver', {
            root: ['.'],
            alias: { '@': './src' },
            extensions: ['.ios.js', '.android.js', '.js', '.ts', '.tsx', '.json'],
          }],
        ],
      },
    ],
  };
};
