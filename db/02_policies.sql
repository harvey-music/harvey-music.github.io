-- ============================================================
-- 文件 02 / 04：权限（REVOKE + 列级 GRANT + RLS 策略）
-- 前置：01_schema.sql 已执行成功
-- 特点：可重复执行
-- ============================================================

-- ---------- 1. 先收回默认权限 ----------
-- Supabase 会给 public 下新建的表自动授予 anon/authenticated 全部权限。
-- 不收回的话，下面的策略只能过滤"行"，拦不住"删表数据"这种动作。
revoke all on table public.profiles       from anon, authenticated;
revoke all on table public.messages       from anon, authenticated;
revoke all on table public.user_roles     from anon, authenticated;
revoke all on table public.banned_words   from anon, authenticated;
revoke all on table public.moderation_log from anon, authenticated;

revoke all on all sequences in schema public from anon, authenticated;

-- ---------- 2. 按最小可用原则重新授权 ----------
-- 资料：人人可读；本人只能改昵称和简介。
-- 列级 GRANT 是关键 —— 改不了 trust_level / is_banned。
grant select on table public.profiles to anon, authenticated;
grant update (username, bio) on table public.profiles to authenticated;

-- 留言：匿名只读；登录用户可读、可发，但只能改 status 这一列。
-- 注意：select 必须是「列级」授权。RLS 只过滤行、不过滤列 ——
-- 一旦给表级 select，author_ip / author_ua 就会连同正文一起暴露给
-- 任何拿到 publishable key 的人（实测确认过，返回 200 带真实 IP）。
-- 站长要看 IP 走 05_fix_ip_leak.sql 里的 gb_admin_posts()。
grant select (id, body, status, created_at, published_at, author_id)
  on table public.messages to anon, authenticated;
grant insert on table public.messages to authenticated;
grant update (status) on table public.messages to authenticated;

-- 角色：登录用户可读，策略限制成只能读到自己的那一行
grant select on table public.user_roles to authenticated;

-- 日志：登录用户可读，策略限制成只有站长读得到
grant select on table public.moderation_log to authenticated;

-- 敏感词：不授权给任何客户端角色，只在 security definer 函数内部查

-- 自增主键要用序列
grant usage, select on all sequences in schema public to authenticated;

-- ---------- 3. 开启 RLS ----------
alter table public.profiles       enable row level security;
alter table public.messages       enable row level security;
alter table public.user_roles     enable row level security;
alter table public.banned_words   enable row level security;
alter table public.moderation_log enable row level security;

-- ---------- 4. 行级策略 ----------

-- 资料表：公开可读；本人可改自己那一行（列权限只放开了 username / bio）
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to anon, authenticated
  using (true);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- 留言表：匿名只看得到已公开的
drop policy if exists messages_read_public on public.messages;
create policy messages_read_public on public.messages
  for select to anon
  using (status = 'published');

-- 登录用户：已公开的 + 自己的全部（含待审、被拒）；站长：全部。
-- 这一条必须只挂 authenticated：private.is_admin() 没授权给 anon，
-- 一旦把 anon 也写进来，匿名访问会直接 permission denied。
drop policy if exists messages_read_member on public.messages;
create policy messages_read_member on public.messages
  for select to authenticated
  using (
    status = 'published'
    or author_id = (select auth.uid())
    or private.is_admin()
  );

-- 发留言：只能以自己的身份发（status 由触发器改写，这里管不着）
drop policy if exists messages_insert_self on public.messages;
create policy messages_insert_self on public.messages
  for insert to authenticated
  with check (author_id = (select auth.uid()));

-- 本人改：列权限只有 status，触发器只放过 → withdrawn
drop policy if exists messages_update_self on public.messages;
create policy messages_update_self on public.messages
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

-- 站长改任何一条
drop policy if exists messages_update_admin on public.messages;
create policy messages_update_admin on public.messages
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- 故意的：这里没有 DELETE 策略。删除一律软删除（status = 'deleted'），
-- 正文与操作人留在库里，出事能倒查。

-- 角色表：只能看到自己那行；站长能看全部（后台列表要用）
drop policy if exists user_roles_read on public.user_roles;
create policy user_roles_read on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

-- 操作日志：只有站长能看
drop policy if exists moderation_log_read on public.moderation_log;
create policy moderation_log_read on public.moderation_log
  for select to authenticated
  using (private.is_admin());

-- 敏感词表：一条策略都不建 = 客户端完全读不到

-- ---------- 5. RPC 执行权 ----------
-- 函数默认对 PUBLIC 开 EXECUTE，必须显式收回，否则匿名也能调
revoke all on function public.gb_review(bigint, text) from public, anon;
revoke all on function public.gb_set_trust(uuid, smallint) from public, anon;
revoke all on function public.gb_set_ban(uuid, boolean) from public, anon;

grant execute on function public.gb_review(bigint, text) to authenticated;
grant execute on function public.gb_set_trust(uuid, smallint) to authenticated;
grant execute on function public.gb_set_ban(uuid, boolean) to authenticated;

-- 让 PostgREST 立刻重新读一遍表结构，不用等它自己刷新缓存
notify pgrst, 'reload schema';

-- 执行完毕。接着执行 03_grant_admin.sql 把你自己设成站长。