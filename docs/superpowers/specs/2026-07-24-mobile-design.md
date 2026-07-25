# TritonPlan 移动端适配 · 设计文档

> 2026-07-24 与用户逐节确认通过（mockup 选型 + 终端问答）。实现计划另见同目录 plan 文档。

## 背景与范围

手机浏览器不支持 MV3 扩展（平台限制，无解），所以 TSS 侧的 sort / "+ TritonPlan" 按钮在手机上永远不存在。移动端的价值全部在 web planner：**电脑排课 → 传到手机 → 手机上看+改**。现状 `app.css` 仅末尾 25 行响应式，手机上排版不可用。

本轮 = future-direction.md "方案 2 三件套"的落地 + 分享格式升级：

1. 全面响应式（手机专属骨架）
2. Share 出二维码（纯前端生成）
3. plan 变动自动同步地址栏 URL
4. 新增 v3 完整版分享格式（全量 section 数据，deflate 压缩）

**纯 web 改动，扩展零改动，无需商店发版，push 即上线。**

明确不做（挂起，见 future-direction.md 方案 3）：短链接 / 云同步 / 任何后端。短码必然要服务器存数据，打破"零收集、无后端"承诺；QR 已覆盖"传到手机"场景。

## 已确认的用户决策

| 决策点 | 结论 |
|---|---|
| 范围 | 三件套全做 + v3 格式 |
| 手机功能深度 | 完整功能（看+编辑），不做阅读专用模式 |
| 日历形态 | A 整周挤压式（默认） + B 横滚式，顶栏按钮切换 |
| 整体结构 | 底部 Tab 栏：Courses \| Calendar \| Finals（默认落 Calendar） |
| 手机新建空 plan | 隐藏（手机无扩展，空 plan 无意义）；Save received as new plan 保留 |
| 分享格式 | 链接和 QR 统一支持 Full（默认）/ Lite 切换；Full 用新 v3 编码 |
| Export as JSON | UI 暂时下线（代码注释保留）；Import 的 Upload JSON 保留 |
| UI 命名 | Full（完整版）/ Lite（简略版），界面文案英文 |

## 1. 手机端骨架（≤760px）

- 底部 Tab 栏三页签 **Courses | Calendar | Finals**，打开默认 **Calendar**。
- Tab 栏加 `env(safe-area-inset-bottom)`；app 壳高度用 `dvh`（iOS 地址栏收缩的 100vh 坑）。
- 顶栏收窄：品牌 + PlanSwitcher + Share/Import。**"+ New plan" 行在手机上隐藏**；切换/改名/复制/删除保留。桌面 hover 才出现的行内按钮在手机常显。
- 冲突横幅、received 只读横幅宽度自适应，全部功能保留。
- 桌面（>760px）布局不动，只共享第 4 节的 Share 菜单重构。

## 2. 日历双形态

**A 整周挤压式（默认）**
- Mon–Fri 全塞进屏宽（列逻辑与桌面一致），块内只放课程代码（高度够再加类型标签）。
- **点块弹详情卡**：完整时间/地点/教师/冲突原因 + 三动作：Open in TSS、教学楼位置（复用 BuildingPopover）、"去课程卡"（切 Courses 页签 + 复用 focusNonce 闪光定位）。

**B 横滚式**
- 列宽约 44vw（一屏约 2.3 天），块内信息同桌面，横向滚动 + scroll-snap 按天吸附，进入自动滚到今天。

**通用**
- 切换按钮在顶栏（PlanSwitcher 同款位置），仅 Calendar 页签显示；状态存 localStorage；默认 A。
- 金色当前时间线两种形态都画。
- 在 Courses 页切 section / 删课后，Calendar 页签短暂金色脉冲（不自动跳转）。

## 3. Courses / Finals 页签

- Courses：课程卡全宽单列，现有功能全保留（切 section、删课、prereq、book section、seats 时间戳）。触屏无 hover/tooltip——关键提示改可见文字或点击展开。
- Finals：列表 + finals 周历上下堆叠。

## 4. Share / Import 重构（桌面手机同款）

- Share ▾ 两项：**Copy link**、**QR code**；Export as JSON 注释下线。
- 菜单顶部格式切换 **Full（默认）/ Lite**，小字注释：
  - Full — "all sections included — editable on the other device"
  - Lite — "selected sections only — smaller, view-only"
- 切换同时作用于 Copy link 与 QR。Share/QR 作用于**当前查看的 plan**（现行规则不变，received 视图下分享的是收到的 plan）。
- QR 纯前端本地生成（bundle 内小库，零外部请求）。容量兜底：
  - Full 超容量（约 >8 门课）→ 自动降级 Lite 码 + 标注 "This code carries the Lite version — use Copy link for the full plan"
  - Lite 也超（罕见）→ 提示改用 Copy link
- Import 菜单不变（Upload JSON + Paste link）。

## 5. v3 完整版分享格式

- 编码管线：紧凑 JSON → **deflate**（fflate，约 8KB、零传递依赖、同步 API）→ base64url，token 前缀 `3~`。
  - 不用原生 CompressionStream：强制异步会把同步的 plan 载入路径搅成异步重构，且有老 iOS 兼容问题。
- 紧凑 JSON：每门课 components 去重成表，options 按索引引用；短键名 + 位置数组。
- 内容：全部 section options（时间/地点/教师/座位/limit/final）+ prereqs + capturedAt——手机上 prereq 徽章与 "seats Xh ago" 可用。
- 实测尺寸（合成真实密度数据，QR byte 上限 2953）：
  - 3 门课全量 ≈ 1.4K ✅ / 5 门课 ≈ 1.9K ✅ / 8 门课 ≈ 2.6K ✅（老全量 JSON+lz-string 是 14.3K）
  - 对照：现行 Lite（lz-string）5 门课 1.9K——v3 全量 ≈ 现行 Lite 大小
- 解码顺序：`3~` v3 → v2 slim → v1 legacy；**所有旧链接永久可开**。Lite（v2）编码器保留（Lite 选项 + QR 降级用）。
- 打开链接语义不变：进 received 只读槽 → Save as a new plan 后可编辑/切 section。

## 6. 自动 URL 同步

- 活跃 plan 每次变动 `replaceState` 写 `#p=<v3 full token>` —— 浏览器"发送到设备"/书签同步送出的永远是最新版。
- **回声检测**（防重蹈 2026-07-23 数据丢失 bug）：每次自动写入把 token 记入 sessionStorage；载入时地址栏 token 与记录一致 = 自己的回声，静默清除不走 received；不一致 = 真外来 plan，照常一次性消费。顺序：先消费/清哈希，再开启自动写入。

## 7. 测试与验证

- 单测：v3 编解码往返；尺寸预算断言（5 门课 < 2.9K）;QR 降级纯函数；回声检测；挤压布局纯函数。
- E2E（puppeteer 390×844）：三页签、双日历形态、点块详情、QR 弹层（解码 QR 图反查 token）、自动同步 + 刷新持久、旧链接兼容。
- 回归：现有 141 测试 + typecheck + 双生产构建。

## 风险与备注

- fflate 是新增运行时依赖（约 +8KB gzip 后更小）；QR 生成库同为 bundle 内本地依赖——均无网络请求，不动 CSP/隐私文案。
- v3 上线即改默认分享格式；发出去的 v3 链接要求接收方 web 已部署 v3 解码——web 先上线即可（同一站点，无版本错配窗口）。
- 高密度 QR（V35+）在暗屏/低亮度下扫码成功率下降；QR 弹层建议白底大尺寸渲染。
- localStorage 体积随多 plan 增长的既有待办不受本轮影响。
