/**
 * Detox Configuration
 * Framework para testes E2E em React Native
 *
 * Configuração para rodar 8 testes de ratings
 */

module.exports = {
  // Testando em 2 configurações: iOS e Android
  configurations: {
    // iOS Simulator
    ios: {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 15', // ou iPhone 14 Pro, iPhone 14, etc.
      },
      app: 'ios',
    },

    // Android Emulator
    android: {
      type: 'android.emu',
      device: {
        avdName: 'Pixel_5_API_30', // Emulador Android com API 30+
      },
      app: 'android',
    },
  },

  // Build configuration
  apps: {
    // iOS app build
    ios: {
      type: 'ios.app',
      binaryPath:
        'ios/build/Build/Products/Release-iphonesimulator/ConstruConnect.app',
      build: 'xcodebuild -workspace ios/ConstruConnect.xcworkspace -scheme ConstruConnect -configuration Release -sdk iphonesimulator -derivedDataPath ios/build -quiet',
    },

    // Android app build
    android: {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/release/app-release.apk',
      build: 'cd android && ./gradlew assembleRelease assembleAndroidTest',
    },
  },

  // Detox configuration
  testRunner: 'jest',

  // Apps to use
  apps: {
    ios: {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Release-iphonesimulator/ConstruConnect.app',
      build: 'xcodebuild -workspace ios/ConstruConnect.xcworkspace -scheme ConstruConnect -configuration Release -sdk iphonesimulator -derivedDataPath ios/build'
    },
    android: {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/release/app-release.apk',
      build: 'cd android && ./gradlew assembleRelease'
    }
  },

  // Detox behavior
  testRunner: 'jest',
  runnerConfig: {
    testTimeout: 120000, // 2 minutos para cada teste
    reportSpecs: true,
    recordLogs: 'failing', // Registrar logs apenas de testes falhados
    recordPerformance: 'all', // Registrar performance de todos
    longLivedSessionId: false,
  },

  // Output configuration
  artifacts: {
    rootDir: './artifacts',
    plugins: {
      log: 'all', // Registrar todos os logs
      screenshot: 'failing', // Screenshot apenas de falhas
      video: 'failing', // Vídeo apenas de falhas
      uiHierarchy: 'failing', // UI hierarchy apenas de falhas
    },
  },
};
