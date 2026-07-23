# TritonPlan 宣传计划（全平台 · 面向 UCSD 学生）

> 2026-07-23 制定。目标：让 UCSD 学生在每个选课周期里自然地发现并使用 TritonPlan。
> 原则：真实（学生自制、不装官方）、省力（单人可执行）、蹭准时机（选课日历驱动一切节奏）。

---

## 0. 一句话定位与核心信息

**英文主 tagline（对外统一用这句）：**

> The WebReg-style calendar that TSS never shipped — see your week, catch conflicts, check finals. Free, open-source, nothing leaves your browser.

**三条核心信息（所有文案围绕它们展开，按优先级）：**

1. **痛点钩子**：老 WebReg 有周历排课，新 TSS 没有 → 我们把它做回来了（而且更好：finals 冲突检测、section 切换、分享链接）。
2. **零风险**：不碰你的账号、不发任何请求、服务器无法分辨你装没装 —— "The server can't tell you apart from any other student."
3. **零收集**：无后端、无账号、无统计埋点，plan 只在你自己的浏览器里。开源可查。

**一律不要说的话**：任何暗示 UCSD 官方/合作的表述；"永远不会被封"之类的绝对保证（说"零额外流量、被动只读"即可，让事实说话）。

---

## 1. 目标人群（按转化难度排序）

| 人群 | 规模/特点 | 打法 |
|---|---|---|
| **新生 & 转学生**（正在 orientation 选课） | 没用过 WebReg，但**正被 TSS 折磨**，7–8 月密集选课 | 立即触达：Reddit 新生帖、新生 Discord、小红书新生群 |
| **老生**（怀念 WebReg） | 对比落差最强烈，最容易共鸣转发 | Reddit 主帖用 "WebReg is gone, so I rebuilt its calendar" 叙事 |
| **中国留学生** | UCSD 国际生大头，小红书/微信选课攻略消费量极大 | 小红书图文 + 新生微信群转发（找群友帮转） |
| **CS/工科学生** | 会看 GitHub、在 ACM/CSES Discord 里活跃，天然早期用户+传播者 | 开源角度：架构、零封禁设计、"built with Claude Code" |

---

## 2. 时间窗口（一切节奏跟着选课日历走）

> 具体日期以 UCSD 官方 Enrollment/Academic Calendar 为准，下面是常年规律的近似值，执行前核对一次。

| 窗口 | 时间 | 动作 |
|---|---|---|
| **🔥 现在：新生 orientation 选课** | 7 月下旬–8 月 | 软启动 + 新生渠道首发（本计划第 4 节 Phase 1–2） |
| Week 0 / 开学周 | ~9 月下旬 | 第二波：add/drop 调课潮，Reddit/IG 再推一次 |
| **Winter 2027 第一轮选课** | ~11 月中 | **全年最大窗口**：全体在校生同时选课。主推日，提前一周备好素材 |
| Spring 2027 选课 | ~2 月中 | 复推（复用模板，换季更新文案） |
| Fall 2027 选课 | ~5 月中 | 复推 |

规律：**每个选课窗口前 3–5 天发帖效果最好**（大家开始研究课表但还没选完）。设日历提醒。

---

## 3. Phase 0 — 素材（硬前置，没有这些不要发任何帖）

当前 README 和商店 listing 的截图都是 TBD，这是第一优先级。

**必做（约半天）：**

1. **3 张核心截图**（1280×800，商店和 README 通用）：
   - ① 周历视图：5–6 门真实课程、有颜色区分、**故意留一处红色冲突高亮**（冲突检测是核心卖点，必须出现在首图）；
   - ② Finals 视图：列表 + finals week 日历，有一对冲突的期末考；
   - ③ TSS 页面上的 "+ TritonPlan" 按钮特写（体现"就在你平时选课的地方"）。
2. **1 个 15–30 秒演示 GIF/竖版视频**：TSS 点 "+ TritonPlan" → 跳到日历 → 出现冲突 → 切换 section 冲突消失。这一条素材通吃 Reddit / IG / TikTok / 小红书。
3. 截图注意：用真实但无个人信息的课表（TSS 页面截图注意遮挡姓名/PID）；统一 navy/gold 品牌色背景做封面图。

**顺手完成**：截图放进 `docs/screenshots/`，同步补 README 和 Chrome Web Store listing（商店有截图后自然转化率会明显提升，这本身就是渠道优化）。

---

## 4. 渠道计划（按 ROI 排序）

### 4.1 Reddit r/UCSD — 主战场（预期带来 60%+ 的量）

- **为什么**：UCSD 学生浓度最高的公共社区，对"学生自制免费工具"极其友好，尤其 TSS 抱怨帖常年热榜。
- **发什么**：一张冲突高亮的日历截图（或 GIF）+ 学生口吻讲故事。**用 image/video post 带正文**，不要发纯链接帖（会沉）。
- **何时**：本周内首发（蹭新生选课）；11 月 Winter 选课前再发一次进展帖（"更新了 XX 功能"是合理的二次曝光理由）。
- **怎么维护**：发帖后 2 小时内守评论区，逐条回复；置顶评论放两个链接（网站 + Chrome 商店）和一句 unofficial 声明。有人质疑安全性时，把"零请求、开源、response.clone() 被动读取"讲清楚——这个问题答好了就是免费广告。
- **注意**：遵守 subreddit 自我宣传规则（一般允许免费学生项目，但别短期内重复发）；账号最好有正常历史，不要用小号首发。

**首发帖草稿（可直接用）：**

> **Title:** TSS killed WebReg's calendar view, so I built it back — free planner extension for UCSD
>
> Like everyone else I got hit with the new Triton Student System this year, and the thing I missed most was WebReg's weekly calendar — actually *seeing* your schedule before you enroll.
>
> So I built **TritonPlan**: a Chrome/Edge extension + planner site. You browse the Schedule of Classes in TSS like normal, click "+ TritonPlan" on any section, and it lands on a Google-Calendar-style weekly view with:
>
> - automatic **time-conflict highlighting**
> - a **finals view** that catches overlapping final exams *before* you book
> - switching lecture/discussion combos right in the planner to clear a conflict
> - share-by-link so you can compare schedules with friends
>
> On the "is this safe" question, because I know that's the first thing I'd ask: the extension **never sends a single request to TSS**. It only reads the course data the TSS page already loaded in your own browser (literally `response.clone()`), so your traffic is byte-for-byte identical to normal browsing. No account, no backend, no analytics — your plan never leaves your device. It's fully open source if you want to check.
>
> Planner: <https://hfjddjksaj.github.io/tritonplan/>
> Chrome Web Store: <https://chromewebstore.google.com/detail/tritonplan/lnchlccmjhhpbbemlfnpldooeehcmjel>
> GitHub: <https://github.com/hfjddjksaj/tritonplan>
>
> Unofficial student-made tool, not affiliated with UCSD. Would love feedback — especially bug reports before winter enrollment.

### 4.2 Discord — 精准渗透（低成本高转化）

- **目标服务器**：UCSD 官方/最大综合服、**Class of 2030 新生服**（现在最活跃）、ACM at UCSD、CSES、各大 major 服。
- **打法**：不要进去就发广告。先找 `#course-planning` / `#tools` / `#resources` 类频道；有人问"怎么看课表/怎么排课/TSS 好难用"时回复推荐（软性、带截图）。ACM/CSES 这类技术社团可以直接在 showcase/projects 频道发，他们欢迎成员项目。
- **短文案模板（贴频道用）：**

> Made a free tool that gives TSS the weekly calendar WebReg used to have — conflict detection, finals overlap warnings, share your schedule by link. Read-only extension (zero requests to TSS, open source): https://hfjddjksaj.github.io/tritonplan/

### 4.3 小红书 + 微信 — 中国留学生线

- **小红书**：选课季"UCSD 选课攻略"类笔记流量很大。发一篇图文：封面图用"UCSD选课神器｜把 WebReg 的课表找回来了"大字封面，内页放日历截图 + finals 冲突截图 + 安装三步图。标签：`#UCSD` `#美国留学` `#选课` `#加州大学圣地亚哥分校`。11 月选课季再发一篇"Winter选课前必装"。
- **微信**：新生群/CSSA 群是转发型渠道——准备一张**单图卡片**（产品截图 + 二维码指向网站 + 一句话介绍），请群里认识的同学帮转。不刷屏，一个群一次。
- **小红书正文草稿：**

> UCSD 新系统 TSS 把老 WebReg 的周历排课砍了，选课全靠脑补时间表……
> 于是做了个免费工具 TritonPlan：在 TSS 里正常浏览课程，点一下 "+ TritonPlan"，课就落到 Google Calendar 式的周历上——
> ✅ 时间冲突自动标红
> ✅ Final 撞车提前预警（选课前就能看到！）
> ✅ 换 section 组合实时消解冲突
> ✅ 一条链接把课表分享给朋友拼课
> 完全免费开源，插件零请求纯只读（不碰你账号，流量和正常浏览一模一样），无后端无收集，课表只存在你自己浏览器里。
> 网站和安装方式见图 / 评论区🔗

### 4.4 Instagram / TikTok — 演示视频（有余力再做）

- 用 Phase 0 的 15–30 秒竖版演示视频直接发（配 trending audio + 字幕 "UCSD students: TSS deleted the schedule calendar so I rebuilt it"）。
- 更省力的路径：**投稿给 UCSD meme/资讯账号**（如 ucsdmemes 类账号、学生资讯号），DM 附视频，说明是免费学生项目求分享——他们缺内容，成功率不低。

### 4.5 校园线下 — 传单/贴纸（开学后）

- 一张 A6 卡片：日历截图 + "Your TSS schedule, as a calendar." + 二维码（指向网站，网站上有商店链接）。
- 投放点：Geisel、Price Center、CSE 楼、各 college 公告栏（注意各处张贴规定）。Week 0 和 11 月选课周各投一轮。
- 成本 ~$20–40，主要价值是选课周的"提醒物"。

### 4.6 校媒 — The UCSD Guardian / The Triton（免费大曝光，值得一封邮件）

- 学生报刊常年做 "TSS 过渡阵痛" 选题，"学生自己把缺失功能做回来了" 是现成的好故事。
- 发一封 pitch 邮件给 features/news 编辑：3 句话讲故事 + 截图 + 链接，表示可接受采访。成本 10 分钟，命中一次等于全校曝光。

### 4.7 Chrome Web Store ASO（被动流量，做一次管长期）

- 截图补齐（Phase 0）；
- Summary 里确保命中搜索词：`UCSD`、`TSS`、`Triton Student System`、`WebReg`、`schedule planner`（现有文案已覆盖，微调即可）；
- 引导前 10–20 个真实用户留 5 星评价（Reddit 帖里/README 里温和地请求一句"如果好用，商店里留个评价对新工具帮助很大"）。

### 4.8 GitHub / 技术社区（次要，人设加成）

- README 已很好，补截图即可。开源本身是信任背书，Reddit 评论区会有人真的去看代码。
- 可选：选课季过后发一篇 "how I built a zero-request passive extension for an SAP system" 到 HN/dev.to——不带来 UCSD 用户，但涨 star、涨可信度。

---

## 5. 发布节奏（Launch sequence）

**Phase 0（本周，~1 天）**：截图 ×3 + 演示 GIF/视频 → 补 README + 商店 listing。
**Phase 1 软启动（Phase 0 完成后 1–2 天）**：先发 Discord 小频道 + 让身边 3–5 个同学真实安装使用，收一轮 bug（尤其分享链接/扩展安装路径），确认 v0.1.1 审核通过。
**Phase 2 主发布（8 月第一周内，蹭新生选课）**：Reddit r/UCSD 主帖（工作日上午 9–11 点发）→ 当天小红书笔记 + 微信卡片 → 48 小时内守评论区快速修 bug、快速回复。
**Phase 3 常态化**：每个选课窗口前 3–5 天，Reddit 进展帖 + 小红书新笔记 + Discord 提一句 + 线下传单。每次用"新功能/新学期"作为再发理由，不做重复内容。

---

## 6. 风险与红线

1. **商标/官方观感**：坚持 "unofficial, student-made, not affiliated" 出现在所有 bio/置顶/传单角落。不使用 UCSD 校徽/官方 logo/吉祥物形象。（产品名含 "Triton"，目前保持低调姿态即可；若未来收到校方沟通，配合改名成本可控，不必现在自缚手脚。）
2. **安全性质疑**（一定会有）：统一口径 = 三点事实：零请求（只 clone 页面自己收到的响应）、零自动化（不代点任何 TSS 按钮）、零收集（无后端可查源码）。不用防御姿态，把质疑当展示机会。
3. **审核过渡期**：v0.1.1 商店审核通过前不做主推（旧版用户点 "open in TSS" 无响应会产生差评风险）。**主发布的前置条件 = v0.1.1 上架。**
4. **移动端体验**：小红书/IG 流量几乎全是手机，落地页在手机上首屏要能看懂。响应式适配（future-direction 方案 2③）建议排进主发布前;至少确保手机打开网站不乱版、并明示"需在电脑 Chrome/Edge 上配合 TSS 使用"。
5. **不过度承诺**：不保证"抢课更快"（本来也不做这个）、不说"官方数据"、不催任何人卸载官方工具。

---

## 7. 衡量（无埋点前提下能看什么）

产品零收集是卖点，不为了统计破坏它。可用的免费信号：

- **Chrome Web Store**：安装数/周活（开发者后台）——核心指标；
- **GitHub Insights**：Traffic（README 访问/来源）、Stars、Issues（真实用户反馈）；
- **各平台帖子本身**：Reddit upvote/评论、 小红书收藏（收藏≈"选课时要用"）；
- 目标参考（保守）：主发布后 2 周内 100+ 安装；Winter 选课季后 500+ 安装、r/UCSD 帖 200+ upvote。

每个选课季结束后花 15 分钟记录：哪条渠道带来最多安装（问新用户"从哪知道的"即可，Reddit 评论区自然能看出来），下一季加倍投入最有效的渠道。

---

## 8. 本周行动清单（TL;DR）

- [ ] 截 3 张核心截图 + 录 15–30 秒演示 GIF（Phase 0，半天）
- [ ] 补 README 截图 + Chrome Web Store listing 截图
- [ ] 确认 v0.1.1 审核状态（主发布前置条件）
- [ ] 手机打开网站过一遍首屏，至少不乱版
- [ ] 找 3–5 个同学软启动试用，收一轮 bug
- [ ] Reddit 主帖发布（用第 4.1 节草稿，工作日上午）
- [ ] 同日：小红书笔记 + 微信单图卡片
- [ ] 设日历提醒：11 月 Winter 选课前一周 = 全年最大推广窗口
