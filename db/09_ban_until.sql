-- ============================================================
-- 文件 09：定时封号（1 分钟 ~ 30 天）+ 一键解封
--
-- 现状：profiles.is_banned 是布尔值，只能"永久限制发言"，
--       没有到期时间，解封也得手动点，封多久全靠人脑记。
--
-- 本文件：
--   * profiles 加 banned_until（到期时间）、ban_reason（只有站长看得到的原因）；
--   * 有效封禁 = is_banned（永久）or banned_until > now()（临时）——
--     到期不需要定时任务，查询时比一下就好，也不怕服务重启；
--   * gb_ban_user(uid, 分钟, 原因)：1 ~ 43200 分钟（30 天），返回解封时间；
--   * gb_unban_user(uid)：「中断」按钮，两个字段一起清；
--   * messages_guard() 重写：封禁期内发留言直接抛错（真拦，不是前端藏按钮）；
--   * gb_my_profile() / gb_admin_users() 多返回封禁信息。
--
-- 安全边界不变：三个函数都是 security definer + 首行判 private.is_admin()，
-- 站长强制 TOTP，所以只有密码的人（aal1）调不动。
--
-- 可重复执行。执行顺序：01 → 02 → 05 → 06 → 07 →（08 可选）→ 09
-- ============================================================

-- ---------- 1. 给资料表加两列 ----------
-- 新列不会自动继承 07 的列级 select 授权，所以匿名照样读不到。
alter table public.profiles add column if not exists banned_until timestamptz;
alter table public.profiles add column if not exists ban_reason   text;

comment on column public.profiles.banned_until is '封禁到期时间；null = 未封禁。配合 is_banned（永久封）一起判断';
comment on column public.profiles.ban_reason   is '封禁原因，只有站长通过 gb_admin_users() 能看到';

-- ---------- 2. 留言守卫：按「有效封禁」拦截 ----------
-- 与 01_schema.sql 里的原版一致，只改了封禁判断那三行（标了 ★）。
create or replace function private.messages_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  prof public.profiles;
  hits integer;
  bad  text;
  hdrs jsonb;
begin
  select * into prof from public.profiles where id = new.author_id;
  if not found then
    raise exception '账号资料不存在，请重新登录后再试';
  end if;

  if tg_op = 'INSERT' then
    -- ★ 09：永久封 或 临时封未到期，都拦
    if prof.is_banned or prof.banned_until > now() then
      raise exception '该账号已被封禁，暂时不能发言';
    end if;

    -- 正文规整：去掉 \r，掐掉首尾空白（表上有 body = btrim(body) 的约束）
    new.body := btrim(replace(coalesce(new.body, ''), chr(13), ''));
    if new.body = '' then
      raise exception '留言内容不能为空';
    end if;
    if char_length(new.body) > 1000 then
      raise exception '留言最多 1000 字';
    end if;

    -- 限流：同一账号 10 分钟内最多 5 条（含已删除的，防删了再发）
    select count(*) into hits
    from public.messages
    where author_id = new.author_id
      and created_at > now() - interval '10 minutes';
    if hits >= 5 then
      raise exception '发言太频繁了，请过几分钟再来';
    end if;

    -- 敏感词：block 直接拒发，flag 只降级为待审
    select word into bad
    from public.banned_words
    where new.body ilike '%' || word || '%' and severity = 'block'
    limit 1;
    if bad is not null then
      raise exception '内容包含不允许发布的词语';
    end if;

    -- 信任用户和站长本人直接公开：站长不需要审自己
    -- （敏感词 flag 命中时下面还会再降回待审，这一条对站长同样生效）
    new.status := case
      when prof.trust_level >= 1 then 'published'
      when private.is_admin()    then 'published'
      else 'pending'
    end;

    select word into bad
    from public.banned_words
    where new.body ilike '%' || word || '%' and severity = 'flag'
    limit 1;
    if bad is not null then
      new.status := 'pending';
    end if;

    -- 审核/删除相关字段一律清空，不给客户端留后门
    new.created_at    := now();
    new.published_at  := case when new.status = 'published' then now() else null end;
    new.reviewed_by   := null;
    new.reviewed_at   := null;
    new.deleted_at    := null;
    new.deleted_by    := null;
    new.delete_reason := null;

    -- 风控信息：PostgREST 把请求头塞在 request.headers 里
    begin
      hdrs := coalesce(current_setting('request.headers', true), '{}')::jsonb;
      new.author_ip := nullif(split_part(coalesce(hdrs ->> 'x-forwarded-for', ''), ',', 1), '')::inet;
      new.author_ua := left(coalesce(hdrs ->> 'user-agent', ''), 300);
    exception when others then
      new.author_ip := null;
      new.author_ua := null;
    end;

    return new;
  end if;

  -- ---------- UPDATE ----------
  -- 发布后不能改正文：否则"先审过一条干净内容，再改成广告"就绕过了审核
  if new.body is distinct from old.body then
    raise exception '留言发布后不能修改正文';
  end if;
  if new.author_id is distinct from old.author_id then
    raise exception '不能更改留言作者';
  end if;

  if private.is_admin() then
    if new.status is distinct from old.status then
      new.reviewed_by := (select auth.uid());
      new.reviewed_at := now();
      new.published_at := case
        when new.status = 'published' then coalesce(old.published_at, now())
        else old.published_at
      end;
      if new.status = 'deleted' then
        new.deleted_at := now();
        new.deleted_by := (select auth.uid());
      end if;
    end if;
  else
    -- 本人只能撤回，撤回后不再公开，但正文留在库里备查
    if new.status is distinct from 'withdrawn' then
      raise exception '没有权限修改留言状态';
    end if;
    if old.status not in ('pending', 'published') then
      raise exception '该留言当前状态不能撤回';
    end if;
  end if;

  return new;
end;
$fn$;

-- ---------- 3. 封号：1 ~ 43200 分钟 ----------
create or replace function public.gb_ban_user(
  p_user    uuid,
  p_minutes integer,
  p_reason  text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid   uuid := (select auth.uid());
  v_until timestamptz;
begin
  if not private.is_admin() then
    raise exception '仅站长可以执行该操作';
  end if;

  if p_user is null then
    raise exception '缺少目标用户';
  end if;

  if p_minutes is null or p_minutes < 1 or p_minutes > 43200 then
    raise exception '封禁时长只能是 1 到 43200 分钟（1 分钟 ~ 30 天）';
  end if;

  if v_uid = p_user then
    raise exception '不能封禁自己';
  end if;

  v_until := now() + make_interval(mins => p_minutes);

  update public.profiles
     set banned_until = v_until,
         ban_reason   = nullif(btrim(coalesce(p_reason, '')), ''),
         is_banned    = false          -- 临时封取代"永久限制"，两者不叠加
   where id = p_user;

  if not found then
    raise exception '用户不存在';
  end if;

  insert into public.moderation_log (actor_id, action, reason)
  values (v_uid, 'ban_until',
          p_user::text || ' ' || p_minutes::text || ' 分钟' ||
          coalesce('：' || nullif(btrim(p_reason), ''), ''));

  return v_until;
end;
$fn$;

revoke all on function public.gb_ban_user(uuid, integer, text) from public, anon;
grant execute on function public.gb_ban_user(uuid, integer, text) to authenticated;

-- ---------- 4. 解封（后台的「中断」按钮） ----------
create or replace function public.gb_unban_user(p_user uuid)
returns void
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

  update public.profiles
     set banned_until = null,
         ban_reason   = null,
         is_banned    = false
   where id = p_user;

  if not found then
    raise exception '用户不存在';
  end if;

  insert into public.moderation_log (actor_id, action, reason)
  values (v_uid, 'unban', p_user::text);

  return;
end;
$fn$;

revoke all on function public.gb_unban_user(uuid) from public, anon;
grant execute on function public.gb_unban_user(uuid) to authenticated;

-- ---------- 5. 我的资料：多返回封禁状态 ----------
-- 返回列变了，create or replace 改不了，只能先 drop。
drop function if exists public.gb_my_profile();

create function public.gb_my_profile()
returns table (
  username     text,
  bio          text,
  trust_level  smallint,
  is_banned    boolean,
  banned_until timestamptz,
  ban_reason   text,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.username,
         p.bio,
         p.trust_level::smallint,
         -- 这里返回的是「有效封禁」：永久封或临时封未到期都算 true，
         -- 前端只判这一个字段就够了，不用自己算时间。
         (p.is_banned or p.banned_until > now()) as is_banned,
         p.banned_until,
         p.ban_reason,
         p.created_at
  from public.profiles p
  where p.id = (select auth.uid());
$fn$;

revoke all on function public.gb_my_profile() from public, anon;
grant execute on function public.gb_my_profile() to authenticated;

-- ---------- 6. 站长：用户列表（含邮箱与封禁信息） ----------
drop function if exists public.gb_admin_users();

create function public.gb_admin_users()
returns table (
  id           uuid,
  username     text,
  email        text,
  trust_level  smallint,
  is_banned    boolean,
  banned_until timestamptz,
  ban_reason   text,
  created_at   timestamptz
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
           (p.is_banned or p.banned_until > now()) as is_banned,
           p.banned_until,
           p.ban_reason,
           p.created_at
    from public.profiles p
    left join auth.users u on u.id = p.id
    order by p.created_at desc
    limit 100;
end;
$fn$;

revoke all on function public.gb_admin_users() from public, anon;
grant execute on function public.gb_admin_users() to authenticated;

notify pgrst, 'reload schema';

-- 执行后自检：
--   1) 匿名调 gb_ban_user / gb_unban_user 应 401（没有执行权）；
--   2) 后台用户列表每行应能看到「封禁至 …」和「立即解封」按钮；
--   3) 被封期间用那个账号发留言 → 报「该账号已被封禁，暂时不能发言」；
--   4) 等 1 分钟（最短档）后再发 → 自动恢复正常，不需要任何定时任务；
--   5) select * from public.moderation_log where action in ('ban_until','unban') 查得到记录。
--
-- 注意：is_banned 仍然存在，语义是「永久封」（旧数据 / gb_set_ban 走的路）。
--       本文件新增的定时封只用 banned_until，两者在判断时是「或」的关系。
