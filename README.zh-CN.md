[English](./README.md) | **中文**

# TritonPlan（崔顿排课）

**一款以日历为核心的加州大学圣地亚哥分校（UCSD）排课工具 —— 找回新版 Triton Student System（TSS）从未提供的 WebReg "plan"（排课）视图。**

TritonPlan 找回了几乎每个 UCSD 学生都怀念的功能：像 Google 日历一样按周展示你的课程 —— 上课时间、地点、教授、Section，**以及期末考试时间** —— 并即时检测时间冲突。老 **WebReg** 有这个功能，新的 **Triton Student System（TSS）** 却没有。所以我们把它重做了一遍。

> **非官方、学生自制工具。** 与 UC San Diego 无隶属关系，未获其授权或认可。它只读取 TSS 本就在**你自己的**浏览器里展示给**你**的课程数据，并把一切都留在**你的**设备上。详见[免责声明](#免责声明)与 [PRIVACY.md](./PRIVACY.md)。

---

## 它是什么

TritonPlan 由两个协同工作的部分组成：

1. **一个 Chrome / Edge 浏览器扩展** —— 它**被动地**读取 TSS 本就展示给你的课程数据，并在每个可选的 Section 上注入一个小小的 **"+ TritonPlan"** 按钮。点一下，这门课就直接落到你的排课表上。
2. **一个独立的排课网站** —— 用 React 编写，完全静态，托管在 GitHub Pages 上，**没有后端**。它把你的一周画成日历，标出冲突，并让你分享或导出你的方案。

你照常在 TSS 里浏览课程，TritonPlan 则在背后悄悄把它们变成一张你真正能拿来做决策的每周课表。

---

## 功能

- **每周日历网格** —— 每节 Lecture、Discussion、Lab 都按周一至周日、按时间段排布。
- **时间冲突检测与高亮** —— 核心价值。相互重叠的上课时段会亮起，让你一眼看清冲突。
- **期末考试（Finals）视图** —— 专门按日期顺序列出你的期末考试，并独立检测期末冲突（在选课前就发现连轴转或相互重叠的考试）。
- **切换 Section 组合来化解冲突** —— 直接在排课表里为某门课换一套 Lecture / Discussion / Lab 组合，冲突随之消失。
- **"已浏览与已添加课程"侧栏** —— 你在 TSS 打开过的课程会汇集到侧栏，并带一个筛选框，方便你快速找到并把想要的课程拉进方案里。
- **通过网址分享 + JSON 导出/导入** —— 你的整个方案会被编码进一个可分享的链接（压缩进网址里，无需服务器），也能导出/导入为 JSON 文件 —— 可移植到任何浏览器或分享给同学。
- **跳回 TSS** —— 点击日历上任意一个课程块，即可在 TSS 中重新打开那门课。
- **本地优先** —— 你的方案保存在浏览器的 `localStorage` 和可分享的网址里，不会上传到任何地方。

---

## 截图

*截图待补 —— 见 [`docs/screenshots/`](./docs/screenshots/)。*

<!-- ![高亮冲突的每周日历](docs/screenshots/calendar.png) -->
<!-- ![期末视图](docs/screenshots/finals.png) -->
<!-- ![注入在 TSS Section 上的 "+ TritonPlan" 按钮](docs/screenshots/tss-button.png) -->

---

## 如何使用

1. **安装扩展**（见下方[安装扩展](#安装扩展)）。
2. 照常在 TSS 里**浏览一门课**（Schedule of Classes）。
3. 在你想要的 Section 上点击 **"+ TritonPlan"**。
4. 你会来到 **TritonPlan 日历**，那个 Section 已经为你摆好。
5. **调整你的 Section** 以避开冲突 —— 如果两门课撞车，就换一门课的 Section 组合，并查看 **Finals** 视图。
6. 满意后**分享或导出**你的方案。

你也可以从扩展的弹窗直接打开排课网站（不添加任何课程），或者干脆访问排课网站 —— 它自带一小段示例课表，方便你先体验界面。

---

## 工作原理

TSS 基于 **SAP Student Lifecycle Management（SLcM）** —— 一个由 **OData** 服务驱动的 SAPUI5 / Fiori 应用。TritonPlan 的整个设计都围绕一条铁律：

### 零封禁、纯被动观察的设计

**扩展从不与 TSS 服务器通信。** 它是一个*纯粹的被动观察者*：

- 它只**拦截** TSS 页面**本就已经抓取**的 OData 响应（对页面自己的 `fetch`/`XHR` 做 `response.clone()`）。它**从不自己发起、重放、重试、预取或轮询**任何请求。
- 它**从不自动化操作** TSS —— 从不点击 TSS 的按钮、从不替你提交任何东西。"+ TritonPlan" 按钮只读取已经捕获到的数据，并把它交给*我们自己的*排课网站。
- 因为它产生**零额外服务器流量**、也不驱动任何操作，**服务器无法把 TritonPlan 用户与普通学生区分开来**。在 TSS 看来，你的流量与其他任何人逐字节完全一致。
- **最小权限：** 仅 `storage` 和 `tabs`，外加对 `tss.ucsd.edu`（读取你屏幕上已有的数据）和排课网站（把数据交给它）的主机访问权限。没有广泛的网络访问、没有分析统计、没有追踪。

这是贯穿整个代码库的、刻意划定的红线。你的数据留在你的设备上。

### 数据流

1. **捕获（扩展，在 `tss.ucsd.edu` 上）：** 一个运行在页面上下文的拦截器观察 Schedule of Classes 应用加载的 OData 响应，并把每个响应体转交给扩展的后台 worker，由它保存在本地。
2. **解析与归一化：** 扩展把 SAP 预先格式化好的 `Sched` 字符串解析成每周的**上课时段**外加一个可选的**期末考试**，并把 SAP 的 **EventPackage**（源数据里以「每个 Event × EventPackage 一行」的方式反规范化）归组为可选的 **Section 组合** —— 例如一节 Lecture + 一节特定的 Lab + 一节 Discussion。没有可排布时间的待定/异步课程会被单独放进"未排课"列表。
3. **桥接到网站：** 当你点击 **"+ TritonPlan"**（或打开排课网站）时，扩展通过 `window.postMessage` 把数据送进排课页面，使用两种消息类型：`courses`（你浏览过的所有课程的集合）和 `plan-add`（立即添加这个确切的 Section）。
4. **排课（网站）：** 排课网站是一个静态单页应用。它合并收到的课程、绘制日历、计算冲突，并把你的方案保存在 `localStorage` 里。分享会把整个方案编码进网址的 hash（用 lz-string 压缩）；导出/导入用的是普通 JSON。

扩展产出、网站消费的归一化数据模型定义在 [`shared/src/types.ts`](./shared/src/types.ts)。对 TSS 的逆向分析笔记见 [`docs/tss-recon/tss-api-notes.md`](./docs/tss-recon/tss-api-notes.md)。

### 是重现，不是照搬

TritonPlan 重现了 WebReg 的*排课功能* —— 但没有沿用它过时的界面。UI 全部重新设计、以日历为核心：一块沉静的藏青配金色的"排课台面"，用等宽字体呈现课表数据，并把**冲突作为标志性的视觉状态**。它看起来和老 WebReg 毫无相似之处；只是终于把 WebReg 做过的事又做好了。

---

## 安装扩展

### 从 Chrome 应用商店安装（推荐，上架后）

在 Chrome 应用商店（Microsoft Edge 同样适用）搜索 **TritonPlan** 并点击**添加**。*（商店上架待定。）*

### 开发者安装（加载已解压的扩展）

在 Chrome 或 Edge（Chromium）中，使用一份已构建好的扩展：

1. 构建扩展，使 `extension/dist/` 存在（其 `manifest.json` 位于 `dist` 的根目录）。
   ```
   npm install
   npm run build -w @triton/extension
   ```
2. 打开 `chrome://extensions`（或 `edge://extensions`）。
3. 打开**开发者模式**。
4. 点击**加载已解压的扩展程序**，选择 `extension/dist` 文件夹。
5. 登录 TSS 并打开 Schedule of Classes —— **"+ TritonPlan"** 按钮会出现在各 Section 卡片上。

> 当前构建把排课桥接指向本地开发用的排课网站（`http://localhost:5173`）。正式安装时，会在把扩展打包上传到商店之前，把生产环境的排课网址写进扩展 —— 见 [`docs/deployment.md`](./docs/deployment.md)。

---

## 运行排课网站（面向开发者）

排课网站是一个标准的 Vite + React 应用。

```
npm install
npm run dev -w @triton/web      # 本地开发服务器（http://localhost:5173）
npm run build -w @triton/web    # 静态构建 → web/dist（base './'，支持子路径托管）
```

构建产物是一个静态网站 —— 把 `web/dist` 部署到 GitHub Pages（或任意静态托管）。详见 [`docs/deployment.md`](./docs/deployment.md)。

---

## 仓库结构

```
plan/
├── shared/         共享 TypeScript：归一化数据模型 + 冲突/时间逻辑
│   └── src/types.ts     扩展与网站之间的契约
├── web/            排课网站（React + Vite，静态）
│   └── src/             日历 UI、排课状态、分享/导出、TSS 深链
├── extension/      Chrome/Edge MV3 扩展
│   └── src/             被动拦截器、TSS 解析器、后台 worker、弹窗
└── docs/           TSS 逆向分析笔记 + 部署指南
    └── screenshots/     （待补）
```

这是一个 npm workspaces 单仓库（`shared`、`web`、`extension`）。

---

## 浏览器与平台支持

- **扩展：** Chrome 与 Edge（Chromium），Manifest V3 —— 同一个包在 Windows、macOS、Linux 和 ChromeOS 上完全一致地运行。Firefox 与 Safari 是可能的后续目标，暂不在计划内。
- **排课网站：** 任意操作系统上的任意现代浏览器（它只是一个静态网站）。

---

## 隐私

TritonPlan **不**收集任何个人数据，**没有**后端。一切都留在你的浏览器里。请阅读完整的[隐私政策](./PRIVACY.md)。

---

## 致谢

在 **Claude AI** —— Anthropic 的 **Claude Code** —— 的协助下构建。

---

## 免责声明

TritonPlan 是一款**非官方、学生自制的工具**，与 **UC San Diego 无隶属关系，未获其授权或认可**。它只读取本就已经展示在你自己浏览器里的课程数据，并把它保存在你的设备本地；它**不**收集、**不**传输任何个人数据。它按**"原样"提供，不作任何担保 —— 使用风险自负**。你需自行负责按照 UCSD 的《可接受使用政策》（Acceptable Use Policy）及所有适用的 UCSD 政策来使用它。

## 许可证

MIT —— 见 [`package.json`](./package.json) 中的 `license` 字段。
