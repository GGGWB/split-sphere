# Split Sphere

纯悬浮球桌面程序（Electron），用于快速复制常用文案。

## 功能

- 右下角主悬浮球，左键展开/收起。
- 三圈球阵：`3 + 4 + 5`，向左上扇区展开。
- 点击任意球：复制对应文案到系统剪贴板。
- 球内仅显示前 4 个字；复制时保留全文。
- 右键主球：打开文案编辑面板。
- 编辑内容自动保存到本地（`localStorage`）。

## 项目结构

- `index.html`：悬浮球界面结构
- `styles.css`：动画与样式
- `app.js`：交互逻辑（展开、复制、右键编辑）
- `main.js`：Electron 主进程（透明无边框置顶窗口）
- `.github/workflows/build.yml`：GitHub Actions 云端打包 Windows EXE

## 本地开发

```bash
npm install
npm start
```

## 打包 Windows EXE（本地）

```bash
npm install
npm run pack:win
```

打包结果输出到 `dist/`。

## 云端打包 EXE（GitHub Actions）

已内置工作流：`.github/workflows/build.yml`

触发方式：

- 推送到 `main` 或 `master`
- 在 GitHub 仓库 `Actions` 页面手动点击 `Run workflow`

下载方式：

1. 打开仓库的 `Actions`
2. 进入 `Build Windows EXE`
3. 打开成功运行记录
4. 在底部 `Artifacts` 下载 `windows-exe-build`

## 说明

- 这是桌面应用，不会在浏览器打开网页主体。
- 运行时视觉上仅显示悬浮球组件和（按需出现的）编辑面板。
