-- ============================================================
-- Arthur 工作室 · 公告迁移：把 data/notices.json 的 10 条公告搬进 Supabase
-- 文件 12 / 12（在 11_admin_notices_stats.sql 之后执行，只需执行一次）
--
-- 用法：Supabase 控制台 → SQL Editor → 整段粘贴 → Run
-- 特点：可重复执行（on conflict (id) do nothing，已存在的条目不覆盖，
--       所以执行过一次后，即使你在后台改过某条，再跑也不会被冲掉）
--
-- 说明：
--   · 本文件只迁移 items；公告页顶部那条金色「更新计划说明」alert
--     仍由 data/notices.json 维护（低频、常驻，后台暂不管理）。
--   · 执行后 notices 表有数据，前端 notices.js 会自动切到 Supabase，
--     data/notices.json 退为兜底。之后改公告请用站长后台。
-- ============================================================

insert into public.notices (id, date, tags, pin, hidden, title, body) values
('notice-silverdaw-hanhua', '2026-11-08', '["版本发布"]'::jsonb, true, false,
 'Silverdaw 中文汉化正式上线',
 '["Silverdaw 中文本地化工作已完成，即日起正式发布。本次提供两种形式，二者对应的官方基准版本不同，请按需选用。",
   "完整汉化版以官方 1.9.0 版本为基准制作，中文语言资源已随包内置，安装完成后界面即为中文，无需再打补丁或改动配置，适合希望直接上手的使用者。",
   "汉化补丁以官方 1.10.0 版本为基准制作，仅适配该基准版本。补丁不含安装程序，需借助编程工具按随附说明手动替换文件，适合已在使用 1.10.0 原版、并希望保留原版安装方式的使用者；该补丁后续不再随官方版本更新。",
   "两种形式的基准版本不同，下载前请先确认所持原版的版本号，避免版本错配。下载入口位于 <a href=\"silverdaw.html\">Silverdaw 项目页</a>，各下载方式均需在弹窗中确认后跳转。"]'::jsonb)
on conflict (id) do nothing;

insert into public.notices (id, date, tags, pin, hidden, title, body) values
('notice-prism', '2026-11-11', '["版本发布"]'::jsonb, false, false,
 'Prism 中文汉化已发布（0.4.0-beta）',
 '["Prism 中文汉化版已发布，首发版本 0.4.0-beta，对应上游同一版本号。下载提供安装包与便携版两种形式，两者的界面与功能完全一致，只是打包方式不同，按使用习惯选其一即可。",
   "安装包为 .exe 程序，双击安装并自动创建开始菜单项与卸载项，适合固定在一台机器上长期使用；便携版解压即用，不写入系统、不留安装记录，可放入 U 盘随身携带。两者目前均为 Windows 版本，下载入口集中在 <a href=\"prism.html#get\">Prism 项目页</a>。",
   "本次汉化覆盖桌面版的界面文本与说明，参数术语按首次出现的英文名对照确定，例如 Spectrum Analyzer 译为频谱仪、Waterfall 译为瀑布图、Loudness Meter 译为响度表，同一功能在插件版与终端界面里沿用同一套译名。首发版本仍会跟进上游更新，若发现译文错漏或界面显示异常，可通过首页「关于」里的邮箱反馈。"]'::jsonb)
on conflict (id) do nothing;

insert into public.notices (id, date, tags, pin, hidden, title, body) values
('notice-softlib', '2026-11-10', '["界面更新"]'::jsonb, false, false,
 '软件库上线：18 个开源工具按用途分类',
 '["新增独立页面 <a href=\"softlib.html\">软件库</a>，将常用开源工具按系统工具、影音与图像、网络与传输、文档与效率四类整理为方格卡片，每项标注一句用途、许可协议与官方来源，点击卡片即前往项目官网或仓库。",
   "页面顶部提供分类筛选，换新设备或重装系统时可照着逐项配置。开源软件的汉化条目仍在整理，后续补充会在这里同步。入口位于首页「软件库」一节，也可从顶部导航直接进入。"]'::jsonb)
on conflict (id) do nothing;

insert into public.notices (id, date, tags, pin, hidden, title, body) values
('notice-silverdaw-ui', '2026-11-10', '["界面更新"]'::jsonb, false, false,
 'Silverdaw 项目页改版：新增返回入口、统一内容区宽度、修复弹窗位移',
 '["本次对 <a href=\"silverdaw.html\">Silverdaw 项目页</a> 做了三处调整。一是补充返回首页的入口：项目页有一处在产品主视觉左上角、一处在章节导航最左端，向下滚动时保持可见；公告页顶部同样补了一处。二是将「汉化覆盖」「获取方式」「规格」「关于原版」四个区块收进与「功能」一节相同的版心，宽屏下不再贴边。三是修复打开下载弹窗时整页横向抽动的问题。",
   "全站文案同步改为书面表达，下载资源、文件命名与基准版本均未变动。"]'::jsonb)
on conflict (id) do nothing;

insert into public.notices (id, date, tags, pin, hidden, title, body) values
('notice-mergelist', '2026-11-10', '["界面更新"]'::jsonb, false, false,
 '项目列表并入首页，不再分「已完成 / 正在进行 / 正在准备」',
 '["此前首页与单独的项目页各自维护一份清单，两处信息容易出现差异。现将项目统一收进首页的「汉化」一节：已发布的项目排在最前，未发布的项目标注预计推出时间；其余尚未上线的内容归入「软件库」一节，以一条说明交代当前进度。",
   "状态分组一并取消。相较开发进度，访客更关心当前是否可以下载，因此仅保留时间信息：已发布项目标注月份，未发布项目标注预计推出时间。旧的项目页链接将自动跳转至首页，已收藏的地址照常可用。"]'::jsonb)
on conflict (id) do nothing;

insert into public.notices (id, date, tags, pin, hidden, title, body) values
('notice-theme', '2026-11-09', '["界面更新"]'::jsonb, false, false,
 '全站配色更新：改为与 logo 一致的黑金主题',
 '["本次将全站配色由原先的蓝黑调整为与 logo 同源的黑金：底色改为中性黑，链接与按钮统一为金色系，主按钮采用金色底配深色文字。",
   "下载入口与全部文件均未变动，已保存的链接照常可用。停更提示与下载异常等警示仍保留原来的黄色，以便与普通链接区分；若发现某处颜色不协调或文字不易辨认，可在 <a href=\"index.html#about\">关于</a> 页找到联系方式反馈。"]'::jsonb)
on conflict (id) do nothing;

insert into public.notices (id, date, tags, pin, hidden, title, body) values
('notice-tools', '2026-11-08', '["项目预告"]'::jsonb, false, false,
 '开源电脑工具整合即将推出',
 '["计划将常用开源 Windows 工具整理为一份清单：按用途分类，逐项列明来源、安装方式与推荐设置，便于在新设备或重装系统后按序配置。整理完成后将在 <a href=\"index.html\">首页</a> 公布。"]'::jsonb)
on conflict (id) do nothing;

insert into public.notices (id, date, tags, pin, hidden, title, body) values
('notice-hanhua-index', '2026-11-08', '["项目预告"]'::jsonb, false, false,
 '开源软件汉化索引即将推出',
 '["计划收录常用开源软件的官方中文版本与可用汉化资源，逐项标注版本号、授权方式与下载位置，使中文界面的获取不必再依赖零散的论坛帖。整理完成后将在 <a href=\"index.html\">首页</a> 公布。"]'::jsonb)
on conflict (id) do nothing;

insert into public.notices (id, date, tags, pin, hidden, title, body) values
('notice-download-method', '2026-11-08', '["服务调整"]'::jsonb, false, false,
 '下载方式调整：云盘分享页改为独立云存储直链',
 '["为提升下载体验，本站已于今日将 Silverdaw 的全部下载资源由第三方云盘分享页迁移至独立云存储空间。安装包、便携版、汉化补丁与使用说明现均以直链形式提供，不再经由云盘分享页面中转。",
   "此前通过云盘分享页获取文件，需先打开分享页面、再输入提取码，过程中还可能受到限速与页面跳转的影响。改为直链后，在下载弹窗中确认即可直接开始下载，无需提取码，也不受云盘限速与页面广告干扰。",
   "下载入口位置不变，仍位于 <a href=\"silverdaw.html\">Silverdaw 项目页</a>。原有云盘链接自即日起停用，仍在使用旧链接的请重新从项目页获取。如遇下载异常，可稍后重试，并留意本栏目后续说明。"]'::jsonb)
on conflict (id) do nothing;

insert into public.notices (id, date, tags, pin, hidden, title, body) values
('notice-start', '2026-11-02', '["站点公告"]'::jsonb, false, false,
 '关于启用公告栏的通知',
 '["为便于信息集中发布，本站即日起启用公告栏。此后版本更新、发布说明与临时维护通知均通过本栏目统一发布，不再于各项目页面单独公示，相关内容请以本栏目信息为准。"]'::jsonb)
on conflict (id) do nothing;

-- ============================================================
-- 迁移完成后可验证：
--   select id, date, pin, hidden, title from public.notices order by pin desc, date desc;
-- 应返回 10 行。
-- ============================================================
