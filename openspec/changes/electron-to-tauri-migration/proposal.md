## Why

SunSaltyBoard 当前基于 Electron 43 构建，打包体积 ~150MB+，启动慢、内存占用高。Tauri v2 使用 OS 原生 WebView，体积可缩减至 10-15MB，启动更快、内存更低，且 Rust 后端提供更好的性能和安全性。迁移到 Tauri 可显著改善用户体验、降低维护成本，并为未来功能扩展打下坚实基础。

## What Changes

- **BREAKING** 移除 Electron 全部依赖和代码（main process、preload、worker thread、electron-builder 配置）
- 引入 Tauri v2 作为新运行时框架，使用 Rust 后端重写所有原生能力
- 前端 React 代码保留，将 `window.electronAPI.*` IPC 调用替换为 Tauri `invoke` / event 系统
- SQLite 存储从 `better-sqlite3` 工作线程迁移到 Tauri 后端的 Rust SQLite 实现
- 系统托盘、全局快捷键、窗口管理、剪贴板监控全部改用 Tauri 插件或 Rust 实现
- 自动更新从 `electron-updater` 切换到 `tauri-plugin-updater`
- CI/CD 从 electron-builder 切换到 `tauri build` + cargo
- 打包脚本（after-pack.js）移除

## Capabilities

### New Capabilities
- `tauri-rust-backend`: Rust 后端核心，包括所有 Tauri 命令、SQLite 数据层、剪贴板轮询、去重、排除规则过滤
- `tauri-tray-integration`: 系统托盘图标和上下文菜单（打开历史、设置、关于、退出）
- `tauri-global-shortcut`: 全局快捷键注册与反注册（默认 Alt+Shift+V）
- `tauri-window-management`: 无边框窗口、置顶、跟随光标定位、失焦隐藏
- `tauri-clipboard-monitor`: 剪贴板轮询 + 多类型内容捕获（文本/富文本/图片/文件引用）
- `tauri-paste-simulation`: 跨平台模拟粘贴（macOS osascript / Windows PowerShell / Linux xdotool）
- `tauri-auto-updater`: 基于 GitHub Releases 的自动更新
- `tauri-single-instance`: 单实例锁
- `tauri-sqlite-storage`: SQLite 存储层（FTS5 全文搜索、写队列批量刷新、定期过期清理）

### Modified Capabilities
无。项目首次使用 OpenSpec，尚无已有 specs。

## Impact

- **移除**: `electron/` 目录全部文件、`electron-builder.yml`、`scripts/after-pack.js`、`vite-plugin-electron` 相关配置
- **新增**: `src-tauri/` 目录（Cargo.toml、tauri.conf.json、Rust 源码）、Tauri GitHub Actions CI
- **修改**: 前端 `src/` 下所有 React 组件的 IPC 调用
- **依赖变更**: 移除 electron / electron-builder / electron-updater / better-sqlite3 / vite-plugin-electron；新增 `@tauri-apps/api`、`@tauri-apps/cli`、`tauri-plugin-*` 系列
- **构建流程**: npm run dev → `tauri dev`；npm run build → `tauri build`
