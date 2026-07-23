[English](./README.md) | **中文**

# TritonPlan

**一款以日历为核心的 UCSD 排课工具——找回新版 Triton Student System（TSS）没有提供的 WebReg "plan" 视图。**

**➡️ 打开排课网站：<https://hfjddjksaj.github.io/tritonplan/>**
**➡️ 安装扩展：[Chrome 应用商店](https://chromewebstore.google.com/detail/tritonplan/lnchlccmjhhpbbemlfnpldooeehcmjel)**

老 WebReg 会把你的一周画成日历——上课时间、地点、教授、Section、期末考试一目了然，选课前就能看到时间冲突。新 TSS 没有这个功能。TritonPlan 把它重建了出来，由两部分组成：

1. **一个 Chrome / Edge 扩展**：被动读取 TSS 本就展示给你的课程数据，在每个可选的 Section 上加一个 **"+ TritonPlan"** 按钮。
2. **一个静态排课网站**：把你的一周画成日历并标出冲突。没有后端，你在上面做的一切都不会离开你的浏览器。

> **非官方、学生自制工具。** 与 UC San Diego 无隶属关系，未获其授权或认可。详见[免责声明](#免责声明)与 [PRIVACY.md](./PRIVACY.md)。

---

## 功能

- **每周日历**——每节 Lecture、Discussion、Lab 按天和时段排布，今天所在列有实时的"当前时间线"。
- **时间冲突检测**——相互重叠的上课时段会亮起，一眼看清撞在哪。
- **期末视图**——期末考试按日期排列，另有一张 finals 周日历（含周六周日），并单独检测期末冲突。
- **切换 Section**——对比一门课的各套 Lecture / Discussion / Lab 组合（标注 LEC / DIS / LAB 和剩余名额），在排课表里直接换掉冲突的那套。
- **跳回 TSS**——点日历上的课程代码回到 TSS 中的那门课，也可以直接跳到该 Section 的 booking 页面。
- **教学楼查询**——点上课地点，弹窗显示这是哪栋楼，附 Google Maps 和 UCSD 校园地图链接。
- **分享与导出**——整个方案压缩进一个可分享的链接；也支持 JSON 导出 / 导入做备份。
- **本地优先**——方案保存在浏览器的 `localStorage` 里，不上传到任何地方。

## 截图

![高亮时间冲突的每周日历](docs/screenshots/calendar.png)

![切换 Section 消解冲突](docs/screenshots/section-switch.gif)

![期末视图标记两场重叠的期末考](docs/screenshots/finals.png)

![注入在 TSS Section 卡片上的 "+ TritonPlan" 按钮](docs/screenshots/tss-button.png)

![教学楼弹窗与地图链接](docs/screenshots/building-popover.png)

---

## 工作原理：捕获服务器本来就发给你的 OData

TSS 是一个 SAP（SAPUI5 / Fiori）网页应用。你浏览 Schedule of Classes 时，TSS 服务器把课程数据以 **OData**（JSON）响应发到你的浏览器，页面再渲染到屏幕上。

TritonPlan 需要的仅此而已。扩展在这些响应**到达你浏览器时把它们复制一份**——那是服务器本来就已经发给*你*的数据——从中解析出课表，交给排课网站。它从不向服务器索取任何东西。

这条被动式设计是整个产品的铁律：

- **零自发请求。** 扩展只观察 TSS 页面自己抓取的响应（对页面自己的 `fetch`/`XHR` 做 `response.clone()`），从不自己发起、重放、重试、预取或轮询。
- **零自动化。** 从不点击 TSS 的按钮，从不替你提交任何东西。
- **流量无差别。** 因为它不产生任何额外流量，你的流量与其他任何学生逐字节一致。
- **最小权限。** 仅 `storage` 和 `tabs`，外加对 `tss.ucsd.edu` 和排课网站的主机访问。没有统计，没有追踪。

---

## 使用方法

1. **[安装扩展](https://chromewebstore.google.com/detail/tritonplan/lnchlccmjhhpbbemlfnpldooeehcmjel)**（Edge 也可以直接从 Chrome 应用商店安装）。
2. 照常在 TSS 里浏览 **Schedule of Classes**。
3. 在想要的 Section 上点 **"+ TritonPlan"**——你会来到排课网站，那个 Section 已经摆好。
4. 调整各门课的 Section 避开冲突，再看一眼 **Finals** 视图。
5. **分享或导出**你的方案。

<details>
<summary>手动安装（加载已解压的扩展）</summary>

1. 从源码构建：`npm install && npm run build -w @triton/extension` → `extension/dist`。
2. 打开 `chrome://extensions`，开启**开发者模式**，点击**加载已解压的扩展程序**，选择 `extension/dist`。

</details>

**平台支持：** 扩展在任意操作系统的 Chrome / Edge（MV3）上运行；排课网站支持任何现代浏览器。

---

## 隐私

没有账号、没有后端、不收集数据，一切留在你的浏览器里——见 [PRIVACY.md](./PRIVACY.md)。

## 开发

Monorepo 结构：`shared/`（数据模型与冲突逻辑）、`web/`（React 排课网站）、`extension/`（MV3 扩展）。环境搭建、常用命令与架构说明见 [docs/development.md](./docs/development.md)。

## 致谢

在 **Claude AI**——Anthropic 的 **Claude Code**——的协助下构建。

## 免责声明

TritonPlan 是一款**非官方、学生自制的工具**，与 UC San Diego 无隶属关系，未获其授权或认可。它只读取本就已经展示在你自己浏览器里的课程数据，并保存在你的设备本地。按**"原样"提供，不作任何担保——使用风险自负**。你需自行负责按照 UCSD 的《可接受使用政策》（Acceptable Use Policy）及所有适用的 UCSD 政策来使用它。

## 许可证

MIT——见 [`package.json`](./package.json) 中的 `license` 字段。
