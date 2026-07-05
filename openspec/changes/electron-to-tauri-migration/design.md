## Context

SunSaltyBoard 当前为 Electron v43 应用，架构分三层：主进程（Node.js）、工作线程（better-sqlite3）、渲染进程（React + Vite）。IPC 通过 contextBridge 暴露 `window.electronAPI`。目标迁移至 Tauri v2，用 Rust 后端替代主进程和 worker 线程，保留 React 前端层。

关键约束：
- 功能完全等价，无用户可见的功能回退
- 支持 macOS / Windows / Linux 三平台
- 保留 FTS5 全文搜索性能
- 自动更新机制必须继续工作

## Goals / Non-Goals

**Goals:**
- 用 Tauri v2 完全替换 Electron，移除所有 Electron 依赖和代码
- Rust 后端实现所有原生能力（SQLite、剪贴板、托盘、快捷键、窗口管理、粘贴模拟、更新）
- 前端 React 零重构，仅替换 IPC 调用层（`window.electronAPI.*` → `import { invoke, listen } from '@tauri-apps/api/core'`）
- 打包体积从 ~150MB 降至 ~15MB
- CI/CD 迁移至 `tauri build` + cargo

**Non-Goals:**
- 不引入新的前端框架或状态管理库
- 不改变 UI 布局或交互逻辑
- 不改动现有的 i18n 系统
- 不重构测试架构（vitest 仍可用于纯逻辑测试）

## Decisions

### 1. Tauri v2 版本选择
- **选择**: Tauri v2（稳定版）
- **理由**: Tauri v2 提供更成熟的插件生态（clipboard-manager、global-shortcut、updater、sql、single-instance、tray），v1 已进入维护模式
- **备选**: Tauri v1 → 插件缺失，需大量手写 Rust 绑定

### 2. SQLite 方案: `tauri-plugin-sql` vs 手写 Rust
- **选择**: 手写 Rust SQLite 层（基于 `rusqlite` + `tauri::State`），不使用 `tauri-plugin-sql`
- **理由**: 
  - 当前应用有复杂的数据层（写队列批量刷新、FTS5 全文搜索、定期过期清理、事务性批量操作），`tauri-plugin-sql` 的 JS API 无法满足
  - `rusqlite` 提供同步 API，在 Tauri 命令中天然线程安全
  - 保留完整的 FTS5 控制能力
  - 性能优于 JS→plugin bridge 的序列化开销
- **备选**: `tauri-plugin-sql` → API 受限，批量写和 FTS5 支持不足

### 3. 剪贴板监控: 轮询 vs 事件驱动
- **选择**: Rust 端轮询（`arboard` crate + tokio interval），500ms 间隔
- **理由**: Electron 原版就是轮询，500ms 间隔在用户感知上无延迟；事件驱动方案（`tauri-plugin-clipboard-manager`）在 Linux Wayland 下不可靠
- **备选**: `tauri-plugin-clipboard-manager` 监听事件 → 跨平台一致性差，Windows 下可能漏事件

### 4. 模拟粘贴: Rust 侧 vs JS 侧
- **选择**: Rust 侧通过 `std::process::Command` 执行平台命令
- **理由**: Rust 代码更健壮，可以编译时处理平台条件编译（`#[cfg(target_os = "macos")]`）；JS 侧执行 shell 命令有安全风险
- **备选**: JS 侧通过 Tauri shell plugin 执行 → 额外的 plugin 依赖，无优势

### 5. 状态管理: Rust 全局状态 vs 前端管理
- **选择**: Rust 端用 `tauri::State` + `Mutex`/`RwLock` 管理全局状态（数据库连接、Undo 栈、敏感项、排除规则、设置缓存）
- **理由**: 所有原生操作已在 Rust 端，减少 JS ↔ Rust 通信；使用同步原语保证线程安全

### 6. 前端 IPC 模式
- **选择**: `invoke` + `listen` 替换 `window.electronAPI.*`
- **理由**: Tauri 原生支持，类型安全；可用 `@tauri-apps/api` 的 `invoke<T>` 泛型获得类型推断
- **注意**: 移除 `preload.ts` 和 `contextBridge`，不再需要 `window.electronAPI` 全局声明

### 7. 项目构建配置
- **选择**: Vite 保留用作前端构建，Tauri CLI 接管整体构建编排
- **理由**: 当前使用 Vite + React 无冲突；Tauri 自动集成 Vite 配置
- **变更**: 移除 `vite-plugin-electron` 和 `vite-plugin-electron-renderer`，`dev` 命令改为 `tauri dev`，`build` 命令改为 `tauri build`

### 8. 自动更新
- **选择**: `tauri-plugin-updater` 配合 GitHub Releases
- **理由**: Tauri 官方维护的更新方案，支持静态/动态发布端点，配置简单
- **变更**: `electron-builder.yml` 中的 publish 配置移至 `tauri.conf.json` 的 `updater` 段

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| `better-sqlite3`→`rusqlite` 迁移可能引入现有数据的兼容性问题 | 保持同一 SQLite 数据库文件格式，表结构完全一致；在 Rust 端打开已有 db 文件即可 |
| 剪贴板内容指纹算法不同导致去重失效 | 在 Rust 端实现完全一致的 hash 算法（sha256 of content） |
| Linux Wayland 下全局快捷键可能受限 | 提供降级方案：通过 tray 菜单手动呼出；文档标注 Wayland 兼容性 |
| Tauri 插件生态尚在发展中，部分 plugin 可能不稳定 | 锁定 plugin 版本号；关键能力（clipboard、tray）手写 Rust 实现绕过 plugin |
| FTS5 查询迁移 | `rusqlite` 完全支持 FTS5 查询语法，SQL 语句可直接移植 |

## Migration Plan

1. 创建 `src-tauri/` 骨架（`tauri init`），配置 `tauri.conf.json`（窗口、bundle、updater）
2. 实现 Rust 数据层（`tauri-sqlite-storage`）：表结构、CRUD、FTS5、写队列、过期清理
3. 实现 Rust 剪贴板监控（`tauri-clipboard-monitor`）：轮询、去重、排除规则、敏感项检测
4. 实现 Rust 后端命令（`tauri-rust-backend`）：所有 Tauri command handlers
5. 实现系统托盘（`tauri-tray-integration`）：图标、菜单
6. 实现全局快捷键（`tauri-global-shortcut`）
7. 实现窗口管理（`tauri-window-management`）：无边框、置顶、光标定位、失焦隐藏
8. 实现粘贴模拟（`tauri-paste-simulation`）
9. 实现自动更新（`tauri-auto-updater`）
10. 实现单实例锁（`tauri-single-instance`）
11. 修改前端 IPC 层：替换 `window.electronAPI.*` 为 `invoke`/`listen`
12. 更新 CI/CD（GitHub Actions）
13. 移除 Electron 残留文件和依赖
14. 端到端测试验证所有功能

## Open Questions

- `tauri-plugin-updater` 在 macOS 上是否需要额外的 code signing 配置？需要确认 Apple 开发者账号和 notarization 流程
- Linux 下 `xdotool` 是否默认安装？是否需要提示用户安装？
- 是否需要保留 electron/ 目录作为回退选项？建议删除但 git 保留历史
