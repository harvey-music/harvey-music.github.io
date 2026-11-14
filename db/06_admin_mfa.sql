-- ============================================================
-- 文件 06：给站长账号加两步验证（TOTP）的数据库侧强制
--
-- 为什么不能只在前端弹一个验证码框：
--   前端那个框是可以被完全绕过的。攻击者拿到站长密码后，直接
--   POST /rest/v1/rpc/gb_review，请求根本不会经过 admin.html。
--   所以真正的边界必须在数据库：本次登录的 JWT 里没有 aal2
--   （＝没有真的过一遍验证器），private.is_admin() 就返回 false ——
--   审核、封人、看 IP 的 RPC 以及 RLS 里的站长分支会一起失效。
--
-- 为什么不会把自己锁在门外：
--   private.admin_mfa_required 里没有你的记录时，is_admin() 的行为
--   和现在完全一样。只有当「已经通过 TOTP 验证」（aal2）的那一刻
--   调用 gb_admin_mfa_activate()，才会写下这一行。只有密码、没有
--   验证器的攻击者停在 aal1，调不动这个函数，也就关不掉强制。
--
-- 执行前先确认控制台已启用 TOTP：
--   Authentication → Sign In / Providers → Multi-Factor Authentication
--   → TOTP (Authenticator app) = Enabled
--   （没开的话 admin.html 会提示"两步验证准备失败"、后台进不去，
--     但数据库权限还没变 —— 删掉第 2 段即可恢复原样。）
--
-- 可重复执行。
-- ============================================================

-- ---------- 1. 已经启用强制的站长名单 ----------
create table if not exists private.admin_mfa_required (
  user_id      uuid primary key,
  activated_at timestamptz not null default now()
);

-- private schema 本来就没授权给客户端（只给了 usage + is_admin 执行权）。
-- 这里再上一道 RLS：哪天有人误 grant，也读不到这张表。
alter table private.admin_mfa_required enable row level security;

-- ---------- 2. 判权函数：激活后要求 aal2 ----------
-- 只改这一个函数，就同时管住了：
--   * 3 个站长 RPC（gb_review / gb_set_trust / gb_set_ban）里的判权；
--   * gb_admin_posts() 里读 IP 的判权；
--   * 02_policies.sql 里 messages / user_roles / moderation_log 的站长分支；
--   * messages_guard 触发器里「站长发留言直接发布」的那一条。
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = 'admin'
  )
  and (
    -- 还没启用强制：保持原行为，避免执行完 SQL 就把自己关在门外
    not exists (
      select 1
      from private.admin_mfa_required r
      where r.user_id = (select auth.uid())
    )
    -- 已启用强制：必须是 aal2
    or coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
  );
$fn$;

revoke all on function private.is_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

-- ---------- 3. 站长开启强制（绑定成功后由后台页调用） ----------
create or replace function public.gb_admin_mfa_activate()
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  if not exists (
    select 1
    from public.user_roles
    where user_id = v_uid and role = 'admin'
  ) then
    raise exception '仅站长可以执行该操作';
  end if;

  -- 只有真的过了一遍验证器才能开启。没有这一条，aal1 下也能写记录，
  -- 万一哪天前端流程出错，站长会把自己关在门外。
  if coalesce((select auth.jwt() ->> 'aal'), 'aal1') <> 'aal2' then
    raise exception '请先完成两步验证，再开启强制';
  end if;

  insert into private.admin_mfa_required (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  insert into public.moderation_log (actor_id, action, reason)
  values (v_uid, 'admin_mfa_on', '开启站长两步验证强制');

  return 'ok';
end;
$fn$;

revoke all on function public.gb_admin_mfa_activate() from public, anon;
grant execute on function public.gb_admin_mfa_activate() to authenticated;

notify pgrst, 'reload schema';

-- ---------- 4. 验收 / 恢复 ----------
-- 看谁开了强制：
--   select r.user_id, u.email, r.activated_at
--   from private.admin_mfa_required r
--   left join auth.users u on u.id = r.user_id;
--
-- 验证器丢了、手机也没了（只能走控制台 / SQL）：
--   1) 先改密码：控制台 Authentication → Users → 该账号 → Reset password
--   2) 删掉旧 factor：Users → 该账号 → 删除 TOTP factor，
--      或执行 delete from auth.mfa_factors where user_id = '<uid>';
--   3) 回 admin.html 重新扫码绑定（验证成功会自动写回强制记录）
--
-- 彻底关掉强制（确认密码没泄露再做）：
--   delete from private.admin_mfa_required where user_id = '<uid>';
--   之后 is_admin() 回到「只要密码就能审核」的旧行为。
--
-- 验收：
--   99_verify.sql 的 J 段：admin_mfa_required 表存在、anon 不能读、
--   gb_admin_mfa_activate 对 anon 无执行权。
