# Split Sphere

> A minimal floating command orb for ultra-fast clipboard snippets.

`Split Sphere` 是一个基于 Electron 的透明悬浮球桌面程序。它驻留在屏幕右下角，以三层轨道球阵提供高频文案的一键复制能力。

## Core Interaction Matrix

- `LMB` 主球：展开 / 收拢轨道球
- `RMB` 主球：打开文案配置面板
- 点击轨道球：复制对应文案到系统剪贴板
- 球内展示：最多前 4 个字（复制仍为完整原文）

## Smart Collapse Zone（你提到的特性）

程序当前存在一个“近场交互区”特性：

- 在圆心附近（主球及轨道球可点击范围）再次点击，外围球会收回
- 点击更远处的透明区域，通常不会触发收回

这是由透明无边框窗口 + 组件命中区域共同形成的行为，适合悬浮工具场景，能避免误触导致频繁收起。

## Visual & Runtime Specs

- 纯悬浮层：无网页主体区
- 透明无边框窗口（Always On Top）
- 主球圆心锚定在窗口右下角（仅显示左上象限）
- 三圈轨道布局：`3 + 4 + 5`，向左上扇区展开
- 本地持久化：`localStorage`

## Project Topology

- `index.html`：UI 骨架
- `styles.css`：视觉系统与动效
- `app.js`：轨道排布、复制、编辑交互
- `main.js`：Electron 主进程窗口配置
- `.github/workflows/build.yml`：云端 Windows 打包流水线

## Local Launch

```bash
npm install
npm start
```

## Build Windows EXE (Local)

```bash
npm install
npm run pack:win
```

输出目录：`dist/`

## Cloud Build EXE (GitHub Actions)

仓库已内置工作流 `Build Windows EXE`：

- 自动触发：push 到 `main/master`
- 手动触发：GitHub Actions -> `Run workflow`

下载步骤：

1. 进入仓库 `Actions`
2. 选择 `Build Windows EXE`
3. 打开成功运行记录
4. 在 `Artifacts` 下载 `windows-exe-build`

## Notes

- 这是桌面应用形态，不依赖浏览器页面展示主体。
- 若需要“点击任意远处也收起”，可以再加全局收拢策略（可选增强）。
