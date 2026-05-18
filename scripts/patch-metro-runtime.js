/**
 * Patches @expo/metro-runtime@4.0.1 messageSocket.native.ts
 *
 * Bug: uses require() for modules that export via ESM `export default`.
 * In RN 0.81+, getDevServer.js and WebSocket.js use `export default`,
 * so require() returns { default: fn } (an Object), not the value directly.
 * - getDevServer(): "TypeError: getDevServer is not a function (it is Object)"
 * - new WebSocket():  "TypeError: constructor is not callable"
 *
 * Fix: unwrap .default if present (handles both CJS and ESM-compiled exports).
 */

const fs = require('fs');
const path = require('path');

const workspaces = ['apps/mobile-client', 'apps/mobile-provider'];
const root = path.join(__dirname, '..');

const PATCHES = [
  {
    from: "  const getDevServer = require('react-native/Libraries/Core/Devtools/getDevServer');",
    to: [
      "  const _getDevServerMod = require('react-native/Libraries/Core/Devtools/getDevServer');",
      "  const getDevServer = _getDevServerMod.default ?? _getDevServerMod;",
    ].join('\n'),
    sentinel: '_getDevServerMod',
  },
  {
    from: "  const WebSocket = require('react-native/Libraries/WebSocket/WebSocket');",
    to: [
      "  const _WebSocketMod = require('react-native/Libraries/WebSocket/WebSocket');",
      "  const WebSocket = _WebSocketMod.default ?? _WebSocketMod;",
    ].join('\n'),
    sentinel: '_WebSocketMod',
  },
];

for (const workspace of workspaces) {
  const filePath = path.join(root, workspace, 'node_modules/@expo/metro-runtime/src/messageSocket.native.ts');
  if (!fs.existsSync(filePath)) continue;

  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  for (const patch of PATCHES) {
    if (content.includes(patch.sentinel)) {
      continue; // already applied
    }
    if (!content.includes(patch.from)) {
      console.log(`[patch] Pattern not found (different version?): ${patch.sentinel} in ${filePath}`);
      continue;
    }
    content = content.replace(patch.from, patch.to);
    changed = true;
    console.log(`[patch] Applied fix for ${patch.sentinel}: ${filePath}`);
  }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
  } else {
    console.log(`[patch] Already patched: ${filePath}`);
  }
}
