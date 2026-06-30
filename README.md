# SunSaltyBoard

A cross-platform clipboard manager for Windows and Linux with high-capacity history (up to 10,000+ items), full-text search, categories, favorites, and optional LAN sync.

## Features

- Real-time clipboard monitoring with 500ms polling
- Support for text, rich text, images, and file references
- SQLite-backed persistent storage with FTS5 full-text search
- Configurable capacity (default 10,000 items)
- System tray integration with global hotkey (Alt+Shift+V)
- Categories and favorites for organizing items
- Privacy controls: delete items, clear history, exclusion rules
- Optional LAN sync via mDNS + WebSocket with TLS
- Dark theme UI with virtualized scrolling

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Lint
npm run lint

# Type check
npm run typecheck

# Build for current platform
npm run build

# Build for specific platform
npm run build:win
npm run build:linux
```

## Architecture

```
main process (Electron)
  ├── system tray & global hotkeys
  ├── clipboard polling (500ms)
  └── IPC bridge
       ├── preload (context bridge)
       │    └── renderer (React UI)
       └── worker thread (SQLite)
            ├── write queue (batch flush)
            ├── FTS5 full-text search
            └── settings persistence
```

## Packaging

Windows MSI installer and Linux AppImage are built with electron-builder. Release artifacts are published to GitHub Releases with auto-update support.
