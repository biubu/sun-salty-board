## 1. Tauri 项目初始化与配置

- [x] 1.1 安装 Tauri CLI 和相关依赖（`@tauri-apps/cli`、`@tauri-apps/api`、tauri-plugin-* 系列）
- [x] 1.2 创建 `src-tauri/` 骨架目录（`tauri init`），配置 Cargo.toml 和 tauri.conf.json
- [x] 1.3 配置 tauri.conf.json：窗口设置（frameless、alwaysOnTop、skipTaskbar）、bundle 配置、identifier
- [x] 1.4 配置 updater 段指向 GitHub Releases
- [x] 1.5 移除 vite.config.ts 中的 vite-plugin-electron 和 vite-plugin-electron-renderer
- [x] 1.6 更新 package.json scripts：dev → `tauri dev`，build → `tauri build`

## 2. Rust 数据层实现（tauri-sqlite-storage）

- [x] 2.1 在 Cargo.toml 中添加 `rusqlite` 依赖（启用 `bundled` 和 `fts5` feature）
- [x] 2.2 实现数据库初始化模块：打开/创建 SQLite 数据库，执行建表 SQL（items、categories、item_categories、settings、FTS5 虚拟表 + 触发器）
- [x] 2.3 实现 Item CRUD 操作：insert、get_by_id、get_recent（分页）、delete、clear_all
- [x] 2.4 实现 Category CRUD：create、rename、delete、list 以及 item-category 关联管理
- [x] 2.5 实现 FTS5 全文搜索（带查询清理、前缀匹配、CJK 支持）
- [x] 2.6 实现写队列：批量插入缓存 + 50 条或 2 秒空闲后事务性刷入
- [x] 2.7 实现定时过期清理：每小时扫描并删除过期条
- [x] 2.8 实现设置持久化：load_all / save / get / set
- [x] 2.9 实现 FTS4→FTS5 迁移逻辑（检测旧表、迁移数据、重建触发器）
- [x] 2.10 实现 Undo 管理器（内存栈，8 条目上限，每个条目 5 秒 TTL）
- [x] 2.11 实现敏感项存储器（内存 Map，5 分钟 TTL，1000 条目上限）

## 3. 剪贴板监控实现（tauri-clipboard-monitor）

- [x] 3.1 添加 `arboard` crate 依赖到 Cargo.toml
- [x] 3.2 实现剪贴板轮询器：tokio interval 500ms，检查文本/富文本/图片/文件引用格式
- [x] 3.3 实现内容指纹生成（SHA-256 of plain text / image bytes）
- [x] 3.4 实现去重逻辑（100ms 窗口内相同指纹跳过）
- [x] 3.5 实现排除规则过滤（按应用名和内容正则）
- [x] 3.6 实现敏感项检测（Ctrl 键按下时捕获 → 标记 sensitive = true）
- [x] 3.7 将新捕获项通过 Tauri event 推送到前端

## 4. Rust 后端命令注册（tauri-rust-backend）

- [x] 4.1 将 Database、UndoManager、SensitiveItems 注册为 tauri::State
- [x] 4.2 实现 `#[tauri::command]` 函数：get_items、search_items、delete_item、clear_history、get_item_by_id
- [x] 4.3 实现命令：toggle_favorite、get_favorites
- [x] 4.4 实现命令：category CRUD（create_category、rename_category、delete_category、list_categories、assign_category、remove_category）
- [x] 4.5 实现命令：paste_item、undo_delete
- [x] 4.6 实现命令：get_settings、update_setting
- [x] 4.7 实现命令：get_stats（总条目数、今日新增等统计）
- [x] 4.8 实现命令：show_window、hide_window、toggle_window
- [x] 4.9 实现命令：get_version、get_platform
- [x] 4.10 在 main.rs 的 `run()` 中注册所有命令和 setup hook

## 5. 系统托盘实现（tauri-tray-integration）

- [x] 5.1 在 Cargo.toml 中添加 tauri-plugin-tray 依赖（或使用 tauri::tray 内建 API）
- [x] 5.2 创建托盘图标资源（macOS Template PNG / Windows ICO / Linux PNG）
- [x] 5.3 实现托盘上下文菜单：Open History、Settings、About、Quit
- [x] 5.4 在 setup hook 中创建托盘并注册菜单事件

## 6. 全局快捷键实现（tauri-global-shortcut）

- [x] 6.1 在 Cargo.toml 中添加 tauri-plugin-global-shortcut 依赖
- [x] 6.2 实现快捷键注册逻辑（默认 Alt+Shift+V）
- [ ] 6.3 实现快捷键配置更新（取消旧注册 → 注册新组合键）
- [x] 6.4 实现快捷键冲突检测与日志警告
- [x] 6.5 在 app 退出时取消所有快捷键注册

## 7. 窗口管理实现（tauri-window-management）

- [x] 7.1 在主窗口创建时配置 frameless、alwaysOnTop、skipTaskbar
- [x] 7.2 实现窗口定位：获取光标位置（平台相关 API）并计算窗口居中位置
- [x] 7.3 实现窗口显示/隐藏/切换命令（show_window、hide_window、toggle_window）
- [x] 7.4 实现失焦自动隐藏（on_window_event 监听 FocusLost）
- [x] 7.5 实现单实例窗口（show 时如果已存在则 focus，不创建新窗口）

## 8. 模拟粘贴实现（tauri-paste-simulation）

- [x] 8.1 实现 macOS 粘贴：`osascript -e 'tell application "System Events" to keystroke "v" using command down'`
- [x] 8.2 实现 Windows 粘贴：PowerShell `[System.Windows.Forms.SendKeys]::SendWait("^v")`
- [x] 8.3 实现 Linux 粘贴：`xdotool key --clearmodifiers ctrl+v`
- [x] 8.4 实现粘贴前后剪贴板内容保存与恢复

## 9. 自动更新实现（tauri-auto-updater）

- [x] 9.1 在 Cargo.toml 中添加 tauri-plugin-updater 依赖
- [x] 9.2 配置 tauri.conf.json 的 updater 端点和签名公钥
- [x] 9.3 实现启动时检查更新
- [x] 9.4 实现下载进度事件上报到前端
- [x] 9.5 实现下载完成后提示用户重启安装
- [ ] 9.6 实现更新频道切换（stable/beta）

## 10. 单实例锁实现（tauri-single-instance）

- [x] 10.1 在 Cargo.toml 中添加 tauri-plugin-single-instance 依赖
- [x] 10.2 实现单实例检测：第二个实例启动时退出并将焦点转发到第一个实例

## 11. 前端 IPC 迁移

- [x] 11.1 安装 `@tauri-apps/api` npm 包
- [x] 11.2 创建前端 IPC 适配层 `src/utils/tauriApi.ts`，封装所有 `invoke` 和 `listen` 调用
- [x] 11.3 替换 `App.tsx` 中所有 `window.electronAPI.*` 调用为新适配层
- [x] 11.4 替换 `HistoryPanel.tsx` 中 IPC 调用（getItems、searchItems、pasteItem、deleteItem、toggleFavorite 等）
- [x] 11.5 替换 `HistoryItem.tsx` 中 IPC 调用（pasteItem、deleteItem、undoDelete、toggleFavorite）
- [x] 11.6 替换 `SearchBar.tsx` 中 IPC 调用（searchItems 防抖）
- [x] 11.7 替换 `FilterChips.tsx` 中 IPC 调用（category、favorites 过滤）
- [x] 11.8 替换 `SettingsPanel.tsx` 中 IPC 调用（getSettings、updateSetting、检查更新等）
- [x] 11.9 替换事件监听：`window.electronAPI.onUpdateAvailable` → `listen('update-available', ...)` 等
- [x] 11.10 移除 `electron/preload.ts` 和 `src/types.d.ts` 中 `Window.electronAPI` 类型声明
- [x] 11.11 更新所有 React 组件的类型导入，移除 Electron 相关的类型

## 12. CI/CD 迁移

- [x] 12.1 重写 `.github/workflows/release.yml`：使用 `tauri-action` 构建跨平台二进制
- [x] 12.2 配置 macOS code signing 证书和 notarization（在 CI secrets 中配置）
- [x] 12.3 配置 Windows code signing 证书
- [x] 12.4 移除 electron-builder 的 `release.yml` 中的 publish job 和 after-pack 脚本
- [x] 12.5 添加 cargo build 和 clippy 检查步骤

## 13. 清理 Electron 残留

~~- [x] 13.1~~ 删除 `electron/` 目录全部文件
- [x] 13.2 删除 `electron-builder.yml`
- [x] 13.3 删除 `scripts/after-pack.js`
- [x] 13.4 从 package.json 移除 Electron 相关依赖（electron、electron-builder、electron-updater、better-sqlite3、vite-plugin-electron 等）
- [x] 13.5 从 vite.config.ts 移除 Electron 相关配置

## 14. 测试与验证

- [x] 14.1 更新/重写 storage.test.ts 以测试 Rust SQLite 层逻辑（通过 Tauri command 集成测试或单元测试）
- [ ] 14.2 更新/重写 data-types.test.ts 测试多类型内容处理
- [ ] 14.3 更新/重写 dedup.test.ts 测试去重逻辑
- [ ] 14.4 更新/重写 file-detection.test.ts 测试文件引用检测
- [ ] 14.5 确保前端组件在 `tauri dev` 模式下可以正常加载和交互
- [ ] 14.6 端到端验证：启动、剪贴板捕获、搜索、粘贴、设置、托盘、快捷键、更新检查
- [ ] 14.7 macOS / Windows / Linux 三平台手动测试

## 15. 文档与收尾

- [x] 15.1 更新 README.md 中的构建说明和依赖要求
- [ ] 15.2 更新 CONTRIBUTING.md（如果有）中的开发环境配置
- [x] 15.3 确认所有 npm test 和 cargo test 通过
