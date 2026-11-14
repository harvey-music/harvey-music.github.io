-- ============================================================
-- 文件 03 / 04：把你自己设成站长（只需执行一次）
-- 前提：已经在 account.html 注册过账号
-- ============================================================

-- 1) 先看一眼最近注册的账号，确认哪一条是你
select u.id,
       u.email,
       u.created_at,
       u.last_sign_in_at,
       p.username,
       (r.user_id is not null) as is_admin
from auth.users u
left join public.profiles p on p.id = u.id
left join public.user_roles r on r.user_id = u.id and r.role = 'admin'
order by u.created_at desc
limit 20;

-- 2) 把下面引号里的邮箱换成你注册用的那个，然后单独执行这一段。
--    注意：本文件会随站点一起公开到 GitHub，别把真实邮箱写死在仓库里。
--    也可以改用文末的 uuid 写法（id 从上面第 1 段的查询结果里抄）。
insert into public.user_roles (user_id, role, granted_by)
select id, 'admin', id
from auth.users
where lower(email) = lower('you@example.com')
on conflict (user_id, role) do nothing;

-- 等价写法：不依赖邮箱，直接用账号 uuid（推荐，不会泄露邮箱）
-- insert into public.user_roles (user_id, role, granted_by)
-- values ('00000000-0000-0000-0000-000000000000', 'admin',
--         '00000000-0000-0000-0000-000000000000')
-- on conflict (user_id, role) do nothing;

-- 3) 确认结果：应该正好返回你那一行 role = admin
select user_id, role, granted_at
from public.user_roles
where role = 'admin';

-- 4) 需要撤掉站长身份时再执行（把 uuid 换成对应账号）
-- delete from public.user_roles
-- where role = 'admin' and user_id = '00000000-0000-0000-0000-000000000000';

-- 提示：角色变更后，旧登录态里的 admin 判断最长 1 小时内仍可能读到缓存，
--       讲台上讲完话记得刷新页面；真正的写操作每次都会重新查表，不存在越权窗口。
