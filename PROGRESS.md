# TritonPlan — 项目进度 / Progress

> 2026-07-22 由 Claude 通读代码后补写（此前开发未留进度文档）；同日完成一轮前端/扩展修复（见"2026-07-22 修复记录"）。

## 项目是什么

为 UCSD 新的 SAP 系统 **TSS (Triton Student System)** 补上旧 WebReg 的"周历排课"体验。两部分：

- **`extension/`** — Chrome/Edge MV3 扩展，在 tss.ucsd.edu 上**被动**捕获页面自己发出的 OData 响应（"NO-BAN 红线"：只 `response.clone()`，绝不主动发/重放请求），解析成课程数据，并在 TSS 课程卡片上注入 "+ TritonPlan" 按钮。
- **`web/`** — React 18 + Vite 静态 SPA（无后端），Google-Calendar 式周历、冲突检测、期末考视图、URL 分享（lz-string 压缩进 `#p=`）、localStorage 持久化。
- **`shared/`** — 共享领域模型与逻辑（`types.ts` / `time.ts` / `conflicts.ts`），extension 和 web 都通过别名引用其 TS 源码。

npm workspaces monorepo；根目录 `npm run test / build / typecheck` 分发到各 workspace。测试用 Vitest（parser、capture、tss-dom、shared time/conflicts、web bridge/share/storage/layout/tss 均有覆盖）。

## 数据流（一句话版）

TSS 页面 → `interceptor.ts`(MAIN world 钩 fetch/XHR) → `postMessage` → `tss-relay.ts` → `chrome.runtime` → `service-worker.ts` 的 `CaptureStore`（chrome.storage.local）→ 解析（`extract-odata` → `normalize` → `CourseOffering`）→ planner 页面上的 `planner-bridge.ts` → `window.postMessage` → web 端 `lib/bridge.ts` → `usePlan` 状态。

"+ TritonPlan" 按钮：`tss-inject.ts` 读卡片 → `MSG.PLAN_ADD` → SW 入队并打开/聚焦 planner → bridge `DRAIN_PLAN_ADDS` 送达。

消息协议常量集中在 `extension/src/config.ts`（`MSG` 注册表、`BRIDGE_SOURCE`、`PLANNER_ORIGIN` 等）。

## 当前状态

- v0.1.0 已打包：根目录 `tritonplan-extension-v0.1.0.zip`（extension/dist 产物）。
- 部署目标：web → GitHub Pages（`vite base:'./'`）；扩展 → Chrome Web Store（申请中，见 `docs/deployment.md`）。
- TSS 逆向笔记：`docs/tss-recon/tss-api-notes.md`（2026-07-21 实测，Fall 2026，`Sched` 字符串文法已完整记录，fixtures 为真实捕获数据）。
- DOM 注入选择器（`.socPkgBlock` 等 UCSD 自定义类）2026-07-21 实测有效。

## 2026-07-22 修复记录（本轮全部完成，typecheck/78 项测试/双构建均通过）

**主修（用户反馈）**
- **"Browsed — not yet added" 无法移除课程** → 每行新增 × 移除按钮（`ctl.removeFromPool`），列表标题旁新增 "Clear all" 一键清空（`ctl.clearBrowsed`，带确认）。注意：扩展已捕获的课程会在下次 `courses` 推送时回来（语义上它仍是"浏览过"的）；彻底遗忘需扩展端支持，见"待办"。
- **生产版内置 3 门 CSE 测试课程** → `sample-courses.json` 改为仅 dev 构建载入（`import.meta.env.DEV`，生产 bundle 已验证摇树移除）；`storage.ts` 新增一次性迁移 `purgeSeededSamples`，把老用户 localStorage 里被种入的 3 门课清掉（打标记只跑一次）。

**清单修复**
1. planner 域名对齐（用户确认 `https://hfjddjksaj.github.io/tritonplan/` 为正式域名）：manifest/`build.mjs` 注释/`docs/deployment.md` 全部对齐；README 只留一句，细节在 deployment.md。
2. 本地开发桥接修复 + 构建区分 dev/prod：`planner-bridge.ts` targetOrigin 改用 `location.origin`；`build.mjs --dev`（`npm run build:dev`；`watch` 默认带 `--dev`）通过 esbuild `define` 注入 planner URL 并向 dist manifest 注入 localhost 匹配 —— 源 manifest.json 与正式 zip 不含任何 localhost 痕迹（已验证）。
3. web bridge 加固：`installBridgeListener` 校验 `event.source === window && event.origin === location.origin`，新增伪造消息被拒的测试。
4. `resetPlan` 接入 UI：Topbar 新增 "Clear" 按钮（confirm + toast）。
5. `todayWeekday()` 类型/JSDoc 修正（总是返回 Weekday）。
6. 金色"当前时间线"实现：`CalendarGrid` 每分钟刷新，只画在今天列、超出 7:00–22:00 视窗时隐藏（`.cal-nowline`）。
7. `bridge.ts`/`usePlan.ts` 过时"(future)"注释更新。
8. 冲突对去重收敛：`lib/plan.ts` 新增 `conflictPairKey`/`countConflictPairs`（App 与 ConflictBanner 共用）；`shared/conflicts.ts` 新增 `courseIdsInConflicts` 供 usePlan 复用。
9. 分页捕获不再互相覆盖：relay 随 INGEST 带上 URL，`CaptureStore.ingestBody(body, url)` 对 `$skip>0` 的续页按 `EventPkgOtjid|EventID` 合并，非分页的重新浏览仍整体替换（新增 2 个测试）。
10. 品牌色统一为 navy/gold：图标六边形紫→navy `#0b1f3a`（web `--ink`），popup 头部/按钮同步；TSS 注入按钮保持 `#27367b`（刻意模仿 TSS 原生按钮，不改）。
11. 附带修好的**原有**构建环境问题：extension 缺 `@types/node` 导致 typecheck 从未跑通；补上后暴露的全部 `noUncheckedIndexedAccess` 严格错误（shared/time、conflicts、extension parser/tss-dom/测试）已逐一修复。根目录 `tritonplan-extension-v0.1.0.zip` 已用新的生产构建重打包。

**文档重构（同日晚些时候）**
- 两份 README 重写为纯用户视角：顶部新增排课网站链接；"工作原理"改为围绕"捕获服务器本来就发给你的 OData"讲清楚原理 + 零封禁设计；删掉过时的"自带示例课表"说法；仓库结构、开发命令、数据流内部细节全部挪到新的 `docs/development.md`（开发者指南）。
- 扩展 **v0.1.0 已上架** Chrome Web Store，README 安装章节改为直接放商店链接（listing 链接见 docs/deployment.md）。
- 扩展 zip 暂不再重打包 —— 用户要求等其确认后再打（还有其他问题要修）。

## 2026-07-22 前端渲染修复（第二轮，用户带截图逐个报告；全部经 headless Chrome 截图验证 + 测试通过）

1. **Section 选项行排版溢出**：根因是 `.opt__code`/`.opt__summary` 是 inline `<span>` 却按块级写样式，代码被腰斩、摘要溢出压住座位数。重构为三行结构（代码+右侧座位数 / 教师 / 课表片段），课表摘要拆成片段（`lib/plan.ts` 新增 `optionSummaryParts`），**只在片段间换行**；星期缩写从 `MonWed` 改为 TSS 记法 `MW`/`TuTh`。
2. **日历时间窗与标签裁切**：时间窗从 7:00–22:00 收成 **8:00–22:00**（UCSD 无 8 点前/10 点后课程）；小时标签垂直居中在小时线上导致首尾标签被裁掉一半，`.cal-grid` 加上下内边距解决；时间栏加宽到 64px 让 "10:00 AM" 不再折行。
3. **课程块太矮、信息不全**：`pxPerMinute` 0.92→**1.3**（50 分钟课 ≈65px）；代码与类型合并到同一行；块内行距 1.35；教师显示阈值 74→60px。标准 50 分钟课现在完整显示代码+类型/时间/地点/教师四行。
4. **Finals 周历**：Finals 页在原列表下方新增 "Finals week at a glance" 日历卡。列为**最早→最晚考试日的连续真实日期**（空档日保留、**周六/周日正常渲染**并带周末底色）；复用 `CourseBlock` 与 cal-* 样式；布局为纯函数 `finalsDateRange`/`layoutFinalsWeek`（`lib/layout.ts`，同日重叠标红并排、>14 天跨度兜底），新增 3 个单测（web 共 42 个测试通过）。

## 已知问题 / 待办

- `normalize.ts` `PERIOD_SEASON` 仍只映射 Fall（'2'）——其他学期的 SAP AcademicPeriod 代码尚无实测数据，等捕获到 Winter/Spring/Summer 再补（防御性 fallback 会显示 "Period N YYYY"）。
- "移除已浏览课程"对扩展已捕获的课程只在下次推送前生效；如需持久遗忘，要给扩展加"从 CaptureStore 删除该课程"的消息（popup 或 planner 侧入口）。
- 本机（新电脑）尚未安装 Node —— 本轮验证用的是临时目录里的便携版 Node v22；正式开发建议装 Node ≥20。
- 扩展 v0.1.0 **已上架** Chrome Web Store（链接见 docs/deployment.md）；本轮修复要发新版时需先把 manifest `version` 升到 0.1.1（商店拒绝同版本重传），再重新构建打包 —— 打包动作等用户确认后执行。

## 常用命令

```sh
npm run dev -w @triton/web      # planner 开发服务器 :5173
npm run build                    # 全 workspace 构建
npm test                         # 全 workspace vitest
node extension/build.mjs --watch # 扩展 watch 构建 → extension/dist
```
