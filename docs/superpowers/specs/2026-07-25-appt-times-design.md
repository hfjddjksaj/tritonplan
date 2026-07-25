# TritonPlan 选课时间（Appointment Times）· 设计文档

> 2026-07-25 与用户问答确认（UI 位置 / 显示行为 / 隐私边界），同日完成登录态实机逆向。
> 数据源笔记：`docs/tss-recon/tss-api-notes.md` "Service: ysd_appttimes" 节；
> fixture：`docs/tss-recon/fixtures/appt-times-fall2026.json`（PII 已脱敏）。

## 背景与范围

TSS 首页有 "My Appointment Times" tile（Schedule of Classes 下方），点开显示本人各选课
窗口（First Pass / Second Pass / Instruction Session Enrollment 卡片，含 Opens / Closes /
Unit Cap / Waitlists）。学生排课时最关心"我什么时候能选"，本轮把这份数据带进 planner
顶栏，一眼可见。

数据通路：该 app 打开时自己发 `$batch` POST 到独立 OData v4 服务
`/sap/opu/odata4/sap/ysb_appttime/srvd/sap/ysd_appttimes/0001/`——URL 含 `/odata`，
**现有拦截器已经收到这些字节**，只是 `classifyCapture` 不认识就丢了。本轮 = 教会分类器
认它 + 存储 + 推送 + 顶栏展示。**零新增请求，NO-BAN 红线不动。**

## 已确认的用户决策

| 决策点 | 结论 |
|---|---|
| UI 位置 | 顶栏常驻胶囊，点开弹层看全部窗口 |
| 显示行为 | 状态感知：自动挑下一个窗口；开放中金色高亮；全过则淡化；无倒计时 |
| 隐私边界 | 完全私有：不进 plan / 分享链接 / QR / 导出；只存本地 + 扩展推送 |
| 数据获取 | 方案 A：被动捕获 + 扩展侧规范化（PII 入库前剥离） |

## 实测数据要点（设计依据）

- 窗口数量**可变**：本次实测 4 个——First Pass、**两个** Second Pass（不同日期段）、
  Instruction Session Enrollment。绝不硬编码"first + second 两个"。
- 每窗口有 `timelimit_Text`（显示名）、`beginTimestamp`/`endTimestamp`（**UTC 权威时刻**）、
  `waitlists`（现成文案）；Unit Cap 要按 (`Perid`=session, `Timelimit`) join 旁边的
  `maxUnits[]` 查表得到。
- `timelimitStatus` 只实测过 `'U'`（Upcoming），metadata 无枚举 → **状态一律由时间戳算**，
  不信任该字段。
- `apptPeriods` 行含 `studentNumber` / `studentObjid` / `studyObjid` / `programObjid` 等
  PII——**规范化时丢弃，任何一层都不落盘**。
- 学年/学期代码与课程数据同源（Fall = `'2'`）；数据按 (学年, 学期) 一份。

## 1. shared 模型（`shared/src/types.ts` 新增，现有类型不动）

```ts
/** One enrollment window ("First Pass", "Second Pass", …) for the student. */
export interface ApptWindow {
  label: string;      // timelimit_Text verbatim, e.g. "First Pass"
  beginsAt: string;   // UTC ISO instant (from beginTimestamp)
  endsAt: string;     // UTC ISO instant (from endTimestamp)
  unitCap?: string;   // joined from maxUnits, e.g. "11.50" (absent if no table row)
  waitlists?: string; // "Allowed" | "Not Allowed" (verbatim; absent if empty)
}

/** The student's appointment times for one (academic year, session). */
export interface ApptTimes {
  academicYear: string;    // "2026"
  academicSession: string; // "2"
  yearText: string;        // "2026/2027"
  sessionText: string;     // "Fall Quarter"
  windows: ApptWindow[];   // sorted by beginsAt ascending
  capturedAt: string;      // ISO, when the extension captured it
}
```

## 2. extension（需发版；版本号照惯例打包时定）

- **`lib/extract-odata.ts`**：第四类集合——批内嵌入 JSON 的 `@odata.context` 匹配
  `#apptPeriods(`（服务 URL 含 `ysb_appttime` 作旁证）即 appointment 数据；取
  `value[0]` 的 `appointmentTimes[]` + `maxUnits[]` + 学年/学期字段。空 `value` 防御性忽略。
- **`lib/normalize.ts`**：新纯函数 `apptPeriodsToApptTimes(row, capturedAt)` →
  `ApptTimes`。字段映射 + maxUnits join + 按 `beginsAt` 排序；**白名单式只取所需字段**，
  PII 与未知字段一概不带出（fixture 驱动测试断言产物里无 `studentNumber` 等键）。
- **`CaptureStore`**：新增 `apptTimes: Record<"<year>|<session>", ApptTimes>`；同学期
  新捕获整体替换（用户重开 tile = 刷新）；serialize/deserialize 兼容旧存储（缺字段
  视为空，同 capturedAt/prereqs 先例）。
- **推送**：`config.ts` `MSG` 注册表加 `GET_APPT_TIMES`；`planner-bridge.ts` 在现有
  GET_COURSES 旁多拉一次，向页面 post 新消息 `type: 'appt-times'`（payload =
  `ApptTimes[]`，通常 1 项，多学期捕获则多项）。SW 现有的防抖 FLUSH 通路不改动即
  自动生效——TSS 里重开 tile，旁边开着的 planner 实时跳变。
- **NO-BAN**：只新增对已捕获响应的分类，无任何新请求/点击。

## 3. web

- **`lib/bridge.ts`**：`appt-times` 消息校验器（source/origin 校验同 courses）+
  `BridgeHandlers.onApptTimes`。
- **存储**：新 slot `triton-planner:appt:v1`（`ApptTimes[]`）。全局数据——不属于任何
  plan、不进 `PlanState`、不进分享链接 / QR / JSON 导出；received 只读视图下照常显示
  （它本来就不是 plan 的一部分）。
- **新 hook `useApptTimes`**（独立于 usePlan）：状态 + localStorage 持久化 + 接收
  bridge 推送；导出当前展示学期（挑选规则：有未结束窗口的学期优先，都结束则取
  capturedAt 最新的）。
- **顶栏 `ApptCapsule` + 弹层**：
  - 胶囊文案 = 下一个未结束窗口：`"First Pass · 8/10 2:00 PM PT"`；
    该窗口开放中 → 金色高亮样式 + `"First Pass · open now"`；
    全部结束 → 淡化显示 `"Enrollment ended"`；
    **无数据 → 胶囊整个不渲染**（旧扩展 / 没点过 tile / 无扩展用户零噪音）。
  - 点开弹层（portal 挂 body——固定包含块老坑；复用 `useEscapeKey` + `useClickAway`）：
    学期标题（`Fall Quarter 2026/2027`）+ 全部窗口平铺：名称、Opens → Closes、
    Unit Cap、Waitlists、状态徽章（Upcoming / Open now / Ended，时间戳算）。
    底部注脚：`Captured Xh ago — reopen "My Appointment Times" in TSS to refresh`
    （复用 `relativeTime` + 每分钟 tick，状态跨界也靠 tick 自然翻转）。
  - **时间格式化一律 `America/Los_Angeles` 并标注 "PT"**（与 TSS 显示一致，人在
    外地/换时区设备也不错乱）。
  - 移动端（≤760px）：胶囊收窄为钟形图标 + 短日期（如 `⏰ 8/10`），弹层同款全宽。
- **不做**（YAGNI）：倒计时、通知/提醒、把窗口画到日历上（未来日期 vs 周历语义不符，
  已在问答中否决）、多学期切换 UI（挑选规则自动处理；弹层只显示一个学期）。

## 4. 边界与错误处理

- 扩展未升级 / 从未点过 tile → 无推送 → 无胶囊，planner 其余功能零影响。
- 同学期重复捕获 → 整体替换；不同学期 → 并存，展示挑选规则兜底。
- `maxUnits` 查不到对应行 → `unitCap` 缺省，弹层该字段留空不显示。
- 空 `appointmentTimes[]`（理论可能，未实测）→ 存但胶囊按"无数据"处理不渲染。
- 时钟边界：`now ∈ [beginsAt, endsAt]` 判开放，闭区间，毫秒级比较 UTC 时间戳。

## 5. 测试

- **extension**（fixture 驱动）：分类器认出 apptPeriods 批文；normalize join /
  排序 / **PII 剥离断言**；CaptureStore 存取 + 旧存储反序列化兼容；GET_APPT_TIMES 通路。
- **web**：bridge 校验器（伪造消息拒收）；storage slot 读写；状态计算边界
  （开始瞬间 = 开放、结束后 1ms = 结束）；展示学期挑选规则；PT 格式化；
  胶囊三态渲染（下一个 / open now / 全结束）+ 无数据不渲染。
- **E2E**（puppeteer，模拟 bridge 推送 fixture 数据）：胶囊出现 → 点开弹层四窗口
  逐项核对 → 无数据时胶囊消失。

## 6. 发版切分

- **web 先上线**：无数据不渲染，对现有用户零副作用。
- **扩展归下一版**：发版后老用户升级 + 刷新已开 TSS 页（孤儿 content script 惯例），
  再点一次 "My Appointment Times" tile 数据即达 planner。
