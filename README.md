# Split Sphere

> A minimal floating command orb for ultra-fast clipboard snippets.

`Split Sphere` 是一个基于 Electron 的透明悬浮球桌面程序。它驻留在屏幕右下角，以四层轨道球阵提供高频文案的一键复制能力。

## Core Interaction Matrix

- `LMB` 主球：展开 / 收拢轨道球
- `RMB` 主球：弹出右键菜单（展开 / 编辑 / 导入 / 导出 / **退出**）
- 点击轨道球：复制对应文案到系统剪贴板
- 球内展示：最多前 4 个字（复制仍为完整原文）
- 系统托盘右键：展开文案球 / 编辑文案 / **退出**

退出有两条路径：主球右键菜单，或托盘菜单。不再需要任务管理器。

## Single-Window Architecture（抗闪烁核心）

早期版本使用 anchor(96×96) 与 overlay(640×640) 两个窗口互相 hide/show 切换，主球在两个窗口各画一份 —— 这是打包成 EXE 后右下角主球闪烁的根因。

现改为**单窗口常驻**：

- 单一 640×640 透明窗口常驻显示，主球位置恒定不动
- 平时 `setIgnoreMouseEvents(true, { forward: true })`：点击穿透给下层应用，但 mousemove 仍转发给本窗口
- 渲染层判断指针是否落在主球 52px 半径内，动态切换是否捕获鼠标
- 展开轨道或打开编辑面板时整窗捕获鼠标；收起动画播完后再恢复穿透

由于不存在窗口切换，主球全程静止，切换闪烁从根源上消除。

## Anti-Flicker Measures

| 措施 | 说明 |
|---|---|
| 单窗口常驻 | 移除 anchor/overlay 的 hide/show 切换 |
| `ready-to-show` | `show: false` 创建，首帧就绪后再显示（附 3 秒兜底） |
| 置顶节流 | `setAlwaysOnTop` 节流 800ms，避免频繁 Z 序重排引发重绘 |
| `font-display: block` | 避免字体 swap 造成的文字闪烁 |
| 字体子集化 | 1.9MB WOFF2，首帧几乎瞬时，消除 FOUT |

## Fonts

Noto Sans SC 400 / 700 两个字重，取 GB2312 子集（6938 字符）并转为 WOFF2，合计 **1.9MB**（原 33MB TTF，减少 94%）。

子集外的生僻字会自动回退到 `PingFang SC` / `Microsoft YaHei`，不会显示豆腐块。

如需增加字符覆盖，重新子集化并替换 `fonts/` 下两个 woff2 即可。

## Visual & Runtime Specs

- 纯悬浮层：无网页主体区
- 透明无边框窗口（`screen-saver` 层级置顶，节流重设）
- 主球圆心锚定在窗口右下角（仅显示左上象限）
- 四圈轨道布局：`3 + 4 + 5 + 6`，共 18 球，向左上扇区展开
- 轨道半径按窗口尺寸线性缩放（基准 640）
- 本地持久化：渲染进程 `localStorage`
- 文案导入/导出：编辑器头部按钮或右键菜单（JSON 格式）
- 单实例锁：重复启动会聚焦现有实例
- 窗口关闭按钮被拦截，退出请走右键菜单或托盘

## Project Topology

- `index.html`：UI 骨架
- `styles.css`：视觉系统与动效
- `app.js`：轨道排布、复制、编辑、导入导出、鼠标穿透判定
- `main.js`：Electron 主进程（窗口、Tray、右键菜单、剪贴板、文件对话框、日志）
- `preload.js`：通过 `contextBridge` 暴露受限的 IPC 能力
- `tray-icon.png`：托盘图标（64×64 透明圆）
- `fonts/`：Noto Sans SC 子集 WOFF2
- `.github/workflows/build.yml`：云端 Windows 打包流水线

## Local Launch

```bash
npm install
npm start
```

注意：若环境变量中存在 `ELECTRON_RUN_AS_NODE=1`，Electron 会以 Node 模式启动并报 `app is undefined`。启动时请先 `unset ELECTRON_RUN_AS_NODE`。

## Build Windows EXE (Local)

```bash
npm install
npm run pack:win
```

输出目录：`dist/`

## Cloud Build EXE (GitHub Actions)

仓库已内置工作流 `Build Windows EXE (x64)`：

- 自动触发：push 到 `main/master`
- 手动触发：GitHub Actions -> `Run workflow`

下载步骤：

1. 进入仓库 `Actions`
2. 选择 `Build Windows EXE (x64)`
3. 打开成功运行记录
4. 在 `Artifacts` 下载 `windows-exe-x64`

## Debug Logging

调试日志受 `app.isPackaged` 控制：

- 未打包运行（`npm start`）：开启，文件位于 userData 下 `debug.log`
- 打包后默认关闭，可通过环境变量 `SPLIT_SPHERE_DEBUG=1` 强制开启
- 日志按 400ms 缓冲批量写入，超过 2MB 自动轮转

按 `Ctrl+Shift+L` 可把日志尾段复制到剪贴板。

## Notes

- 窗口关闭按钮（`Alt+F4`）被主进程拦截，退出请走右键菜单或托盘菜单。
- 重复启动会被 `requestSingleInstanceLock` 拦截并聚焦现有实例。
- 文案数据存于 localStorage，卸载程序会丢失；建议定期使用「导出」备份。
- 鼠标穿透依赖 `setIgnoreMouseEvents(true, { forward: true })` 的 mousemove 转发，这是 Electron 的标准能力，Windows / macOS 均支持。
