# SunSaltyBoard

A cross-platform clipboard manager for **macOS**, **Windows** and **Linux**, built with Tauri v2 + React. Holds 10,000+ entries of clipboard history with FTS5 full-text search, undo manager, file detection, and tray-first UX.

Latest release: **v3.0.0**

## Highlights

- **Cross-platform** — macOS (x64 + arm64 DMG), Windows (NSIS installer), Linux (AppImage)
- **High-capacity history** — up to 10,000+ items, configurable
- **FTS5 full-text search** — backed by SQLite with a Rust write-queue backend
- **Real-time monitoring** — clipboard polling every 500 ms
- **Rich content** — text, rich text, images, and file references (auto-detected)
- **Undo manager** — recover overwritten or mistakenly deleted entries
- **Settings overlay** — ⚙ button in the overlay header opens the settings panel
- **TTL-cap sensitive captures** — auto-expire sensitive clipboard entries
- **System tray** — global hotkey **Alt+Shift+V** to summon the overlay
- **Organization** — categories, favorites, privacy controls (delete, clear, exclusion rules)
- **Virtualized UI** — react-window rendering for fluid scrolling over thousands of rows
- **Dark theme** — single cohesive theme across tray, overlay, and settings
- **Auto-update** — GitHub Releases via Tauri built-in updater

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

# Unit tests (vitest)
npm test

# Build for current platform
npm run build

# Build for a specific platform
npm run build:mac
npm run build:win
npm run build:linux
```

## Architecture

```
Tauri Rust backend
  ├── system tray & global hotkeys (Alt+Shift+V)
  ├── clipboard polling loop (500 ms)
  ├── undo manager
  └── SQLite database (Rust via rusqlite)
       ├── write queue (batch flush)
       ├── FTS5 full-text search index
       ├── undo log
       └── settings persistence
```

The frontend never touches the SQLite file directly — all reads and writes go through the Tauri Rust backend that batches writes to keep the UI thread responsive.

## Packaging

Targets are configured in `tauri.conf.json` and `Cargo.toml`:

| Platform | Target              | Architectures |
| -------- | ------------------- | ------------- |
| macOS    | DMG                 | x64, arm64    |
| Windows  | NSIS installer      | x64           |
| Linux    | AppImage            | x64           |

Release artifacts are published to GitHub Releases and auto-updated via Tauri updater.
