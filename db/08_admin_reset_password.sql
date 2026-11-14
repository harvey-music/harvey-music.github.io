-- ============================================================
-- 文件 08：站长后台一键重置用户密码
--
-- 背景：本站「全程不发邮件」，所以 Supabase 控制台的
--       Reset password（那一步是发重置邮件）在这里用不了。
--       以前只能手写 SQL 改 encrypted_password（见 db/README.md 的
--       「手动重置密码」），每次都要翻文档、找 uid、复制粘贴。
--
-- 本文件把这件事搬到后台界面：
--   * gb_admin_users() 多返回一列 email，站长能对上"这是谁"；
--   * gb_admin_reset_password() 直接改 auth.users.encrypted_password
--     （bcrypt cost 10，和 GoTrue 一致），并清掉该用户的
--     auth.sessions —— 旧 refresh token 立刻失效，所有设备强制重登。
--
-- 安全边界：
--   * 两个函数都是 security definer，函数体内判 private.is_admin()；
--   * 站长已强制 TOTP，所以只有密码、没有验证器的人（aal1）调不动；
--   * 每次重置都写 public.moderation_log，事后能查到"谁重置了谁"。
--
-- 代价（必须知道，不粉饰）：
--   站长技术上因此可以给任何账号设密码，等于能登录任何账号。
--   这是「没有邮件通道」换来的。介意就别执行本文件。
--
-- 先决条件：pgcrypto 已启用（Supabase 默认在 extensions schema）。
--   若报 function extensions.crypt(text, text) does not exist，
--   去 Database → Extensions 打开 pgcrypto 再重跑。
--
-- 可重复执行。
-- ============================================================

-- ---------- 1. 用户列表：补一列邮箱 ----------
-- 返回类型变了，create or replace 改不了，只能先 drop。
drop function if exists public.gb_admin_users();

create function public.gb_admin_users()
returns table (
  id          uuid,
  username    text,
  email       text,
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
           u.email::text,
           p.trust_level::smallint,
           p.is_banned::boolean,
           p.created_at
    from public.profiles p
    left join auth.users u on u.id = p.id
    order by p.created_at desc
    limit 100;
end;
$fn$;

revoke all on function public.gb_admin_users() from public, anon;
grant execute on function public.gb_admin_users() to authenticated;

-- ---------- 2. 一键重置密码 ----------
create or replace function public.gb_admin_reset_password(p_user_id uuid, p_new_password text)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
begin
  if not private.is_admin() then
    raise exception '仅站长可以执行该操作';
  end if;

  if p_user_id is null then
    raise exception '缺少目标用户';
  end if;

  if p_new_password is null or char_length(p_new_password) < 8 then
    raise exception '临时密码至少 8 位';
  end if;

  -- GoTrue 用 bcrypt，且 bcrypt 只取前 72 字节；留点余量
  if char_length(p_new_password) > 64 then
    raise exception '临时密码最长 64 位';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = p_user_id;

  if not found then
    raise exception '用户不存在';
  end if;

  -- 旧登录态全部作废：对方手上的 refresh token 立刻失效
  delete from auth.sessions where user_id = p_user_id;

  insert into public.moderation_log (actor_id, action, reason)
  values (v_uid, 'admin_reset_password', '重置了用户 ' || p_user_id::text || ' 的密码');

  return 'ok';
end;
$fn$;

revoke all on function public.gb_admin_reset_password(uuid, text) from public, anon;
grant execute on function public.gb_admin_reset_password(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- 执行后自检：
--   1) 匿名调 gb_admin_reset_password 应 401（anon 没有执行权）；
--   2) 后台「用户」列表每行多出一个邮箱和「重置密码」按钮；
--   3) 重置自己之后，当前会话会被踢下线 —— 这是 delete auth.sessions 的正常表现，
--      用新密码重新登录即可。
