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

-- J. 站长两步验证（06_admin_mfa.sql 之后）
-- 第一列要表存在才算过；如果报 relation "private.admin_mfa_required" does not exist，
-- 就是 06 还没执行。
select has_table_privilege('anon', 'private.admin_mfa_required', 'select')            as anon_read_mfa_table,  -- f
       has_function_privilege('anon', 'public.gb_admin_mfa_activate()', 'execute')     as anon_activate_mfa,    -- f
       (select count(*) from private.admin_mfa_required)                              as mfa_enforced_admins;  -- 站长开了就是 1

-- 附：强制名单是谁
select r.user_id, u.email, r.activated_at
from private.admin_mfa_required r
left join auth.users u on u.id = r.user_id;

-- K. 资料表的信任 / 限制标记是否还对客户端开放（07_hide_profile_flags.sql 之后）
-- 前四列要全为 f；username / bio 必须是 t，否则留言板和个人主页会白屏。
-- 报 function does not exist 就是 07 还没执行。
select has_column_privilege('anon',          'public.profiles', 'trust_level', 'select') as anon_read_trust,      -- f
       has_column_privilege('anon',          'public.profiles', 'is_banned',   'select') as anon_read_ban,        -- f
       has_column_privilege('authenticated', 'public.profiles', 'trust_level', 'select') as user_read_trust,      -- f
       has_column_privilege('authenticated', 'public.profiles', 'is_banned',   'select') as user_read_ban,        -- f
       has_column_privilege('anon',          'public.profiles', 'username',    'select') as anon_read_name,       -- t
       has_column_privilege('authenticated', 'public.profiles', 'username',    'select') as user_read_name,       -- t
       has_column_privilege('authenticated', 'public.profiles', 'bio',         'select') as user_read_bio,        -- t
       has_function_privilege('anon',          'public.gb_my_profile()',  'execute')      as anon_call_my_profile,   -- f
       has_function_privilege('authenticated', 'public.gb_my_profile()',  'execute')      as user_call_my_profile,   -- t
       has_function_privilege('anon',          'public.gb_admin_users()', 'execute')      as anon_call_admin_users;  -- f

-- L. 站长一键重置密码（08_admin_reset_password.sql 之后）
-- anon 应为 f、authenticated 应为 t。报 function does not exist 就是 08 还没执行。
select has_function_privilege('anon',          'public.gb_admin_reset_password(uuid, text)', 'execute') as anon_call_reset,  -- f
       has_function_privilege('authenticated', 'public.gb_admin_reset_password(uuid, text)', 'execute') as user_call_reset;  -- t

-- M. 定时封号（09_ban_until.sql 之后）
-- anon 应全为 f，authenticated 应全为 t。
-- 报 function does not exist 就是 09 还没执行。
select has_function_privilege('anon',          'public.gb_ban_user(uuid, integer, text)', 'execute') as anon_call_ban,    -- f
       has_function_privilege('authenticated', 'public.gb_ban_user(uuid, integer, text)', 'execute') as user_call_ban,    -- t
       has_function_privilege('anon',          'public.gb_unban_user(uuid)',              'execute') as anon_call_unban,  -- f
       has_function_privilege('authenticated', 'public.gb_unban_user(uuid)',              'execute') as user_call_unban;  -- t

-- banned_until / ban_reason 是封号用的两列，客户端一律读不到（走 gb_my_profile）。
-- 报 column does not exist 就是 09 还没执行。
select has_column_privilege('anon',          'public.profiles', 'banned_until', 'select') as anon_read_until,   -- f
       has_column_privilege('authenticated', 'public.profiles', 'banned_until', 'select') as user_read_until,   -- f
       has_column_privilege('anon',          'public.profiles', 'ban_reason',   'select') as anon_read_reason,  -- f
       has_column_privilege('authenticated', 'public.profiles', 'ban_reason',   'select') as user_read_reason;  -- f

-- N. 游客通行证（10_guest_pass.sql 之后）
-- is_guest 不该对客户端开放；序列也只给 security definer 触发器用。
select has_column_privilege('anon',          'public.profiles', 'is_guest', 'select')            as anon_read_guest,  -- f
       has_column_privilege('authenticated', 'public.profiles', 'is_guest', 'select')            as user_read_guest,  -- f
       has_sequence_privilege('anon',          'public.guest_no_seq', 'usage')                   as anon_use_seq,     -- f
       has_sequence_privilege('authenticated', 'public.guest_no_seq', 'usage')                   as user_use_seq;     -- f

-- 资料更新策略应只剩"本人且不是游客"这一条
select polname, pg_get_expr(polqual, polrelid) as using_expr
from pg_policy
where polrelid = 'public.profiles'::regclass;

-- 现有的游客编号排到多少了（执行 10 之前这个查询会报错，属正常）
select last_value, is_called from public.guest_no_seq;

