# 留言板 / 账号体系 · 部署与验收

```
浏览器（纯静态页）
   │  supabase-js + publishable key
   ▼
Supabase：Auth（账号） + Postgres（profiles / messages / user_roles）
   │
   └─ RLS 决定谁能读哪一行：待审留言只有作者本人和站长看得见
```

两个前提要记牢：

- 前端只有 **publishable key**，它天生公开、受 RLS 约束；`service_role` / secret key 永远不进仓库。
- 站长身份只存在 `public.user_roles`，判权走 `private.is_admin()`；前端藏按钮只是体验，不是安全边界。

---

## 1. 执行 SQL（顺序不能乱）

| 顺序 | 文件 | 说明 |
| --- | --- | --- |
| 1 | `01_schema.sql` | 建 5 张表、索引、触发器、3 个站长 RPC。可重复执行 |
| 2 | `02_policies.sql` | 收回默认权限 → 列级授权 → 开 RLS → 建策略。可重复执行 |
| 3 | 先去 `account.html` 注册一个账号 | 注册成功后 `profiles` 里会自动出现你的昵称 |
| 4 | `03_grant_admin.sql` | 把里面那行邮箱改成你注册用的，单独执行那一段 |
| 5 | `05_fix_ip_leak.sql` | 把 `messages` 的 select 收窄成列级，并建站长专用 `gb_admin_posts()`。**修补 `author_ip` / `author_ua` 被任何访客读走的漏洞，必做** |
| 6 | `99_verify.sql` | 只读自查，逐项对照注释里的"应该是" |

`02` 结尾有一句 `notify pgrst, 'reload schema'`，让接口立刻读到新表结构，不用等缓存过期。

---

## 2. 控制台必改项

### 2.1 关掉邮箱确认（**必做，否则注册完登不进去**）

`Authentication → Sign In / Providers → Email` → 关闭 **Confirm email**

当前项目这一项是 **开着的**（`mailer_autoconfirm = false`）。本站全程不发邮件，
不开这个开关，新账号会卡在"未验证"状态，登录直接报 `Email not confirmed`。

### 2.2 站点地址

`Authentication → URL Configuration → Site URL` 填 `https://harvey-music.github.io`

本站不发信、不做 OAuth 回调，这一项只是兜底；填了不会有副作用。

### 2.3 密码长度

`Authentication → Settings → Minimum password length` 改成 `8`（前端已经按 8 位校验）。

### 2.4 注册限流（建议调低）

`Authentication → Rate Limits`：把 `Sign ups`、`Token refreshes` 按需调小。
配合下面的留言限流（同账号 10 分钟最多 5 条），基本够用。

### 2.5 CAPTCHA / Turnstile：**本版不要开**

一旦在控制台打开 CAPTCHA，Supabase 会要求前端提交 `captchaToken`，
而本版前端没有接验证组件，注册会立刻失败。

想上 Turnstile 的话，顺序是：先在前端接入并拿到 token（`signUp` / `signInWithPassword`
的 `options.captchaToken`），确认能注册成功之后，再回控制台打开开关。

### 2.6 免费档注意

免费项目 **一周没有活动会被暂停**，恢复要手动点一下。留言板有人用就不会停；
长期没人访问时，记得每月打开一次控制台看看。

---

## 3. 越权验收

先在浏览器（或 curl）里登录拿一个 token：

```bash
URL=https://fowurkaatlohtiqvqvoc.supabase.co
ANON=sb_publishable_aKWkBeYJh1pHo38dV6bkPQ_PWR7FD44

curl -s "$URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"email":"你的邮箱","password":"你的密码"}'
# 取返回里的 access_token，记作 $TOKEN
```

> Windows 10 以上自带 `curl.exe`；如果被代理干扰，把同样的请求换到浏览器的
> 开发者工具 → Network → 右键请求 → Copy as cURL 也行。

| # | 场景 | 命令要点 | 期望结果 |
| --- | --- | --- | --- |
| 1 | 匿名读留言 | `-H "apikey: $ANON"` GET `/rest/v1/messages` | 只返回 `published` 的行 |
| 2 | 匿名写留言 | 同上改 POST + `body` | 401/403，写不进去 |
| 3 | 匿名读角色表 | GET `/rest/v1/user_roles` | 401/403（`anon` 没有 select 权限） |
| 4 | 登录用户硬塞状态 | POST `/rest/v1/messages`，body 里带 `"status":"published"` | 插入成功，但返回的 `status` 是 `pending` |
| 5 | 改别人的留言 | PATCH `/rest/v1/messages?id=eq.<别人的 id>` | 返回 `[]`，0 行受影响 |
| 6 | 改自己已发布留言的正文 | PATCH `{"body":"新内容"}` | 400：留言发布后不能修改正文 |
| 7 | 自己给自己发信任 | PATCH `/rest/v1/profiles?id=eq.<自己>`，body 带 `"trust_level":1` | 400（列权限里没有 trust_level） |
| 8 | 普通用户调审核接口 | POST `/rest/v1/rpc/gb_review` | 400：仅站长可以执行该操作 |
| 9 | 匿名读作者 IP | GET `/rest/v1/messages?select=id,author_ip` | 401/403：`permission denied for table messages`（select 已收窄成列级） |
| 10 | 登录用户读作者 IP | 同上但带 `$TOKEN` | 401/403，同样读不到（IP 只经 `gb_admin_posts()` 给站长） |

第 4、6、7、8 条是整套设计的核心：**状态由触发器改写、正文发布后锁死、
提权只能走 security definer 函数、函数内部再判一次站长**。

第 9、10 条防的是另一类问题：**RLS 只过滤行、不过滤列**。所以"能读这一行"
不等于"能读这一行的所有字段" —— 敏感列必须靠**列级 GRANT** 单独授权，
否则任何一个拿到公开 key 的人都能 `?select=author_ip` 把所有人的 IP 读走。

---

## 4. 日常维护

### 加敏感词

```sql
insert into public.banned_words (word, severity) values
  ('加微信', 'block'),   -- 直接拒发
  ('推广',   'flag')     -- 只降级为待审（站长仍能看到）
on conflict do nothing;
```

### 手动重置密码（本站不发邮件，只能站长来）

```sql
-- 1) 确认邮箱（顺便解决"未验证"状态）
update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now())
where lower(email) = lower('对方邮箱');

-- 2) 直接改密码（pgcrypto 装在 extensions schema 里）
update auth.users
set encrypted_password = extensions.crypt('新的临时密码', extensions.gen_salt('bf'))
where lower(email) = lower('对方邮箱');
```

改完让对方用临时密码登录，并提醒他自行更改。

### 看谁在什么时候做了什么

```sql
select l.created_at, l.action, l.message_id, l.reason, u.email
from public.moderation_log l
left join auth.users u on u.id = l.actor_id
order by l.created_at desc
limit 100;
```

### 备份

`Database → Backups` 免费档只保留较短周期。留言是唯一有价值的动态数据，
需要的话定期 `select * from public.messages` 导出成 CSV。

---

## 5. 常见报错对照

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 注册后登录报 `Email not confirmed` | 控制台确认邮件还开着 | 见 2.1 |
| 留言列表报 `could not find the table` | 01 没执行，或 PostgREST 缓存没刷 | 执行 01，再执行 `notify pgrst, 'reload schema'` |
| 发留言报 `账号资料不存在` | 注册时建资料的触发器没生效 | 重跑 01（`on_auth_user_created` 那段） |
| 发留言报 `new row violates row-level security policy` | `messages_insert_self` 没建，或 `author_id` 不是当前用户 | 重跑 02 |
| 全是 `permission denied for table` | 02 里的 GRANT 段没执行完整 | 重跑 02 |
| 后台页一直显示"需要站长权限" | 03 没执行，或邮箱写错 | 重跑 03，注意邮箱大小写不敏感但别拼错 |
| 页面样式错乱 | 忘了引 `guestbook.css` / `subpage.css` | 首页只要 `guestbook.css`，三个新页两样都要 |

---

## 6. 这一期没做的

- 头像上传（现在是昵称首字 + 哈希色块，不占存储也不涉黄图审核）
- 邮件通知、密码自助找回（全程不发信，靠站长手动重置）
- 楼中楼 / 点赞 / 举报按钮
- Turnstile 人机验证（见 2.5）
- 用户之间的互相关注、公开个人主页路由（目前是"我的主页"）

这些都留了扩展位：`messages` 加列、加策略即可，不需要改前端架构。
