-- ============================================================
-- 游客账户清理（阶段 3）：可删条件 + 身份审计 + 预览 + 执行
-- 文件 13 / 13；可重复执行
-- 仅站长可调用预览/执行；心跳仅登录用户。
-- ============================================================

-- ---------- 1. 共享可删条件（预览 can_delete 与执行删除共用，保证完全一致） ----------
create or replace function private.guest_is_deletable(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = p_uid
      and p.is_guest
      and u.is_anonymous
      and p.last_active_at is not null
      and p.last_active_at < now() - interval '15 days'
      and not exists (select 1 from public.messages m where m.author_id = p.id)
      and not exists (select 1 from public.messages m where m.reviewed_by = p.id)
      and not exists (select 1 from public.messages m where m.deleted_by = p.id)
      and not exists (select 1 from public.user_roles r where r.user_id = p.id)
      and not exists (select 1 from public.moderation_log l where l.actor_id = p.id)
      and not exists (select 1 from private.admin_mfa_required r where r.user_id = p.id)
  );
$fn$;

revoke all on function private.guest_is_deletable(uuid) from public;

-- ---------- 2. 身份异常审计（三类异常，只报告、绝不删除） ----------
create or replace function public.cleanup_identity_audit()
returns table (
  uid uuid, username text, email varchar,
  profiles_exists boolean, auth_exists boolean,
  is_guest boolean, is_anonymous boolean, anomaly_type text
)
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not private.is_admin() then
    raise exception '仅站长可以执行该操作';
  end if;

  return query
  select p.id, p.username, u.email, true, true, p.is_guest, u.is_anonymous,
         case when p.is_guest and not u.is_anonymous
              then 'is_guest=true 但 is_anonymous=false'
              else 'is_anonymous=true 但 is_guest=false' end
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.is_guest is distinct from u.is_anonymous

  union all
  select p.id, p.username, null::varchar, true, false, p.is_guest, null,
         '孤立 profiles（无对应 auth.users）'
  from public.profiles p left join auth.users u on u.id = p.id
  where u.id is null

  union all
  select u.id, null, u.email, false, true, null, u.is_anonymous,
         '孤立 auth.users（无对应 profiles）'
  from auth.users u left join public.profiles p on p.id = u.id
  where p.id is null;
end;
$fn$;

-- ---------- 3. 预览（仅站长；清理候选 + 关联报告） ----------
create or replace function public.cleanup_guests_preview()
returns table (
  uid uuid, username text, last_active_at timestamptz, is_anonymous boolean,
  has_messages boolean, has_reviewed boolean, has_deleted boolean,
  has_user_roles boolean, has_modlog boolean, has_mfa boolean,
  can_delete boolean, block_reason text
)
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not private.is_admin() then
    raise exception '仅站长可以执行该操作';
  end if;

  return query
  select
    p.id, p.username, p.last_active_at, u.is_anonymous,
    exists (select 1 from public.messages m where m.author_id = p.id),
    exists (select 1 from public.messages m where m.reviewed_by = p.id),
    exists (select 1 from public.messages m where m.deleted_by = p.id),
    exists (select 1 from public.user_roles r where r.user_id = p.id),
    exists (select 1 from public.moderation_log l where l.actor_id = p.id),
    exists (select 1 from private.admin_mfa_required r where r.user_id = p.id),
    private.guest_is_deletable(p.id),
    case
      when u.is_anonymous is distinct from true
           then '身份标记不一致（is_guest=true 但 is_anonymous≠true），禁止自动删除'
      when p.last_active_at is null
           then '心跳/初始化异常（last_active_at 为空），禁止自动删除'
      when exists (select 1 from public.messages m where m.author_id = p.id) then '有留言/待审内容，保留'
      when exists (select 1 from public.messages m where m.reviewed_by = p.id) then '曾审核留言（reviewed_by），保留'
      when exists (select 1 from public.messages m where m.deleted_by = p.id) then '曾删除留言（deleted_by），保留'
      when exists (select 1 from public.user_roles r where r.user_id = p.id) then '有角色记录，保留'
      when exists (select 1 from public.moderation_log l where l.actor_id = p.id) then '有审核日志，保留'
      when exists (select 1 from private.admin_mfa_required r where r.user_id = p.id) then 'MFA 关联，保留'
      else null
    end
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.is_guest
    and (
      (p.last_active_at is not null and p.last_active_at < now() - interval '15 days')
      or p.last_active_at is null
      or u.is_anonymous is distinct from true
    );
end;
$fn$;

-- ---------- 4. 执行（仅站长；隔离级别守卫 + 双行锁 + 锁内二次验证） ----------
create or replace function public.cleanup_guests_execute()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_count integer := 0;
begin
  if not private.is_admin() then
    raise exception '仅站长可以执行该操作';
  end if;

  if lower(current_setting('transaction_isolation')) is distinct from 'read committed' then
    raise exception '游客清理必须在 READ COMMITTED 隔离级别下执行，当前为 %',
      current_setting('transaction_isolation');
  end if;

  for v_id in
    select p.id
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.is_guest
      and u.is_anonymous
      and p.last_active_at is not null
      and p.last_active_at < now() - interval '15 days'
    for update of p, u skip locked
  loop
    if private.guest_is_deletable(v_id) then
      delete from auth.users where id = v_id;
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$fn$;

-- ---------- 5. 权限 ----------
revoke all on function public.cleanup_identity_audit() from public, anon;
revoke all on function public.cleanup_guests_preview() from public, anon;
revoke all on function public.cleanup_guests_execute() from public, anon;
grant execute on function public.cleanup_identity_audit() to authenticated;
grant execute on function public.cleanup_guests_preview() to authenticated;
grant execute on function public.cleanup_guests_execute() to authenticated;

notify pgrst, 'reload schema';
