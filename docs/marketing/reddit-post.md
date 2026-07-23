# Reddit r/UCSD 首发帖（发布包）

> 2026-07-23 制作。前置条件已满足：商店已确认 v0.1.1（Updated July 23, 2026）。
> 图片素材用 `docs/screenshots/`（Reddit 允许外链，和小红书规则完全相反）。

## 平台规则要点（2026-07 核查）

Reddit 站规允许开发者发自己的项目，但有明确红线：

- **透明披露**：必须说明"我是开发者"。Reddit 文化里 "Full disclosure: I built this" 加分不减分；藏着掖着被扒出来就是死刑。
- **价值优先，非引流**：站规禁止"primarily for the purpose of driving traffic"。帖子本身要是完整有用的内容（工具介绍 + 截图 + 原理），链接只是附带。
- **90/10 惯例**：账号活动不能只有自我宣传。**用你的常用账号发**，别用新注册小号——新号发推广帖是被删和被喷的头号原因。如果账号平时不逛 r/UCSD，发帖前几天先正常评论几条。
- **禁止多版同发**：只发 r/UCSD 这一个 sub。绝不同日横扫 r/college、r/SanDiego 之类——机器判定 coordinated spam。
- **版规自查（发帖前 60 秒，机器访问被 Reddit 拦截，需人工确认）**：打开 r/UCSD 侧栏 Rules，确认两点——①有没有"self-promotion 需 mod 批准"类条款；②发帖是否要求选 flair（有就选 Discussion/General 类）。大学 sub 通常欢迎免费学生项目、只管制商业广告和问卷，但要亲眼确认。
- 若版规要求预批，先发 modmail（模板在文末），批了再发。

## 发帖形态与时机

- **形态**：图片帖（gallery）+ 正文。图 3 张，顺序：① calendar.png（冲突标红主图）② finals.png ③ tss-button.png。GIF 别放主帖（Reddit gallery 不收 GIF），置顶评论里补动图链接或干脆不用。
- **时机**：工作日上午 9–11 点（太平洋时间）。避开周五晚和周末白天。
- **标题**（选一，不要句号结尾）：
  1. `TSS killed WebReg's calendar view, so I built it back — free planner extension for UCSD`
  2. `WebReg's weekly schedule calendar is gone in TSS, so I rebuilt it (free, open source)`

## 正文（可直接粘贴）

```markdown
Like everyone else I got hit with the new Triton Student System this year, and the thing I missed most from WebReg was the weekly calendar — actually *seeing* your schedule before you enroll.

So I built **TritonPlan** (full disclosure: I'm the dev, it's free and open source). It's a Chrome/Edge extension + a planner site. You browse the Schedule of Classes in TSS like normal, click the "+ TritonPlan" button that appears on any section card, and the course lands on a Google-Calendar-style weekly view with:

- automatic **time-conflict highlighting** (see the red blocks in the first screenshot)
- a **Finals view** that catches overlapping final exams *before* you book
- switching lecture/discussion/lab combos right in the planner to clear a conflict
- share-your-schedule links so you can plan with friends
- click a building name → pops its location with a Google Maps link

On the "is this safe / will I get in trouble" question, because it's the first thing I'd ask: the extension **never sends a single request to TSS**. It only reads the course data the TSS page already loaded in your own browser (literally `response.clone()` on the page's own fetch), so your traffic is byte-for-byte identical to normal browsing. It never clicks or books anything for you. No account, no backend, no analytics — your plan lives in your browser and nowhere else. Code is fully open source if you want to check any of this.

Install (Chrome Web Store, works on Edge too): https://chromewebstore.google.com/detail/tritonplan/lnchlccmjhhpbbemlfnpldooeehcmjel
Planner: https://hfjddjksaj.github.io/tritonplan/
Source: https://github.com/hfjddjksaj/tritonplan

Unofficial student-made tool, not affiliated with UCSD. It shipped this week, so if you hit a bug, comment here or open a GitHub issue and I'll fix it fast — would love to have it solid before winter enrollment.
```

## 发布后动作

1. **发帖后 2 小时守评论区**，逐条回复。Reddit 前 2 小时的互动决定帖子命运。
2. **不用自己发置顶楼**（链接已在正文）。第一条自评留给补充信息，有人问细节再展开，别抢答没人问的问题。
3. 常见问题的回复口径（提前备好，别现场措辞）：
   - **"How do I know it's not stealing my data?"** → 三点事实：zero requests（只 clone 页面自己收到的响应）、no automation（不代点任何按钮）、no backend（无处可传）。附一句 "the whole capture path is ~200 lines in `extension/src/`, easiest place to start reading"——给出可验证的入口比说"相信我"有力。
   - **"Is this against UCSD policy?"** → 不替校方背书，讲事实："It doesn't automate anything or generate any traffic TSS wouldn't see from normal browsing. That said it's unofficial — read the code and judge for yourself."
   - **"Why not just use [某现有工具]?"** → 不贬低对方，讲差异：其他工具基本是老系统时代的；TritonPlan 是为 TSS 的 OData 做的，且有 finals 冲突检测。
   - **Bug 报告** → 感谢 + 要复现步骤 + 修好后回来在原评论下回复"fixed in vX.X.X"。这是最好的公开广告。
4. **好评引导只做一次**：帖子热度起来后（>50 upvote），在自己某条高赞回复末尾带一句 "if it's useful, a review on the Web Store helps a lot with discoverability" ——只此一处，不刷屏。
5. 帖子沉了就沉了，**两周内不重发**。下一次 r/UCSD 曝光 = 11 月 Winter 选课前的进展帖（新功能/修复列表作为再发理由）。

## Modmail 模板（仅当版规要求 self-promo 预批时用）

```
Subject: Asking before posting — free student-made schedule tool for TSS

Hi mods, I'm a student and I built a free, open-source browser extension that
brings back WebReg-style weekly calendar planning for the new TSS (conflict
detection, finals overlap warnings). No ads, no accounts, no data collection.
I'd like to share it with the sub — happy to follow whatever format or flair
you prefer. Thanks!
```

## 与小红书的规则差异备忘

| | 小红书 | Reddit |
|---|---|---|
| 链接 | 任何场景零 URL | 正文直接放，藏链接反而可疑 |
| 身份 | 学生自制人设即可 | 必须明说 "I'm the dev" |
| 二次曝光 | 可高频发新笔记 | 同内容两周内不重发，重发要有新东西 |
| 评论区 | 平台审文本 | 社区审动机——真诚互动是唯一护身符 |
