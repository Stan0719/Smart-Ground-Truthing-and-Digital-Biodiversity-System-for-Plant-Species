const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Shared policies live outside this app; this repository has no workspace root
// package.json, so Expo cannot discover that folder automatically.
config.watchFolders = [
  ...config.watchFolders,
  path.resolve(__dirname, '../shared'),
];

module.exports = config;
