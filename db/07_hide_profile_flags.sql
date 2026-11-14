-- ============================================================
-- 文件 07：堵住 profiles.trust_level / is_banned 被匿名读走的小口子
--
-- 现状（实测确认）：
--   GET /rest/v1/profiles?select=id,username,trust_level,is_banned
--   匿名就能返回 200，能看到"谁是信任用户、谁被限制了发言"。
--   根因和 05 一样：02_policies.sql 给的是「表级」select，
--   而 RLS 只过滤行、不过滤列。
--
-- 修法：
--   1) profiles 的 select 收窄成列级，只留前端真正用到的四列
--      （留言板内联用户名、个人主页昵称简介都要用）；
--   2) 自己要看 trust_level / is_banned 走 gb_my_profile()；
--   3) 后台用户列表走 gb_admin_users()（函数内部判 private.is_admin()）。
--
-- update (username, bio) 的授权不受影响，仍在 02_policies.sql 里。
-- 可重复执行。
-- ============================================================

-- ---------- 1. select 收窄为列级 ----------
revoke select on table public.profiles from anon, authenticated;

grant select (id, username, bio, created_at)
  on table public.profiles to anon, authenticated;

-- ---------- 2. 我自己的资料（含信任 / 限制状态） ----------
create or replace function public.gb_my_profile()
returns table (
  username    text,
  bio         text,
  trust_level smallint,
  is_banned   boolean,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.username,
         p.bio,
         p.trust_level::smallint,
         p.is_banned::boolean,
         p.created_at
  from public.profiles p
  where p.id = (select auth.uid());
$fn$;

revoke all on function public.gb_my_profile() from public, anon;
grant execute on function public.gb_my_profile() to authenticated;

-- ---------- 3. 站长：用户列表 ----------
create or replace function public.gb_admin_users()
returns table (
  id          uuid,
  username    text,
  trust_level smallint,
  is_banned   boolean,
  created_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not private.is_admin() then
    raise exception '仅站长可以执行该操作';
  end if;

  return query
    select p.id,
           p.username,
           p.trust_level::smallint,
           p.is_banned::boolean,
           p.created_at
    from public.profiles p
    order by p.created_at desc
    limit 100;
end;
$fn$;

revoke all on function public.gb_admin_users() from public, anon;
grant execute on function public.gb_admin_users() to authenticated;

-- 让 PostgREST 立刻刷新列权限与函数缓存
notify pgrst, 'reload schema';

-- 执行完毕后：
--   1) 匿名读 trust_level / is_banned 应变成 401 permission denied；
--   2) 硬刷新 account.html，自己的「信任用户 / 已限制发言」仍正常显示（走 RPC）；
--   3) 后台用户列表照旧（走 gb_admin_users），信任 / 限制按钮不受影响。
