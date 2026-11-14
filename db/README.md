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
| 6 | `06_admin_mfa.sql` | 站长两步验证的数据库侧强制：没过 TOTP（JWT 里没有 `aal2`）时 `private.is_admin()` 返回 false。**建议做**，见 2.7 |
| 7 | `07_hide_profile_flags.sql` | 把 `profiles` 的 select 收窄成列级（只剩 id / username / bio / created_at）。自己的信任状态走 `gb_my_profile()`，后台用户列表走 `gb_admin_users()`。**建议做**，见 3 的 13–15 条 |
| 8 | `08_admin_reset_password.sql` | 后台一键重置密码：`gb_admin_users()` 补邮箱列 + 新增 `gb_admin_reset_password()`（改 `auth.users.encrypted_password` 并清掉该用户的 `auth.sessions`）。**可选但很省事**，见第 4 节「重置密码」 |
| 9 | `09_ban_until.sql` | 定时封号：`profiles` 加 `banned_until` / `ban_reason`，新增 `gb_ban_user(uid, 分钟, 原因)` / `gb_unban_user(uid)`，留言守卫改成"永久封 or 临时封未到期"都拦。封禁 1 分钟 ~ 30 天，到期自动失效，不用定时任务 |
| 10 | `10_guest_pass.sql` | 游客通行证：`guest_no_seq` 序列 + 重写注册触发器，匿名登录自动分配「游客20XX」；游客号不能改资料。**必须在 09 之后执行** |
| 11 | `99_verify.sql` | 只读自查，逐项对照注释里的"应该是" |

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

### 2.7 站长两步验证（建议开）

1. 控制台 `Authentication → Sign In / Providers → Multi-Factor Authentication`
   → **TOTP (Authenticator app)** 设为 **Enabled**；
2. 执行 `db/06_admin_mfa.sql`（可重复执行）；
3. 打开 `admin.html`：第一次会显示二维码，用验证器 App（Google Authenticator /
   Microsoft Authenticator / 1Password 等）扫一下，把 6 位数字填进去；
4. 验证通过的同时会往 `private.admin_mfa_required` 写一条记录，之后**每次进后台
   都要输一次**验证码。

为什么非要动数据库：只在前端弹框是没用的。攻击者拿到密码后直接
`POST /rest/v1/rpc/gb_review`，根本不经过 `admin.html`。现在的做法是
`private.is_admin()` 自己检查 JWT 里的 `aal` —— 没过 TOTP 就是 `aal1`，
函数返回 false，**审核 / 封人 / 看 IP 的 RPC 连同 RLS 里的站长分支一起失效**。

不会把自己锁死：记录为空时行为完全不变；只有「已经通过验证器」（`aal2`）
那一刻才写得进记录，所以只有密码的人关不掉这个开关。
验证器丢了怎么恢复见 4.4。

### 2.8 开启匿名登录（游客通行证，**必做**）

`Authentication → Sign In / Providers → Anonymous sign-ins` → **打开**。

本站现在「下载必须先持号」：访客进站弹一张游客通行证，点一下就完成匿名登录，
不填邮箱不填密码。这一项不开，点「以游客身份进入」会报 `anonymous_provider_disabled`，
等于**整个下载入口都关着**。

游客号只是"能下载、能留言"的最低门槛，清缓存 / 换浏览器就是一张新号，
所以它是**管控入口**而不是身份证明。真要锁死文件得走 COS 私有读 + 签名 URL（见第 6 节）。

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
| 11 | 站长只登录、没输验证器（aal1）就调审核 | POST `/rest/v1/rpc/gb_review`（站长账号的 `$TOKEN`） | 400：仅站长可以执行该操作 —— `is_admin()` 在 aal1 下是 false（06 之后） |
| 12 | 匿名打开两步验证开关 | POST `/rest/v1/rpc/gb_admin_mfa_activate` | 401/403（`anon` 没有执行权） |
| 13 | 匿名读信任 / 限制标记 | GET `/rest/v1/profiles?select=id,username,trust_level,is_banned` | 401/403：`permission denied for table profiles`（07 之后列级授权；只读 `username` 仍是 200） |
| 14 | 匿名调「我的资料」接口 | POST `/rest/v1/rpc/gb_my_profile` | 401/403，`anon` 没有执行权；就算登录了也只能拿到自己那一行 |
| 15 | 普通用户调站长用户列表 | POST `/rest/v1/rpc/gb_admin_users`（普通用户的 `$TOKEN`） | 400：仅站长可以执行该操作 |
| 16 | 匿名调重置密码接口 | POST `/rest/v1/rpc/gb_admin_reset_password`，body `{"p_user_id":"<任意 uid>","p_new_password":"12345678"}` | 401/403（`anon` 没有执行权，08 之后；同一条用普通用户的 `$TOKEN` 则是 400：仅站长可以执行该操作） |

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

### 重置密码（本站不发邮件，站长来）

**推荐：后台一键**（执行过 `08_admin_reset_password.sql` 之后）

1. 对方把注册邮箱发过来（`account.html` 登录框下面写着联系方式）；
2. 打开 `admin.html` → 「用户」→ 找到那一行（列表现在带邮箱）→ 点「重置密码」；
3. 弹窗里已经预填了一个 12 位随机临时密码，点确认后复制发给对方（也可以自己改）；
4. 对方的旧登录态同一瞬间被清掉（`delete from auth.sessions`），必须用临时密码重新登录再自行修改。

每次重置都写 `moderation_log`（`action = 'admin_reset_password'`），事后可查。

**兜底：直接写 SQL**（08 还没执行、或者后台进不去时）

```sql
-- 1) 确认邮箱（顺便解决"未验证"状态）
update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now())
where lower(email) = lower('对方邮箱');

-- 2) 直接改密码（pgcrypto 装在 extensions schema 里；cost 10 与 GoTrue 一致）
update auth.users
set encrypted_password = extensions.crypt('新的临时密码', extensions.gen_salt('bf', 10))
where lower(email) = lower('对方邮箱');

-- 3) 顺手清掉旧登录态，否则对方手上的 refresh token 还能用
delete from auth.sessions
where user_id = (select id from auth.users where lower(email) = lower('对方邮箱'));
```

改完让对方用临时密码登录，并提醒他自行更改。

### 封号 / 解封（定时）

后台 `admin.html` → 「用户」→ 点「封号」：

1. 弹窗里选时长：1 分钟 / 1 小时 / 1 天 / 7 天 / 30 天，或者手填 1–43200 之间的分钟数；
2. 原因可填可不填（只有你看得到，对方在看自己的状态时也能看到）；
3. 确认后数据库里写 `profiles.banned_until = now() + 时长`，同时清掉 `is_banned`；
4. 想提前放人：那一行的按钮会变成「立即解封」，点一下清空两个字段。

封禁期间：**留言被数据库触发器直接拒绝**（`该账号已被封禁，暂时不能发言`），
**站内下载被前端拦下**（弹「账号封禁中」，给出解封时间和申诉邮箱 `zjh041106@qq.com`）。

到期**自动恢复**，因为判断条件是 `banned_until > now()`，不需要任何定时任务或云函数。
页面挂很久的情况，前端也会重新比一次时间。

直接写 SQL 也行：

```sql
-- 封 2 小时
update public.profiles
set banned_until = now() + interval '2 hours', is_banned = false
where id = (select id from auth.users where email = '对方邮箱');

-- 解封
update public.profiles set banned_until = null, ban_reason = null, is_banned = false
where id = (select id from auth.users where email = '对方邮箱');
```

`is_banned` 还留着，语义是「永久限制」（旧数据、`gb_set_ban` 走的路）；
有效封禁 = `is_banned or banned_until > now()`，两者是「或」的关系。

### 看谁在什么时候做了什么

```sql
select l.created_at, l.action, l.message_id, l.reason, u.email
from public.moderation_log l
left join auth.users u on u.id = l.actor_id
order by l.created_at desc
limit 100;
```

### 两步验证：重绑 / 关掉（4.4）

验证器丢了、手机也换了 —— **先把密码改掉**（确认账号不是被别人拿走），再：

```sql
-- 1) 删掉旧 factor，回 admin.html 重新扫码绑定
delete from auth.mfa_factors where user_id = '<站长 uid>';

-- 2) 万不得已要彻底关掉强制（回到"只要密码就能审核"的旧行为）
delete from private.admin_mfa_required where user_id = '<站长 uid>';
```

谁开了强制：

```sql
select r.user_id, u.email, r.activated_at
from private.admin_mfa_required r
left join auth.users u on u.id = r.user_id;
```

> 只有密码、没有验证器的人在 `aal1`，**调不动** `gb_admin_mfa_activate()`，
> 所以上面第 2 条只能由你本人（或控制台里的 SQL）执行。

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
| 后台卡在"两步验证没有准备好" | 控制台没启用 TOTP，或 `06` 没执行 | 见 2.7；启用 TOTP 后刷新 `admin.html` |
| 站长自己被"仅站长可以执行该操作"挡住 | 已启用强制，但这次登录没输验证器（aal1） | 刷新 `admin.html` 输一次 6 位码；验证器丢了见 4.4 |
| 后台「重置密码」报 `function extensions.crypt(text, text) does not exist` | pgcrypto 没启用，或不在 `extensions` schema | Database → Extensions 打开 pgcrypto，重跑 `08_admin_reset_password.sql` |
| 重置完对方还"像登录着" | 他那边还开着旧页面 | 旧 `auth.sessions` 已删，刷新任意页面就会回到未登录；让他用临时密码重登 |
| 点「以游客身份进入」报 `anonymous_provider_disabled` | 控制台没开匿名登录 | 见 2.8，打开 Anonymous sign-ins |
| 领了通行证还是点不动下载 | `09` / `10` 没执行，或 `gb_my_profile` 报错 | 重跑 09、10，F12 看 Network 里 `rpc/gb_my_profile` 的返回 |
| 游客号改昵称没反应 | 设计如此：RLS 只放行非游客的更新 | 想自定义资料就注册正式账号 |

---

## 6. 这一期没做的

- 头像上传（现在是昵称首字 + 哈希色块，不占存储也不涉黄图审核）
- 邮件通知、密码自助找回（全程不发信；改密码靠后台一键重置，见第 4 节）
- 楼中楼 / 点赞 / 举报按钮
- Turnstile 人机验证（见 2.5）
- COS 私有读 + Edge Function 签名 URL（现在下载只拦"从站内点按钮"的人，
  `data/downloads.json` 和直链本身仍是公开的，懂行的人可以直接下）
- 用户之间的互相关注、公开个人主页路由（目前是"我的主页"）

这些都留了扩展位：`messages` 加列、加策略即可，不需要改前端架构。
