-- ============================================================
-- 文件 10：游客通行证（一键匿名账号）+ 下载管控的账号基础
--
-- 为什么要有这个：
--   安装包直链放在腾讯云 COS 公开桶里，GitHub Pages 是纯静态，
--   原本"谁都能下"，封号就没有对象可封。让每个访客先领一张
--   「游客通行证」（Supabase 匿名登录，不填邮箱、不填密码），
--   下载就挂在这个身份上，才能按人封、按时段封。
--
-- 本文件做什么：
--   * guest_no_seq 序列：游客编号 2001、2002、2003…
--   * profiles 加 is_guest 列，后台一眼看出谁是游客；
--   * 重写 private.handle_new_user()：没有邮箱的（匿名登录）自动
--     昵称「游客20XX」；有邮箱的老注册流程一个字没动；
--   * profiles 的更新策略收紧：游客号不能改昵称/简介，
--     避免把昵称改成别人的名字去冒充；
--   * gb_my_profile() / gb_admin_users() 多返回 is_guest。
--
-- 前置：01（注册触发器）→ 09（banned_until）。必须在 09 之后执行。
-- 可重复执行（序列用 if not exists，不会把编号重置回 2001）。
--
-- ⚠ 以后如果重跑了 01_schema.sql，注册触发器会被换回没有游客编号的旧版，
--   需要紧接着再跑一次本文件（和 07 与 02 的关系一样）。
--   重跑 02_policies.sql 也会把"游客不能改资料"这条策略覆盖回去，同样跟着重跑。
-- ============================================================

-- ---------- 1. 游客编号 ----------
create sequence if not exists public.guest_no_seq start with 2001 increment by 1;

-- 客户端不需要碰序列：只有 security definer 的触发器里会 nextval
revoke all on sequence public.guest_no_seq from anon, authenticated;

-- ---------- 2. 标记游客 ----------
-- 新列不继承列级 select 授权，匿名依旧读不到。
alter table public.profiles add column if not exists is_guest boolean not null default false;

comment on column public.profiles.is_guest is '是否为一键生成的游客通行证（匿名登录）';

-- ---------- 3. 注册触发器：匿名用户自动编号 ----------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  raw_name   text;
  base_name  text;
  final_name text;
  tail       text;
begin
  tail := substr(replace(new.id::text, '-', ''), 1, 4);

  -- ★ 10：没有邮箱 = Supabase 匿名登录（游客通行证）。
  --   直接给「游客2001」这种编号，编号由序列保证不重复，
  --   所以这条 insert 不会撞唯一索引、不会进下面的兜底分支。
  if coalesce(new.email, '') = '' then
    insert into public.profiles (id, username, is_guest)
    values (new.id, '游客' || nextval('public.guest_no_seq')::text, true);
    return new;
  end if;

  -- 下面全部是老逻辑：昵称优先取注册时填的 username，没填退回邮箱前缀
  raw_name := coalesce(new.raw_user_meta_data ->> 'username', '');
  if btrim(raw_name) = '' then
    raw_name := split_part(coalesce(new.email, ''), '@', 1);
  end if;

  base_name := regexp_replace(raw_name, '[[:space:]]', '', 'g');
  base_name := regexp_replace(base_name, '[<>"&/\\\\;%*@]', '', 'g');
  base_name := btrim(left(base_name, 16));

  if char_length(base_name) < 3 then
    base_name := 'user_' || tail;
  end if;

  begin
    insert into public.profiles (id, username) values (new.id, base_name);
  exception when unique_violation or check_violation then
    -- 撞名或命中保留字（admin 之类）：加 4 位后缀再来一次
    final_name := left(base_name, 10) || '_' || tail;
    begin
      insert into public.profiles (id, username) values (new.id, final_name);
    exception when others then
      insert into public.profiles (id, username)
      values (new.id, 'user_' || substr(md5(random()::text), 1, 8));
    end;
  end;

  return new;
end;
$fn$;

-- 触发器在 01 里已经建好，这里不用重建

-- ---------- 4. 游客号不能改资料 ----------
-- 列级授权管不到"哪一行"，所以用 RLS 把游客挡在外面：
-- 他们仍然能读自己的资料，只是 update 影响 0 行。
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and not is_guest)
  with check (id = (select auth.uid()) and not is_guest);

-- ---------- 5. 我的资料：多返回 is_guest ----------
drop function if exists public.gb_my_profile();

create function public.gb_my_profile()
returns table (
  username     text,
  bio          text,
  trust_level  smallint,
  is_banned    boolean,
  banned_until timestamptz,
  ban_reason   text,
  is_guest     boolean,
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
         coalesce(p.is_banned or p.banned_until > now(), false) as is_banned,
         p.banned_until,
         p.ban_reason,
         p.is_guest,
         p.created_at
  from public.profiles p
  where p.id = (select auth.uid());
$fn$;

revoke all on function public.gb_my_profile() from public, anon;
grant execute on function public.gb_my_profile() to authenticated;

-- ---------- 6. 站长：用户列表（加游客标记） ----------
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
  is_guest     boolean,
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
           coalesce(p.is_banned or p.banned_until > now(), false) as is_banned,
           p.banned_until,
           p.ban_reason,
           p.is_guest,
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
--   1) 匿名登录（前端点「以游客身份进入」）后，profiles 里应多出一行
--      username = 游客2001、is_guest = true，再点一次是 游客2002；
--   2) 用游客号改昵称 → 不报错但值不变（RLS 挡掉，影响 0 行）；
--   3) 后台用户列表游客行能看到「游客」标签，封号 / 立即解封照常可用；
--   4) 有邮箱的老账号注册流程完全不受影响。
--
-- ⚠ 前置条件（Supabase 控制台，一次性）：
--   Authentication → Sign In / Providers → Anonymous sign-ins → 打开。
--   不打开的话前端点「以游客身份进入」会报 anonymous_provider_disabled。
--
-- ⚠ 这一层管的是"谁能拿到下载入口"，不是"谁能拿到文件"：
--   data/downloads.json 是公开文件，懂行的人照样能扒出 COS 直链。
--   要真正锁死文件，得把 COS 桶改成私有读 + 用签名 URL，那是另一件事。
