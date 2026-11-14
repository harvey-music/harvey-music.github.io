-- ============================================================
-- 文件 05：堵住 messages.author_ip / author_ua 被客户端读走的漏洞
--
-- 背景（实测确认）：
--   02_policies.sql 给 anon / authenticated 的是「表级」select，
--   而 RLS 只过滤行、不过滤列。于是任何人拿着前端那份公开 key
--   请求 /rest/v1/messages?select=author_ip,author_ua 就能把
--   所有公开留言的 IP 和浏览器 UA 全部读走，返回 200。
--
-- 修法：
--   1) messages 的 select 收窄成「列级」授权，只放前端真正用到的列；
--   2) 站长要看 IP 走 public.gb_admin_posts()（security definer，
--      函数内部再判一次 private.is_admin()）。这样 IP 不再出现在
--      任何客户端可读的列上，只有站长本人能通过函数拿到。
--
-- 可重复执行。执行完再跑一遍 99_verify.sql 的 I 段确认全为 f。
-- ============================================================

-- ---------- 1. select 收窄为列级 ----------
-- insert 与 update(status) 的授权不受影响，仍在 02_policies.sql 里。
revoke select on table public.messages from anon, authenticated;

grant select (id, body, status, created_at, published_at, author_id)
  on table public.messages to anon, authenticated;

-- ---------- 2. 站长专用：带 IP 的留言列表 ----------
-- 非站长调用会直接报错，而不是返回 0 行 —— 出错比"看起来空了"更好排查。
create or replace function public.gb_admin_posts(p_status text default null)
returns table (
  id           bigint,
  body         text,
  status       text,
  created_at   timestamptz,
  published_at timestamptz,
  author_id    uuid,
  username     text,
  author_ip    text
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
    select m.id,
           m.body,
           m.status,
           m.created_at,
           m.published_at,
           m.author_id,
           p.username,
           coalesce(m.author_ip::text, '')
    from public.messages m
    left join public.profiles p on p.id = m.author_id
    where p_status is null or m.status = p_status
    order by m.created_at desc
    limit 200;
end;
$fn$;

-- 函数默认对 PUBLIC 开放执行权，先收回再只给登录用户（函数内还有一道判权）
revoke all on function public.gb_admin_posts(text) from public, anon;
grant execute on function public.gb_admin_posts(text) to authenticated;

-- 让 PostgREST 立刻刷新表结构与函数缓存
notify pgrst, 'reload schema';

-- 执行完毕后：
--   1. 浏览器硬刷新 admin.html，后台仍能看到 IP（走 RPC）；
--   2. 跑 99_verify.sql 第 I 段，四列应全为 f。
