# 小红书首发笔记（可直接复制发布）

> 2026-07 制作。图片素材：本目录 `xiaohongshu/` 两张生成卡 + `docs/screenshots/` 产品图。
> Reddit 主帖等 v0.1.1 上架后再发（草稿见 `../marketing-plan.md` 4.1 节）。

## 图片顺序（5 张）

1. `xiaohongshu/xhs-cover.png` — 大字封面（3:4）
2. `../screenshots/calendar.png` — 周历冲突图
3. `xiaohongshu/xhs-steps.png` — 三步上手卡（3:4，内嵌 TSS 按钮实拍）
4. `../screenshots/finals.png` — Finals 撞车图
5. `../screenshots/building-popover.png` — 教学楼弹窗（彩蛋功能）

## 标题（≤20 字，选一）

- UCSD新系统没课表？我把它做回来了
- UCSD选课神器｜WebReg课表回来了
- 被TSS折磨的UCSD人 快用这个排课

## 正文

UCSD 新系统 TSS 把老 WebReg 的周历排课砍了，选课全靠脑补时间表，final 撞没撞车要自己翻着算……

于是我做了个免费工具 TritonPlan🔱：在 TSS 里正常浏览课程，点一下卡片上的 "+ TritonPlan"，课就落进 Google Calendar 式的周历——

✅ 时间冲突自动标红，一眼看见哪两门打架
✅ Final 撞车提前预警（选课前就知道！）
✅ 换 section 组合，冲突实时消解
✅ 一条链接把课表分享给朋友拼课
✅ 点教学楼名直接弹位置，跳 Google Maps

安全这块直接说清楚：插件是纯只读的，零请求、不碰你的账号、不代你点任何按钮，流量和正常浏览一模一样；没有后端没有账号体系，课表只存在你自己浏览器里。全部代码开源可查。

Chrome / Edge 都能用，商店搜 TritonPlan 或走评论区链接🔗

新生们 orientation 选课前装上，秋季课表提前排明白；老生们 11 月 Winter 选课见真章。

（UCSD 学生自制，非官方工具，有 bug 评论区喊我）

## 标签

#UCSD #加州大学圣地亚哥分校 #美国留学 #选课 #留学生生活 #新生攻略 #美本 #ucsd选课

## 发布后动作

1. **第一条评论**（发布后立刻，自己顶起来）——**安装直链放第一位**，这是产品唯一的安装入口；GitHub 只是开源背书，放最后：
   > 📥 扩展安装（电脑 Chrome/Edge 打开）：
   > chromewebstore.google.com/detail/tritonplan/lnchlccmjhhpbbemlfnpldooeehcmjel
   > 📅 排课网站：hfjddjksaj.github.io/tritonplan
   > 🔍 代码开源可查：github.com/hfjddjksaj/tritonplan
   >
   > 手机刷到的宝子先收藏，回电脑上装～商店直接搜 TritonPlan 也能找到（唯一结果）
2. 24 小时内盯评论区：问安全性 → 用"零请求/开源/无账号"三点事实回；报 bug → 快修快回。
3. 数据参考：收藏 > 点赞 说明选对了人群（收藏 = 选课时要用）。

## 注意

- 正文不放可点击外链（小红书限制），链接全放评论区。
- GIF 在图文笔记会变静图，暂不用；后续可把 section-switch 做成视频笔记二发。
