/* ============================================================
   站长后台：审核留言 / 管理用户
   —— 所有操作都走数据库 RPC，函数内部再判一次 private.is_admin()；
      前端把按钮藏起来只是体验问题，不是安全边界。
   —— 非站长打开本页：写操作会返回"仅站长可以执行该操作"，
      列表也只能读到自己有权读的那几行。
   ============================================================ */
(function (window, document) {
  'use strict';

  if (!window.SiteCore) return;
  var core = window.SiteCore;

  var gateEl = document.querySelector('[data-admin-gate]');
  var bodyEl = document.querySelector('[data-admin-body]');
  var pendingList = document.querySelector('[data-pending-list]');
  var allList = document.querySelector('[data-all-list]');
  var userList = document.querySelector('[data-user-list]');
  var msgEl = document.querySelector('[data-admin-msg]');

  var sb = null;
  try {
    sb = core.getClient();
  } catch (err) {
    setMsg(err.message, 'error');
    return;
  }

  var isAdmin = false;
  var currentUser = null;

  function setMsg(text, kind) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.className = 'form-msg' + (kind ? ' is-' + kind : '');
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /* ---------- 审核动作 ---------- */
  function review(id, action, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '处理中…'; }
    sb.rpc('gb_review', { p_message_id: id, p_action: action }).then(function (res) {
      if (btn) btn.disabled = false;
      if (res.error) {
        setMsg('操作失败：' + core.errorText(res.error), 'error');
        return;
      }
      setMsg(action === 'publish' ? '已放行。' : action === 'reject' ? '已拒绝。' : '已删除。', 'ok');
      refresh();
    });
  }

  function setTrust(userId, level, btn) {
    if (btn) btn.disabled = true;
    sb.rpc('gb_set_trust', { p_user: userId, p_level: level }).then(function (res) {
      if (btn) btn.disabled = false;
      if (res.error) { setMsg('操作失败：' + core.errorText(res.error), 'error'); return; }
      setMsg(level >= 1 ? '已设为信任用户，之后的留言直接公开。' : '已取消信任。', 'ok');
      loadUsers();
    });
  }

  function setBan(userId, banned, btn) {
    if (btn) btn.disabled = true;
    sb.rpc('gb_set_ban', { p_user: userId, p_banned: banned }).then(function (res) {
      if (btn) btn.disabled = false;
      if (res.error) { setMsg('操作失败：' + core.errorText(res.error), 'error'); return; }
      setMsg(banned ? '已限制该账号发言。' : '已解除限制。', 'ok');
      loadUsers();
    });
  }

  /* ---------- 一条留言 + 操作按钮 ---------- */
  function renderPost(row) {
    var GB = window.GBUI;
    if (!GB) return el('li', 'gb-item', '渲染脚本没加载成功，请刷新页面。');

    var li = GB.renderItem(row, {});
    var actions = el('div', 'adm-actions');

    if (row.status !== 'published') {
      var ok = el('button', 'btn btn-primary btn--sm', '放行');
      ok.type = 'button';
      ok.addEventListener('click', function () { review(row.id, 'publish', ok); });
      actions.appendChild(ok);
    }

    if (row.status === 'pending') {
      var no = el('button', 'btn btn-ghost btn--sm', '拒绝');
      no.type = 'button';
      no.addEventListener('click', function () { review(row.id, 'reject', no); });
      actions.appendChild(no);
    }

    if (row.status !== 'deleted') {
      var del = el('button', 'btn btn--danger btn--sm', '删除');
      del.type = 'button';
      del.addEventListener('click', function () {
        if (!window.confirm('确定删除这条留言？前台不再显示，正文仍保留在库里备查。')) return;
        review(row.id, 'delete', del);
      });
      actions.appendChild(del);
    }

    var meta = el('p', 'adm-meta');
    meta.textContent = '#' + row.id + (row.author_ip ? ' · IP ' + row.author_ip : '');

    // li 是两列网格（头像 + 正文），操作区要挂在正文那一列里，否则会掉进 40px 的头像列
    var body = li.lastElementChild;
    if (body) {
      body.appendChild(actions);
      body.appendChild(meta);
    }
    return li;
  }

  function fillList(node, rows, emptyText) {
    if (!node) return;
    node.innerHTML = '';
    if (!rows.length) {
      node.appendChild(el('li', 'gb-empty', emptyText));
      return;
    }
    rows.forEach(function (row) { node.appendChild(renderPost(row)); });
  }

  /* ---------- 数据加载 ---------- */
  // author_ip 已经不对客户端开放（列级授权，见 db/05_fix_ip_leak.sql），
  // 所以站长列表改走 gb_admin_posts()：security definer 函数内部判权，
  // 只有站长能拿到带 IP 的结果。
  // 万一 05 还没执行（函数不存在），自动降级为直接读表 —— 功能照旧，只是没有 IP。
  var FIELDS = 'id,body,status,created_at,author_id,profiles!messages_author_fkey(username)';

  function loadPosts() {
    sb.rpc('gb_admin_posts').then(function (res) {
      if (res.error) {
        loadPostsFallback();
        return;
      }

      // RPC 返回的是扁平行（username 在顶层），而渲染器要 profiles.username
      var rows = (res.data || []).map(function (r) {
        return {
          id: r.id,
          body: r.body,
          status: r.status,
          created_at: r.created_at,
          published_at: r.published_at,
          author_id: r.author_id,
          author_ip: r.author_ip,
          profiles: { username: r.username }
        };
      });

      var pending = rows.filter(function (r) { return r.status === 'pending'; });
      // 待审队列按「先来先审」排，全部列表按最新在前
      pending.sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });

      fillList(pendingList, pending, '没有待审留言。');
      fillList(allList, rows, '还没有留言。');
    });
  }

  function loadPostsFallback() {
    sb.from('messages')
      .select(FIELDS)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50)
      .then(function (res) {
        if (res.error) {
          setMsg('待审列表读取失败：' + core.errorText(res.error), 'error');
          return;
        }
        fillList(pendingList, res.data || [], '没有待审留言。');
      });

    sb.from('messages')
      .select(FIELDS)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(function (res) {
        if (res.error) {
          setMsg('留言列表读取失败：' + core.errorText(res.error), 'error');
          return;
        }
        fillList(allList, res.data || [], '还没有留言。');
      });
  }

  function loadUsers() {
    if (!userList) return;

    sb.from('profiles')
      .select('id,username,trust_level,is_banned,created_at')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(function (res) {
        userList.innerHTML = '';

        if (res.error) {
          userList.appendChild(el('p', 'gb-empty', '用户列表读取失败：' + core.errorText(res.error)));
          return;
        }

        var rows = res.data || [];
        if (!rows.length) {
          userList.appendChild(el('p', 'gb-empty', '还没有用户。'));
          return;
        }

        rows.forEach(function (u) {
          var row = el('div', 'adm-user');

          var av = el('span', 'gb-avatar', core.firstChar(u.username));
          av.style.setProperty('--gb-hue', core.hueOf(u.username));

          var main = el('div', 'adm-user-main');
          main.appendChild(el('div', 'adm-user-name', u.username));
          main.appendChild(el('div', 'adm-user-sub',
            '注册于 ' + core.fmtTime(u.created_at).slice(0, 10) +
            (u.id === (currentUser && currentUser.id) ? ' · 这是你自己' : '')));

          var actions = el('div', 'adm-actions');
          if (u.trust_level >= 1) actions.appendChild(el('span', 'adm-tag adm-tag--ok', '信任'));
          if (u.is_banned) actions.appendChild(el('span', 'adm-tag adm-tag--warn', '已限制'));

          var isSelf = u.id === (currentUser && currentUser.id);

          var trustBtn = el('button', 'btn btn-ghost btn--sm', u.trust_level >= 1 ? '取消信任' : '信任此人');
          trustBtn.type = 'button';
          trustBtn.disabled = isSelf;
          trustBtn.addEventListener('click', function () {
            setTrust(u.id, u.trust_level >= 1 ? 0 : 1, trustBtn);
          });

          var banBtn = el('button', 'btn btn--danger btn--sm', u.is_banned ? '解除限制' : '限制发言');
          banBtn.type = 'button';
          banBtn.disabled = isSelf;
          banBtn.addEventListener('click', function () {
            setBan(u.id, !u.is_banned, banBtn);
          });

          actions.appendChild(trustBtn);
          actions.appendChild(banBtn);

          row.appendChild(av);
          row.appendChild(main);
          row.appendChild(actions);
          userList.appendChild(row);
        });
      });
  }

  function refresh() {
    loadPosts();
    loadUsers();
  }

  /* ---------- 权限门 ---------- */
  function showGate(text) {
    isAdmin = false;
    if (bodyEl) bodyEl.hidden = true;
    if (gateEl) {
      gateEl.hidden = false;
      var slot = gateEl.querySelector('[data-gate-text]');
      if (slot && text) slot.textContent = text;
    }
  }

  function showApp() {
    isAdmin = true;
    if (gateEl) gateEl.hidden = true;
    if (bodyEl) bodyEl.hidden = false;
    refresh();
  }

  /* ---------- 判权 ----------
     每次都重新查 public.user_roles（RLS 允许读自己那一行），
     不依赖 JWT 里可能过期的自定义声明。 */
  var booting = false;

  function boot() {
    if (booting) return;
    booting = true;

    core.session().then(function (s) {
      if (!s || !s.user) {
        booting = false;
        currentUser = null;
        showGate('这个页面需要先登录。');
        return;
      }

      currentUser = s.user;

      sb.from('user_roles')
        .select('role')
        .eq('user_id', s.user.id)
        .then(function (res) {
          booting = false;

          if (res.error) {
            showGate('读取权限失败：' + core.errorText(res.error));
            return;
          }

          var roles = (res.data || []).map(function (r) { return r.role; });

          if (roles.indexOf('admin') === -1) {
            showGate('当前账号（' + (s.user.email || '') + '）不是站长，没有审核权限。');
            return;
          }

          showApp();
        });
    }).catch(function () {
      booting = false;
      showGate('读取登录状态失败，请刷新页面重试。');
    });
  }

  boot();

  /* ---------- 登录态变化：重新判权，绝不刷新整页 ----------
     *** 这里绝对不能 window.location.reload() ***
     supabase-js 初始化时会派发一次登录事件，reload 之后事件又会来一次，
     于是 reload → 事件 → reload 死循环；表现就是页面狂闪、按钮点不动。
     首次回调（INITIAL_SESSION）已经由上面的 boot() 处理，这里直接跳过。 */
  var authSeen = false;

  core.onAuthChange(function (s, event) {
    if (!authSeen) { authSeen = true; return; }
    if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;

    if (event === 'SIGNED_OUT' || !s || !s.user) {
      currentUser = null;
      showGate('这个页面需要先登录。');
      return;
    }

    boot();
  });
})(window, document);
