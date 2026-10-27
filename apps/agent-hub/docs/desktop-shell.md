# 桌面壳（Tauri v2）与单窗口布局

> 上级文档：[../README.md](../README.md)。为什么选 Tauri 而不是 Electron 见 README §4。本文讲 Rust 壳要做什么、本地郎怎么“包”进主窗口、侧车怎么管。

## 1. 职责边界

Rust 壳保持很薄，只做这些事：

1. 创建主窗口，在里面放两个子 WebView：`hub`（Hub UI）和 `bot`（本地郎对话页）；
2. 按 Hub UI 上报的位置摆放 Bot 子 WebView，处理折叠、遮挡、导航白名单、弹窗；
3. 拉起、监控、重启、关闭 Node 侧车；
4. 菜单栏图标、应用菜单与快捷键、系统通知、单实例；
5. 少量只给 `hub` 用的 IPC 命令（§5）。

**不在 Rust 里写业务逻辑**：任务、适配器、存储、API 全在 Node 侧车里，这样 CI 能测到（CI 不编译 Rust）。

## 2. 窗口与子 WebView

### 2.1 结构

- 只有一个窗口，label `main`。多 WebView 窗口不能在 `tauri.conf.json` 里声明，所以 `app.windows` 写空数组，在 `setup` 里用 `tauri::window::WindowBuilder` 创建窗口，再用 `Window::add_child` 加两个子 WebView。
- 这两个 API 需要 Cargo 特性 **`unstable`**，只在桌面端可用：

  ```toml
  [dependencies]
  tauri = { version = "2", features = ["unstable", "tray-icon"] }
  ```

  `unstable` 下的 API 可能在小版本间变化：`Cargo.lock` 锁定版本，升级 Tauri 单独提 PR 并跑一遍 §10 的手工清单；所有 `unstable` 调用都收敛在 `bot_panel.rs` 和 `window.rs` 两个文件里（见风险 R4）。

| 子 WebView | label | 加载内容                                      | IPC 权限           | 数据存储                                  |
| ---------- | ----- | --------------------------------------------- | ------------------ | ----------------------------------------- |
| Hub UI     | `hub` | 应用内资源（`frontendDist`，开发期 `devUrl`） | 只有 §5 列出的命令 | 默认存储（Hub UI 不依赖 Cookie）          |
| Bot 面板   | `bot` | `config.bot.url`（本地郎对话页，外部 URL）    | **无**             | 独立存储（`data_store_identifier`，§3.2） |

### 2.2 布局方式：Hub UI 铺满，Bot 子 WebView 盖在左栏上

- `hub` 子 WebView 铺满整个窗口（`auto_resize()`），左栏在 Hub UI 里是一个空的占位组件 `BotSlot`。
- `bot` 子 WebView 是盖在 `BotSlot` 上面的原生视图，位置和大小**由 Hub UI 决定**：`BotSlot` 用 `ResizeObserver` 监听自身尺寸，按 `requestAnimationFrame` 节流后调用 `bot_panel_set_layout`，Rust 侧调用 `Webview::set_bounds` 摆放，折叠时调用 `Webview::hide()`。
- 坐标一律用 CSS 像素（逻辑像素），Rust 侧用 `LogicalPosition` / `LogicalSize`，不自己乘缩放比。
- 窗口缩放时 Hub UI 重新布局，`ResizeObserver` 自然会再上报一次；晚一帧可以接受。

这样布局只有一个权威来源（Hub UI 的 CSS），Rust 不需要知道栏宽、顶栏高度等界面细节。

### 2.3 遮挡规则（必须遵守）

原生子 WebView 永远画在 Hub UI 上面，Hub UI 的任何浮层只要伸进 `BotSlot` 区域就会被盖住。规则：

1. 下拉菜单、Popover、Tooltip、Toast 只能出现在右侧区域；Toast 固定在右下角。
2. 全窗口的模态框（新建任务、写任务确认、设置）打开时先把 Bot 面板隐藏，关闭后恢复。做法：在 `@repo/ui-web` 的 `Dialog` 外面包一层 `HubDialog`，用 `useBotPanelOcclusion()` 在打开 / 关闭时调用 `bot_panel_set_layout({ visible })`。ESLint 规则禁止 Hub UI 直接用 `Dialog`。
3. 审批卡片放在任务详情里（右栏），不用全局弹窗。

### 2.4 宽度与折叠

- 三档宽度（窄 320 px / 中 420 px / 宽 560 px）+ 折叠，记在本地设置里。
- **第一版不做拖拽调宽**：指针移到原生子 WebView 上方后事件就到不了 Hub UI，拖拽会断。以后要做，就在拖拽开始时隐藏 Bot 面板、结束后再显示。
- 快捷键必须注册成**原生应用菜单的快捷键**：焦点在 Bot 面板里时，Hub UI 收不到键盘事件。菜单项触发后 Rust 向 `hub` 发事件（如 `menu://toggle-bot`）。

| 快捷键 | 动作                 |
| ------ | -------------------- |
| ⌘1     | 折叠 / 展开 Bot 面板 |
| ⌘N     | 新建任务             |
| ⌘⇧R    | 刷新 Bot 面板        |
| ⌘,     | 设置                 |

- 自定义应用菜单时必须保留标准“编辑”菜单（撤销、重做、剪切、复制、粘贴、全选）。macOS 上没有这些菜单项，两个 WebView 里的 ⌘C / ⌘V 都不生效。

## 3. Bot 子 WebView

### 3.1 加载什么

- 加载 `config.bot.url`，也就是本地郎自己的对话页面。Hub 不关心这个页面是谁做的、用什么技术。
- 没配置 URL 时不创建 Bot 子 WebView，`BotSlot` 显示引导：填写 URL、说明本地郎需要运行在本机（见待决问题 Q3）。
- 面板顶部的工具条是 Hub UI 画的（在 `BotSlot` 内部、子 WebView 上方的 32 px）：刷新、后退、用系统浏览器打开、清除登录数据。

### 3.2 隔离

| 措施             | 做法                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 无 IPC           | capability 只授给 webview label `hub`（§6）。按 Tauri 的规则，没有匹配任何 capability 的 WebView 完全不能访问 IPC。**不要**在 capability 里写 `windows: ["main"]`，那会把权限授给该窗口里的所有 WebView，包括 Bot 面板。 |
| 独立 Cookie 存储 | `WebviewBuilder::data_store_identifier(BOT_STORE_ID)`，`BOT_STORE_ID` 是写死的 16 字节常量，重启后登录态还在。该 API 需要 macOS 14+；macOS 13 上退回默认存储，并在设置页提示。                                           |
| 不注入脚本       | Hub 不对 Bot 子 WebView 调用 `eval`、不设 `initialization_script`。本地郎和 Hub 之间只走本地 API。                                                                                                                       |
| 导航白名单       | `on_navigation`：只允许 `bot.allowedOrigins` 与 `bot.authOrigins`（登录用的 SSO / OAuth 域名，用户在设置里维护）。其他链接取消导航，改用系统浏览器打开。                                                                 |
| 新窗口           | `on_new_window`：目标在 `bot.authOrigins` 里时允许弹出登录小窗（与 Bot 共用数据存储，否则登录态回不来）；其他一律交给系统浏览器。                                                                                        |
| 其他             | 拒绝下载、麦克风与摄像头权限请求；`bot.userAgent` 可覆盖 UA（有的站点会拦内嵌 WebView 的 UA）。                                                                                                                          |

### 3.3 与任务的关联（可选）

桥接方创建任务时可以带 `externalRef`（本地郎侧的会话 / 消息标识）和 `externalUrl`（能定位到那段对话的链接）。任务详情里显示“在 Bot 中定位”，点击后调用 `bot_panel_navigate`，URL 仍要过导航白名单。这一项不影响主流程，M5 再做。

## 4. 侧车生命周期

### 4.1 定位 Node

按顺序：

1. `config.desktop.nodePath`（用户显式指定）；
2. 登录 shell 的 PATH（§4.3）里的 `node`；
3. 常见位置：`/opt/homebrew/bin/node`、`/usr/local/bin/node`、`~/.volta/bin/node`、`~/.nvm/versions/node/*/bin/node`（取最高版本）。

要求 `node --version` ≥ 22。找不到或版本太低时显示错误页，给出修复办法，不自动安装。

### 4.2 启动与就绪

1. Rust 为本次启动生成 32 字节随机数作为 **UI token**（base64url）。
2. 启动 `node <server 入口> --home <AGENT_HUB_HOME>`：工作目录是 `AGENT_HUB_HOME`，环境变量的 `PATH` 用 §4.3 解析出的值。
3. 写入子进程 stdin 第一行：`{"uiToken":"..."}`。**之后 stdin 保持打开**：侧车监听 stdin 的 `end`，一旦 Tauri 进程意外消失（stdin 被关闭），侧车自行优雅停机，不留孤儿进程。UI token 不走环境变量（同用户的其他进程能用 `ps` 看到环境变量）。
4. 读取 stdout，等 `{"event":"ready",...}` 这一行，最多 20 秒；其他行写入 `logs/desktop.log`。
5. 就绪后向 `hub` 发 `sidecar://ready`；Hub UI 启动时显示“服务启动中”，收到事件后调用 `hub_connection` 拿 `{ baseUrl, wsUrl, uiToken }`。

### 4.3 登录 shell 的 PATH

从 Finder 或 Dock 启动的 macOS 应用只有很短的 PATH（`/usr/bin:/bin:/usr/sbin:/sbin`），找不到 nvm / Homebrew 装的 `node`、`codex`、`qodercli`。做法：

- 启动时执行一次 `$SHELL -ilc 'printf "__PATH__%s__PATH__" "$PATH"'`，超时 5 秒，从输出里截取标记之间的内容（交互式 shell 可能打印欢迎语）；
- 失败就退回常见路径拼接，并在设置页的 Agent 健康检查里提示；
- 结果传给侧车，侧车的 `ProcessSupervisor` 用它解析各 Agent 的命令；健康检查展示解析到的绝对路径与版本。

### 4.4 监控与重启

- 侧车意外退出：向 `hub` 发 `sidecar://exited`（带退出码与最后 50 行日志），按 1 s / 2 s / 5 s / 10 s / 30 s 退避重启；5 分钟内失败 5 次就停止重启，显示错误页和“重试”按钮。
- 重启后的任务恢复由侧车负责（architecture.md §7.3）。

### 4.5 退出

- 点窗口的关闭按钮：只隐藏窗口，应用留在菜单栏，任务继续，本地郎的 API 照常可用。
- 菜单“退出”或 ⌘Q：有运行中的任务时先弹原生确认框（“有 N 个任务在运行，退出会中断它们”）；确认后向侧车发 SIGTERM，等最多 10 秒，超时 SIGKILL。

### 4.6 单实例与端口

- `tauri-plugin-single-instance`：重复打开时聚焦已有窗口。
- 侧车启动时写 `server.lock`（pid、启动时间、入口路径）。端口被占用时：如果锁文件指向一个仍存活、命令行匹配本应用入口的旧侧车，先 SIGTERM 它再重试一次；否则报错“端口 47821 被其他程序占用”，引导到设置里改端口。

### 4.7 开发模式

- `pnpm dev:agent-hub`：并行启动侧车（watch 模式）、Hub UI 的 Vite（端口 5174，`strictPort`，避开 Cardhub 的 5173）和 `tauri dev`。
- 设置 `AGENT_HUB_EXTERNAL_SERVER=1` 时，Tauri 不自己拉起侧车，改为从 `<AGENT_HUB_HOME>/dev-ui-token`（权限 `0600`，只在开发模式写）读取 UI token。
- 也可以只用浏览器打开 `http://localhost:5174` 调 Hub UI：页面检测到不在 Tauri 里时，Bot 面板显示占位，首次访问要求粘贴开发 UI token（存在 `sessionStorage`）。

## 5. IPC 命令（只给 `hub`）

| 命令                      | 参数                                 | 返回 / 作用                                                                            |
| ------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| `hub_connection`          | —                                    | `{ baseUrl, wsUrl, uiToken, serverVersion }`                                           |
| `bot_panel_set_layout`    | `{ x, y, width, height, visible }`   | 摆放或隐藏 Bot 子 WebView；参数做边界裁剪，宽高小于 1 视为隐藏                         |
| `bot_panel_reload`        | —                                    | 刷新 Bot 面板                                                                          |
| `bot_panel_navigate`      | `{ url }`                            | URL 必须通过导航白名单，否则返回错误                                                   |
| `bot_panel_open_external` | —                                    | 用系统浏览器打开 Bot 当前 URL                                                          |
| `bot_panel_clear_data`    | —                                    | 二次确认后清除 Bot 数据存储里的浏览数据（`clear_all_browsing_data`），即退出本地郎登录 |
| `set_tray_status`         | `{ pendingApprovals, runningTasks }` | 更新菜单栏图标旁的数字与菜单                                                           |
| `reveal_path`             | `{ path }`                           | 在 Finder 里显示；路径必须位于已注册仓库或 `AGENT_HUB_HOME/worktrees` 之下             |
| `open_external`           | `{ url }`                            | 只允许 `http` / `https`                                                                |
| `sidecar_restart`         | —                                    | 手动重启侧车                                                                           |

Rust → `hub` 的事件：`sidecar://ready`、`sidecar://exited`、`menu://toggle-bot`、`menu://new-task`、`menu://settings`、`tray://open-approvals`。

系统通知直接用 `tauri-plugin-notification` 的 JS API（权限 `notification:default`）。

## 6. Capability 与 CSP

`src-tauri/capabilities/hub.json`：

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "hub-ui",
  "description": "只授给 Hub UI 子 WebView；Bot 子 WebView 不匹配任何 capability，因此没有 IPC",
  "webviews": ["hub"],
  "local": true,
  "permissions": [
    "core:event:default",
    "notification:default",
    "allow-hub-connection",
    "allow-bot-panel-set-layout",
    "allow-bot-panel-reload",
    "allow-bot-panel-navigate",
    "allow-bot-panel-open-external",
    "allow-bot-panel-clear-data",
    "allow-set-tray-status",
    "allow-reveal-path",
    "allow-open-external",
    "allow-sidecar-restart"
  ]
}
```

- 在 `build.rs` 里用 `tauri_build::Attributes::new().app_manifest(AppManifest::new().commands(&[...]))` 声明应用命令，生成 `allow-<命令>` 权限，再按上面逐个授权。
- 不授予 `core:default`、`core:webview:*`、`core:window:*`、`shell:*`、`fs:*`：Hub UI 不需要创建窗口、执行命令或读写文件。
- 不配置 `remote`：外部 URL 无论 label 是什么都拿不到权限。

Hub UI 的 CSP（`app.security.csp`）：

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:* ws://127.0.0.1:*
```

端口可以在设置里改，CSP 是构建期常量，所以端口用通配；Hub UI 不加载任何远程内容，风险可接受。CSP 只作用于 Hub UI 自己的资源，不影响 Bot 子 WebView。

## 7. 菜单栏图标、应用菜单、通知

- **菜单栏图标**：图标旁显示待审批数；菜单项：打开 Agent Hub、新建任务、待审批（N）、暂停接收桥接任务、退出。“暂停接收桥接任务”打开后，桥接方创建任务返回 `503 BRIDGE_PAUSED`。
- **应用菜单**：标准 macOS 菜单（含“编辑”），“视图”下放 §2.4 的快捷键。
- **通知**：有新审批（窗口不在前台时必发）、任务完成或失败（可在设置里关）、网页 Agent 需要登录。macOS 上点击通知会激活应用，Hub UI 定位到最近一条相关任务。

## 8. 打包与分发

| 阶段  | 方式                                                                                                                                                                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0–M4 | 从源码运行：`pnpm dev:agent-hub`，或 `tauri build` 出的 .app 以“外部侧车”模式指向仓库里构建好的侧车。                                                                                                                                                  |
| M5    | 自包含 .app：侧车的 `dist` 与生产依赖经 `pnpm deploy --prod` 输出（pnpm 10 下需要 `inject-workspace-packages=true` 或 `--legacy`，实现时以实测为准），作为 `bundle.resources` 打进包里；Prisma 的 `binaryTargets` 含 `darwin-arm64`；Node 仍用系统的。 |

- bundle identifier：`com.multiapps.agenthub`；`bundle.macOS.minimumSystemVersion` 设 `13.0`（Bot 存储隔离需要 14，见 §3.2）。
- 签名：个人使用先用 ad-hoc 签名（`signingIdentity: "-"`）。公司 MDM 如果拦截未签名应用，见风险 R9。
- **不开自动更新**，不做任何外网请求。
- 根 `package.json` 的 `build` 脚本加 `--filter=!@agent-hub/desktop`（与 `@cardhub/native` 一样不进 CI 构建）。

## 9. Rust 代码结构

```text
src-tauri/src/
├── main.rs        # 入口
├── lib.rs         # Builder、插件注册、setup
├── window.rs      # 主窗口与两个子 WebView 的创建（unstable API）
├── bot_panel.rs   # Bot 子 WebView：布局、显示隐藏、导航白名单、弹窗策略（unstable API）
├── sidecar.rs     # Node 定位、启动、ready 解析、退避重启、退出
├── shell_env.rs   # 登录 shell PATH 解析
├── tray.rs        # 菜单栏图标与菜单
├── menu.rs        # 应用菜单与快捷键
└── commands.rs    # §5 的 IPC 命令
```

可以单测的纯函数（`cargo test`）：导航白名单匹配、布局参数裁剪、`node --version` 解析、PATH 标记截取、退避时间计算。

## 10. 手工验收清单（macOS）

每次改 `desktop/` 或升级 Tauri 都要过一遍，结果贴在 PR 里：

1. 冷启动：从 Finder 打开 .app，20 秒内出现任务列表；Agent 健康检查能找到 `codex` 与 `qodercli`（验证 PATH 解析）。
2. Bot 面板加载本地郎页面，登录后退出应用再打开，仍是登录状态。
3. 三档宽度和折叠切换时，Bot 面板与左栏严丝合缝；窗口拉大缩小、切到外接屏（不同缩放比）后位置正确。
4. 打开“新建任务”对话框时 Bot 面板隐藏，关闭后恢复；右栏的下拉菜单不被遮挡。
5. 焦点在 Bot 面板里时按 ⌘1 能折叠；两个面板里 ⌘C / ⌘V 都正常。
6. 在 Bot 页面的开发者工具里执行 `window.__TAURI_INTERNALS__?.invoke('hub_connection')`，调用失败（无 IPC）。
7. Bot 页面里的外部链接在系统浏览器打开；登录弹窗能完成登录。
8. 关闭窗口后任务继续，菜单栏数字随审批变化；⌘Q 在有运行任务时弹确认。
9. 用活动监视器结束侧车进程：界面出现“服务已断开，正在重启”，几秒后恢复，原任务显示“已中断”。
10. 强制结束 Tauri 主进程：侧车随之退出，Agent 子进程不残留（`ps -ax | grep -E 'codex|qodercli'`）。
