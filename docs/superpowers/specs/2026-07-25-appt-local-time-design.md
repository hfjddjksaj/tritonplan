# Appointment Times · 弹层本地时间行 · 设计文档（追加小功能）

> 2026-07-25 用户问答确认：本地时间**只在弹层**显示（胶囊保持 PT 不变），且仅当设备时区 ≠
> `America/Los_Angeles` 时出现。母功能 spec：`2026-07-25-appt-times-design.md`。

## 需求

弹层里每个选课窗口现有 PT 时间行（`8/10 2:00 PM – 8/13 10:59 PM PT`）下方，追加一行
设备本地时间小字：`Your time · 8/11 5:00 AM – 8/14 1:59 PM GMT+8`。人在太平洋时区
（或时区取不到）时该行整体不渲染，弹层与现状完全一致。

## 实现

- **`web/src/lib/appt.ts`** 三个纯函数：
  - `deviceZone(): string | null` — `Intl.DateTimeFormat().resolvedOptions().timeZone`，
    异常/缺失返回 null（老浏览器安全隐藏）。
  - `localZoneIfNotPacific(zone: string | null): string | null` — zone 为空或等于
    `America/Los_Angeles` → null（= 不显示）。
  - `formatApptRangeInZone(beginsAt, endsAt, zone): string` — 输出
    `8/11 5:00 AM – 8/14 1:59 PM GMT+8`：日期/时间格式与现有 PT 行一致（en-US、
    M/D、h:mm AM/PM），末尾时区标注取 Intl `timeZoneName: 'shortOffset'`（如
    `GMT+8`，DST 由 Intl 自动处理）。zone 显式传参，测试可断言精确字符串；
    无效 zone / 无效时间戳返回 `''`（调用方跳过渲染）。
- **`web/src/components/ApptPopover.tsx`**：组件顶部取一次
  `localZoneIfNotPacific(deviceZone())`；每个窗口在 PT 行后条件渲染
  `<div className="apptpop__times apptpop__times--local mono">Your time · {…}</div>`
  （formatApptRangeInZone 返回空串时同样跳过）。
- **CSS**（`app.css`）：`.apptpop__times--local` 小一号、淡色（opacity ~0.65）。
- 胶囊、footer 提示（"Times shown in Pacific Time, as in TSS."）均不动——PT 仍是主显示。

## 测试

- `formatApptRangeInZone`：`Asia/Shanghai`（+8，跨日）与 `America/New_York`
  （EDT，-4）断言精确字符串；无效 zone → `''`；无效 ISO → `''`。
- `localZoneIfNotPacific`：`America/Los_Angeles` → null、null → null、其他 zone 原样返回。
- 弹层渲染行为由现有 E2E 通道抽查（设备时区非 PT 的本机直接可见）。

## 范围

纯 web、零扩展改动；不触及隐私/分享边界；push 即生效。
