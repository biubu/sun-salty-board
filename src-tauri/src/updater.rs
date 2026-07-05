// Update handling is managed by tauri-plugin-updater.
// The plugin automatically checks for updates on startup
// and emits events to the frontend for progress and status.
//
// Events emitted by the plugin:
// - check-finished (no update available)
// - update-available
// - download-progress
// - update-installed
//
// These are listened to on the frontend via:
//   import { listen } from '@tauri-apps/api/event';
//   listen('tauri://update-available', handler);
