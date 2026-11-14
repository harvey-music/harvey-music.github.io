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

  /* ---------- 封号 / 解封 ----------
     时长写进 profiles.banned_until，数据库里用 banned_until > now() 判断，
     到点自动失效，不需要任何定时任务 / 云函数。这里只负责把分钟数递过去。 */
  var banDialog = document.querySelector('[data-ban-dialog]');
  var banForm = document.querySelector('[data-ban-form]');
  var banTargetEl = document.querySelector('[data-ban-target]');
  var banMsgEl = document.querySelector('[data-ban-msg]');
  var banCancelBtn = document.querySelector('[data-ban-cancel]');
  var banUser = null;

  function banSay(text, kind) {
    if (!banMsgEl) return;
    banMsgEl.textContent = text || '';
    banMsgEl.className = 'form-msg' + (kind ? ' is-' + kind : '');
  }

  function closeBanDialog() {
    banUser = null;
    if (!banDialog) return;
    if (typeof banDialog.close === 'function') banDialog.close();
    else banDialog.removeAttribute('open');
  }

  function openBanDialog(u) {
    if (!banDialog || !banForm) return;
    banUser = u;
    banForm.reset();

    var input = banForm.querySelector('input[name="minutes"]');
    if (input) input.value = 60;

    if (banTargetEl) {
      banTargetEl.textContent = '正在封禁「' + u.username + '」' +
        (u.email ? '（' + u.email + '）' : '') + '。';
    }
    banSay('');

    if (typeof banDialog.showModal === 'function') banDialog.showModal();
    else banDialog.setAttribute('open', '');

    if (input) { input.focus(); input.select(); }
  }

  // 剩余时间写成「剩 2 天 3 小时」，不用自己换算时间戳
  function banLeft(until) {
    var ms = new Date(until).getTime() - Date.now();
    if (!(ms > 0)) return '已到期';
    var mins = Math.ceil(ms / 60000);
    if (mins < 60) return '剩 ' + mins + ' 分钟';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return '剩 ' + hours + ' 小时' + (mins % 60 ? ' ' + (mins % 60) + ' 分钟' : '');
    var days = Math.floor(hours / 24);
    return '剩 ' + days + ' 天' + (hours % 24 ? ' ' + (hours % 24) + ' 小时' : '');
  }

  function unban(u, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '处理中…'; }
    sb.rpc('gb_unban_user', { p_user: u.id }).then(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = '立即解封'; }
      if (res.error) { setMsg('操作失败：' + core.errorText(res.error), 'error'); return; }
      setMsg('已解除「' + u.username + '」的封禁。', 'ok');
      loadUsers();
    });
  }

  if (banCancelBtn) banCancelBtn.addEventListener('click', closeBanDialog);

  if (banDialog) {
    // Esc / 点遮罩关闭时把待操作对象一起清掉，避免下次误封
    banDialog.addEventListener('close', function () { banUser = null; });
    banDialog.addEventListener('click', function (e) {
      if (e.target === banDialog) closeBanDialog();
    });
  }

  // 快捷时长按钮只改输入框，不提交
  var banQuick = document.querySelector('[data-ban-quick]');
  if (banQuick) {
    banQuick.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-min]');
      if (!btn || !banForm) return;
      var input = banForm.querySelector('input[name="minutes"]');
      if (input) input.value = btn.getAttribute('data-min');
    });
  }

  if (banForm) {
    banForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!banUser) return;

      var input = banForm.querySelector('input[name="minutes"]');
      var minutes = parseInt(input ? input.value : '', 10);
      if (!(minutes >= 1 && minutes <= 43200)) {
        banSay('时长要在 1 到 43200 分钟之间（最长 30 天）。', 'error');
        return;
      }

      var reasonEl = banForm.querySelector('input[name="reason"]');
      var reason = reasonEl ? reasonEl.value.trim() : '';
      var btn = banForm.querySelector('[data-ban-submit]');
      var name = banUser.username;
      var targetId = banUser.id;

      if (btn) { btn.disabled = true; btn.textContent = '正在封号…'; }
      banSay('正在封号…');

      sb.rpc('gb_ban_user', {
        p_user: targetId,
        p_minutes: minutes,
        p_reason: reason || null
      }).then(function (res) {
        if (res.error) throw res.error;
        var until = res.data ? core.fmtTime(res.data) : '';
        closeBanDialog();
        setMsg('已封禁「' + name + '」' + (until ? '至 ' + until : '') + '。', 'ok');
        loadUsers();
      }).catch(function (err) {
        banSay('封号失败：' + errText(err), 'error');
      }).then(function () {
        if (btn) { btn.disabled = false; btn.textContent = '确认封号'; }
      });
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

    // 07 之后 trust_level / is_banned 不再对表开放，站长列表走 RPC
    Promise.resolve(sb.rpc('gb_admin_users')).then(function (res) {
      if (res.error) {
        var code = res.error.code || '';
        var text = String(res.error.message || '');
        // 只有「函数不存在」（07 还没执行）才降级；其他错误如实显示
        if (code === 'PGRST202' || /could not find the function|does not exist/i.test(text)) {
          loadUsersFallback();
          return;
        }
        userList.innerHTML = '';
        userList.appendChild(el('p', 'gb-empty', '用户列表读取失败：' + core.errorText(res.error)));
        return;
      }
      renderUsers(res.data || []);
    });
  }

  /* 07 没执行时（函数不存在）退回直读表：功能照旧，只是那两列还没收窄 */
  function loadUsersFallback() {
    sb.from('profiles')
      .select('id,username,trust_level,is_banned,banned_until,created_at')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(function (res) {
        if (res.error) {
          userList.innerHTML = '';
          userList.appendChild(el('p', 'gb-empty', '用户列表读取失败：' + core.errorText(res.error)));
          return;
        }
        renderUsers(res.data || []);
      });
  }

  function renderUsers(rows) {
    userList.innerHTML = '';

    if (!rows.length) {
      userList.appendChild(el('p', 'gb-empty', '还没有用户。'));
      return;
    }

    rows.forEach(function (u) {
      var row = el('div', 'adm-user');
      var isSelf = u.id === (currentUser && currentUser.id);

      var av = el('span', 'gb-avatar', core.firstChar(u.username));
      av.style.setProperty('--gb-hue', core.hueOf(u.username));

      var main = el('div', 'adm-user-main');
      main.appendChild(el('div', 'adm-user-name', u.username));

      var sub = '注册于 ' + core.fmtTime(u.created_at).slice(0, 10);
      if (u.email) sub += ' · ' + u.email;
      if (isSelf) sub += ' · 这是你自己';
      if (u.is_banned) {
        sub += u.banned_until
          ? ' · 封禁至 ' + core.fmtTime(u.banned_until) + '（' + banLeft(u.banned_until) + '）'
          : ' · 永久限制发言';
      }
      main.appendChild(el('div', 'adm-user-sub', sub));

      var actions = el('div', 'adm-actions');
      if (u.is_guest) actions.appendChild(el('span', 'adm-tag', '游客'));
      if (u.trust_level >= 1) actions.appendChild(el('span', 'adm-tag adm-tag--ok', '信任'));
      if (u.is_banned) {
        actions.appendChild(el('span', 'adm-tag adm-tag--warn',
          u.banned_until ? '封禁中' : '永久限制'));
      }

      var trustBtn = el('button', 'btn btn-ghost btn--sm', u.trust_level >= 1 ? '取消信任' : '信任此人');
      trustBtn.type = 'button';
      trustBtn.disabled = isSelf;
      trustBtn.addEventListener('click', function () {
        setTrust(u.id, u.trust_level >= 1 ? 0 : 1, trustBtn);
      });

      var banBtn;
      if (u.is_banned) {
        banBtn = el('button', 'btn btn--danger btn--sm', '立即解封');
        banBtn.type = 'button';
        banBtn.disabled = isSelf;
        banBtn.addEventListener('click', function () { unban(u, banBtn); });
      } else {
        banBtn = el('button', 'btn btn--danger btn--sm', '封号');
        banBtn.type = 'button';
        banBtn.disabled = isSelf;
        banBtn.addEventListener('click', function () { openBanDialog(u); });
      }

      var resetBtn = el('button', 'btn btn-ghost btn--sm', '重置密码');
      resetBtn.type = 'button';
      resetBtn.addEventListener('click', function () {
        openResetDialog(u, isSelf);
      });

      actions.appendChild(trustBtn);
      actions.appendChild(banBtn);
      actions.appendChild(resetBtn);

      row.appendChild(av);
      row.appendChild(main);
      row.appendChild(actions);
      userList.appendChild(row);
    });
  }

  /* ---------- 重置用户密码 ----------
     本站不发邮件，Supabase 控制台的 Reset password（那一步是发信）用不了。
     改成站长在后台直接设一个临时密码（RPC: gb_admin_reset_password），
     函数内部会清掉对方所有 auth.sessions —— 旧登录态立刻失效。 */
  var resetDialog = document.querySelector('[data-reset-dialog]');
  var resetForm = document.querySelector('[data-reset-form]');
  var resetTargetEl = document.querySelector('[data-reset-target]');
  var resetMsgEl = document.querySelector('[data-reset-msg]');
  var resetCancelBtn = document.querySelector('[data-reset-cancel]');
  var resetUser = null;
  var resetIsSelf = false;

  function resetSay(text, kind) {
    if (!resetMsgEl) return;
    resetMsgEl.textContent = text || '';
    resetMsgEl.className = 'form-msg' + (kind ? ' is-' + kind : '');
  }

  // 12 位随机临时密码：去掉 0/O/1/l/I 这类容易看错的字符
  function genPassword(n) {
    var chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var out = '';
    var i;
    if (window.crypto && window.crypto.getRandomValues) {
      var buf = new Uint32Array(n);
      window.crypto.getRandomValues(buf);
      for (i = 0; i < n; i++) out += chars.charAt(buf[i] % chars.length);
      return out;
    }
    for (i = 0; i < n; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
  }

  function closeResetDialog() {
    if (!resetDialog) return;
    if (typeof resetDialog.close === 'function') resetDialog.close();
    else resetDialog.removeAttribute('open');
  }

  function openResetDialog(u, isSelf) {
    if (!resetDialog || !resetForm) return;
    resetUser = u;
    resetIsSelf = !!isSelf;

    var input = resetForm.querySelector('input[name="password"]');
    if (input) input.value = genPassword(12);

    if (resetTargetEl) {
      resetTargetEl.textContent = '正在为「' + u.username + '」' +
        (u.email ? '（' + u.email + '）' : '') + '设置临时密码。';
    }
    resetSay('');

    if (typeof resetDialog.showModal === 'function') resetDialog.showModal();
    else resetDialog.setAttribute('open', '');

    if (input) { input.focus(); input.select(); }
  }

  if (resetCancelBtn) {
    resetCancelBtn.addEventListener('click', closeResetDialog);
  }

  if (resetForm) {
    resetForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!resetUser) return;

      var input = resetForm.querySelector('input[name="password"]');
      var pwd = input ? input.value.trim() : '';
      if (pwd.length < 8) {
        resetSay('临时密码至少 8 位。', 'error');
        return;
      }

      var btn = resetForm.querySelector('[data-reset-submit]');
      if (btn) { btn.disabled = true; btn.textContent = '正在重置…'; }
      resetSay('正在重置…');

      sb.rpc('gb_admin_reset_password', { p_user_id: resetUser.id, p_new_password: pwd })
        .then(function (res) {
          if (res.error) throw res.error;

          var tip = '已重置。把这一串发给对方：' + pwd;
          if (resetIsSelf) tip += '（这是你自己，当前登录会被踢下线，用新密码重新登录即可）';
          resetSay(tip, 'ok');
          setMsg('已重置「' + resetUser.username + '」的密码。', 'ok');

          if (!resetIsSelf) loadUsers();
        })
        .catch(function (err) {
          resetSay('重置失败：' + errText(err), 'error');
        })
        .then(function () {
          if (btn) { btn.disabled = false; btn.textContent = '确认重置'; }
        });
    });
  }

  function refresh() {
    loadPosts();
    loadUsers();
  }

  /* ---------- 两步验证 ----------
     前端这道门只是体验：开启强制之后，数据库里的 private.is_admin()
     在 JWT 没有 aal2 时会直接返回 false，审核 / 封人 / 看 IP 的 RPC
     全部会被拒绝 —— 绕开本页手搓请求也一样。

     aal2 ＝ 本次登录真的过了一遍验证器。三种组合：
       aal2 / 任意   → 已验证，直接进后台
       aal1 / aal2   → 绑过验证器，只差输入 6 位数字
       aal1 / null   → 还没绑过，走扫码绑定
  ------------------------------------ */
  var mfaEl = document.querySelector('[data-mfa]');
  var mfaTextEl = document.querySelector('[data-mfa-text]');
  var mfaMsgEl = document.querySelector('[data-mfa-msg]');
  var mfaHelpEl = document.querySelector('[data-mfa-help]');
  var mfaVerifyEl = document.querySelector('[data-mfa-verify]');
  var mfaEnrollEl = document.querySelector('[data-mfa-enroll]');
  var mfaEnrollForm = document.querySelector('[data-mfa-enroll-form]');
  var mfaFactorId = null;

  function mfaSay(text, kind) {
    if (!mfaMsgEl) return;
    mfaMsgEl.textContent = text || '';
    mfaMsgEl.className = 'form-msg' + (kind ? ' is-' + kind : '');
  }

  function mfaHintText(text) {
    if (mfaTextEl && text) mfaTextEl.textContent = text;
  }

  // view: 'verify' | 'enroll' | 'broken'
  function mfaPanel(view) {
    if (gateEl) gateEl.hidden = true;
    if (bodyEl) bodyEl.hidden = true;
    if (mfaEl) mfaEl.hidden = false;
    if (mfaVerifyEl) mfaVerifyEl.hidden = view !== 'verify';
    if (mfaEnrollEl) mfaEnrollEl.hidden = view !== 'enroll';
    if (mfaHelpEl) mfaHelpEl.hidden = view !== 'verify';
    if (view !== 'broken') mfaSay('');
  }

  function mfaCall(method, arg) {
    var api = sb && sb.auth && sb.auth.mfa;
    if (!api || typeof api[method] !== 'function') {
      return Promise.reject(new Error('当前 supabase-js 版本不支持两步验证，请更新 vendor/supabase.js'));
    }
    return Promise.resolve(api[method](arg));
  }

  // qr_code 是一段 <svg>…</svg>：转成 data URI 塞进 <img>，
  // 不把接口返回的字符串当 HTML 插进页面。
  function svgDataUri(svg) {
    if (!svg) return '';
    if (svg.indexOf('data:') === 0) return svg; // 有的版本直接给 data URI
    try {
      return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    } catch (err) {
      return '';
    }
  }

  function errText(err) {
    return core.errorText ? core.errorText(err) : String((err && err.message) || err || '未知错误');
  }

  /* 绑定成功后写下「该账号已启用强制」。函数内部要求 aal2，
     所以只有密码的人写不进去，也就关不掉这个开关。
     06 还没执行时这里会 404，忽略即可，不影响进后台。 */
  function activateMfa() {
    return Promise.resolve(sb.rpc('gb_admin_mfa_activate'))
      .then(function () {}, function () {});
  }

  function showMfaBroken(err) {
    mfaPanel('broken');
    var text = errText(err);
    var extra = /disabled|not enabled|unsupported|mfa/i.test(text)
      ? ' 先去 Supabase 控制台 Authentication → Sign In / Providers → Multi-Factor Authentication 启用 TOTP，再刷新本页。'
      : '';
    mfaHintText('两步验证没有准备好，暂时进不去后台。');
    mfaSay('原因：' + text + extra, 'error');
  }

  function showMfaVerify() {
    mfaPanel('verify');
    mfaHintText('这个账号已经绑过验证器。输入 App 上的 6 位数字继续。');
    var input = mfaVerifyEl && mfaVerifyEl.querySelector('input[name="code"]');
    if (input) input.focus();
  }

  function startEnroll() {
    mfaPanel('enroll');
    mfaHintText('第一次使用，先绑定一个验证器。');
    mfaSay('正在生成二维码…');

    // 先把上次没验证完的 factor 清掉，免得二维码越攒越多。
    // unenroll 失败（比如 aal1 下不让删）也不影响继续绑定。
    return mfaCall('listFactors')
      .then(function (list) {
        var all = (list && list.data && list.data.all) || [];
        var stale = all.filter(function (f) { return f.status !== 'verified'; });
        if (!stale.length) return null;
        return Promise.all(stale.map(function (f) {
          return mfaCall('unenroll', { factorId: f.id }).catch(function () {});
        }));
      })
      .then(function () {
        return mfaCall('enroll', { factorType: 'totp', friendlyName: 'Arthur 站长后台' });
      })
      .then(function (res) {
        if (res.error) throw res.error;

        var d = res.data || {};
        var totp = d.totp || {};
        mfaFactorId = d.id || null;

        var img = mfaEl && mfaEl.querySelector('[data-mfa-qr]');
        if (img && totp.qr_code) img.src = svgDataUri(totp.qr_code);

        var secret = mfaEl && mfaEl.querySelector('[data-mfa-secret]');
        if (secret) secret.textContent = totp.secret || '（接口没返回，改用二维码）';

        mfaSay('扫完码，把 App 里显示的 6 位数字填进下面。');
      });
  }

  function gateByMfa() {
    // 老 client 没有 MFA API：交回数据库兜底，别把人挡在门外
    if (!sb.auth || !sb.auth.mfa || typeof sb.auth.mfa.getAuthenticatorAssuranceLevel !== 'function') {
      showApp();
      return;
    }

    mfaCall('getAuthenticatorAssuranceLevel')
      .then(function (res) {
        if (res.error) throw res.error;

        var d = res.data || {};

        if (d.currentLevel === 'aal2') {
          return activateMfa().then(function () { showApp(); });
        }

        if (d.nextLevel === 'aal2') {
          return mfaCall('listFactors').then(function (list) {
            var all = (list && list.data && list.data.all) || [];
            var verified = all.filter(function (f) { return f.status === 'verified'; })[0];
            mfaFactorId = verified ? verified.id : null;
            showMfaVerify();
          });
        }

        return startEnroll();
      })
      .catch(showMfaBroken);
  }

  /* 提交 6 位数字：绑定与日常验证共用一条路 */
  function submitMfaCode(code) {
    if (!mfaFactorId) {
      return Promise.reject(new Error('没有找到验证器，请刷新页面重试'));
    }

    // 新版 supabase-js 一步到位，老版本退回 challenge + verify
    if (typeof sb.auth.mfa.challengeAndVerify === 'function') {
      return mfaCall('challengeAndVerify', { factorId: mfaFactorId, code: code });
    }
    return mfaCall('challenge', { factorId: mfaFactorId }).then(function (res) {
      if (res.error) throw res.error;
      return mfaCall('verify', {
        factorId: mfaFactorId,
        challengeId: res.data && res.data.id,
        code: code
      });
    });
  }

  function bindMfaForm(formEl) {
    if (!formEl) return;

    formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      if (formEl.getAttribute('aria-busy') === 'true') return;

      var input = formEl.querySelector('input[name="code"]');
      var code = String((input && input.value) || '').replace(/\D/g, '');
      if (code.length !== 6) {
        mfaSay('请输入验证器上的 6 位数字。', 'error');
        if (input) input.focus();
        return;
      }

      var btn = formEl.querySelector('button[type="submit"]');
      var label = btn ? btn.textContent : '';

      formEl.setAttribute('aria-busy', 'true');
      if (btn) { btn.disabled = true; btn.textContent = '验证中…'; }
      mfaSay('正在验证…');

      submitMfaCode(code)
        .then(function (res) {
          if (res && res.error) throw res.error;
          mfaSay('验证通过，正在进入后台…', 'ok');
          return activateMfa().then(function () { showApp(); });
        })
        .catch(function (err) {
          mfaSay('验证失败：' + errText(err) + '（验证码 30 秒换一次，注意别输错）', 'error');
          if (input) { input.value = ''; input.focus(); }
        })
        .then(function () {
          formEl.removeAttribute('aria-busy');
          if (btn) { btn.disabled = false; btn.textContent = label; }
        });
    });
  }

  bindMfaForm(mfaVerifyEl);
  bindMfaForm(mfaEnrollForm);

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
    if (mfaEl) mfaEl.hidden = true;
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

          // 是站长，再过一道两步验证（数据库那边也会独立校验一次）
          gateByMfa();
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
