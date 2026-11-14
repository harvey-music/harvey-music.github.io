-- ============================================================
-- 文件 99 / 04：验收自查（只读，不修改任何数据）
-- 01、02 执行完之后跑一遍，逐项对照注释里的"应该是"
-- ============================================================

-- A. RLS 是否五张表全开
select c.relname            as table_name,
       c.relrowsecurity     as rls_on,     -- 全应为 true
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles', 'messages', 'user_roles', 'banned_words', 'moderation_log')
order by c.relname;

-- B. 匿名与登录用户的动作权限
-- 注意：messages 的 select 现在是「列级」授权（05_fix_ip_leak.sql），
--       所以这里的 has_table_privilege 返回 f 才是对的；
--       "哪些列能读"看最后的 I 段。
select has_table_privilege('anon', 'public.messages', 'select')            as anon_select_messages_tbl, -- f（列级授权，正常）
       has_table_privilege('anon', 'public.messages', 'insert')            as anon_insert_messages,    -- f
       has_table_privilege('anon', 'public.user_roles', 'select')          as anon_read_roles,         -- f
       has_table_privilege('anon', 'public.banned_words', 'select')        as anon_read_words,         -- f
       has_table_privilege('authenticated', 'public.messages', 'insert')   as user_insert_messages,    -- t
       has_table_privilege('authenticated', 'public.messages', 'delete')   as user_delete_messages,    -- f
       has_table_privilege('authenticated', 'public.banned_words', 'select') as user_read_words;       -- f

-- C. 列级权限：能改的只有 status / username / bio
select has_column_privilege('authenticated', 'public.messages', 'body', 'update')        as can_edit_body,     -- f
       has_column_privilege('authenticated', 'public.messages', 'status', 'update')      as can_edit_status,   -- t
       has_column_privilege('authenticated', 'public.messages', 'author_id', 'update')    as can_steal_post,    -- f
       has_column_privilege('authenticated', 'public.profiles', 'trust_level', 'update')  as can_self_trust,    -- f
       has_column_privilege('authenticated', 'public.profiles', 'is_banned', 'update')    as can_self_unban,    -- f
       has_column_privilege('authenticated', 'public.profiles', 'username', 'update')     as can_edit_name;     -- t

-- D. 判权函数的执行权
select has_function_privilege('anon', 'private.is_admin()', 'execute')          as anon_check_admin,  -- f
       has_function_privilege('authenticated', 'private.is_admin()', 'execute') as user_check_admin;  -- t

-- E. 策略清单
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- F. 触发器清单
select t.tgname,
       t.tgrelid::regclass as on_table,
       p.proname           as function_name
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
order by on_table::text, t.tgname;

-- G. 站长是谁
select r.user_id, r.role, r.granted_at, u.email
from public.user_roles r
left join auth.users u on u.id = r.user_id
order by r.granted_at;

-- H. 现有留言各状态的条数
select status, count(*) as n
from public.messages
group by status
order by n desc;

-- I. 敏感列是否还在对客户端开放（05_fix_ip_leak.sql 之后应全为 f）
-- 这一段是那条 IP 泄露漏洞的回归检查：只要有一列是 t，就说明补丁没生效。
select has_column_privilege('anon',          'public.messages', 'author_ip', 'select') as anon_read_ip,     -- f
       has_column_privilege('anon',          'public.messages', 'author_ua', 'select') as anon_read_ua,     -- f
       has_column_privilege('authenticated', 'public.messages', 'author_ip', 'select') as user_read_ip,     -- f
       has_column_privilege('authenticated', 'public.messages', 'author_ua', 'select') as user_read_ua,     -- f
       has_column_privilege('anon',          'public.messages', 'body',      'select') as anon_read_body,    -- t
       has_column_privilege('authenticated', 'public.messages', 'body',      'select') as user_read_body,    -- t
       has_function_privilege('anon', 'public.gb_admin_posts(text)', 'execute')        as anon_call_rpc;     -- f
-- 最后一条要求 05 已执行（函数存在），否则会报 function does not exist。
