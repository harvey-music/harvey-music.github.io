/* ============================================================
   账号页：登录 / 注册 / 个人主页
   —— 登录用 Supabase Auth（邮箱 + 密码），全程不发邮件；
   —— 昵称、简介存在 public.profiles，靠 RLS 限制只能改自己的。
   ============================================================ */
(function (window, document) {
  'use strict';

  if (!window.SiteCore) return;
  var core = window.SiteCore;

  var guestPanel = document.querySelector('[data-auth-guest]');
  var userPanel = document.querySelector('[data-auth-user]');
  var guestMsg = document.querySelector('[data-guest-msg]');
  var userMsg = document.querySelector('[data-user-msg]');
  var loginForm = document.querySelector('[data-form-login]');
  var signupForm = document.querySelector('[data-form-signup]');
  var profileForm = document.querySelector('[data-form-profile]');
  var myList = document.querySelector('[data-my-list]');
  var logoutBtn = document.querySelector('[data-action-logout]');

  var sb = null;
  try {
    sb = core.getClient();
  } catch (err) {
    setMsg(guestMsg, err.message, 'error');
    return;
  }

  var currentUser = null;

  function setMsg(node, text, kind) {
    if (!node) return;
    node.textContent = text || '';
    node.className = 'form-msg' + (kind ? ' is-' + kind : '');
  }

  function busy(form, on) {
    if (!form) return;
    var btn = form.querySelector('button[type="submit"]');
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.textContent;
      btn.disabled = true;
      btn.textContent = '处理中…';
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.label || '提交';
    }
  }

  /* ---------- 登录 / 注册切换 ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (tab) {
    tab.addEventListener('click', function () {
      var want = tab.getAttribute('data-tab');
      Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (t) {
        t.classList.toggle('is-active', t === tab);
      });
      if (loginForm) loginForm.hidden = want !== 'login';
      if (signupForm) signupForm.hidden = want !== 'signup';
      setMsg(guestMsg, '');
    });
  });

  /* ---------- 登录 ---------- */
  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = loginForm.elements.email.value.trim();
      var password = loginForm.elements.password.value;

      setMsg(guestMsg, '');
      busy(loginForm, true);

      sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
        busy(loginForm, false);
        if (res.error) {
          setMsg(guestMsg, core.errorText(res.error), 'error');
          return;
        }
        setMsg(guestMsg, '登录成功，正在返回…', 'ok');
        var next = new URLSearchParams(window.location.search).get('next');
        window.location.href = core.safeNext(next, 'account.html');
      });
    });
  }

  /* ---------- 注册 ---------- */
  if (signupForm) {
    signupForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var username = signupForm.elements.username.value.trim();
      var email = signupForm.elements.email.value.trim();
      var password = signupForm.elements.password.value;

      if (username.length < 3 || username.length > 20) {
        setMsg(guestMsg, '昵称要 3–20 个字符', 'error');
        return;
      }
      if (password.length < 8) {
        setMsg(guestMsg, '密码至少 8 位', 'error');
        return;
      }

      setMsg(guestMsg, '');
      busy(signupForm, true);

      sb.auth.signUp({
        email: email,
        password: password,
        options: { data: { username: username } }
      }).then(function (res) {
        busy(signupForm, false);

        if (res.error) {
          setMsg(guestMsg, core.errorText(res.error), 'error');
          return;
        }

        // 站点配置成"不发确认邮件"时，这里会直接带回 session
        if (res.data && res.data.session) {
          setMsg(guestMsg, '注册成功，正在进入你的主页…', 'ok');
          var next = new URLSearchParams(window.location.search).get('next');
          window.location.href = core.safeNext(next, 'account.html');
          return;
        }

        setMsg(guestMsg,
          '账号已创建，但项目的"确认邮件"还开着，而本站不发送邮件。请到 Supabase 控制台关闭 Confirm email 后再登录，或联系站长手动确认。',
          'error');
      });
    });
  }

  /* ---------- 退出登录 ---------- */
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      sb.auth.signOut().then(function () {
        window.location.href = 'index.html';
      });
    });
  }
  /* ---------- 已登录：个人主页 ---------- */
  function showGuest() {
    if (guestPanel) guestPanel.hidden = false;
    if (userPanel) userPanel.hidden = true;
  }

  function fillProfile(user, profile) {
    var name = (profile && profile.username) ? profile.username : '未命名用户';

    var nameEl = document.querySelector('[data-profile-name]');
    if (nameEl) nameEl.textContent = name;

    var av = document.querySelector('[data-profile-avatar]');
    if (av) {
      av.textContent = core.firstChar(name);
      av.style.setProperty('--gb-hue', core.hueOf(name));
    }

    var meta = document.querySelector('[data-profile-meta]');
    if (meta) {
      var parts = [];
      if (user.email) parts.push(user.email);
      if (profile && profile.created_at) parts.push('注册于 ' + core.fmtTime(profile.created_at).slice(0, 10));
      if (profile && profile.trust_level >= 1) parts.push('信任用户');
      if (profile && profile.is_banned) parts.push('已限制发言');
      meta.textContent = parts.join(' · ');
    }

    if (profileForm) {
      profileForm.elements.username.value = name;
      profileForm.elements.bio.value = (profile && profile.bio) || '';
    }
  }

  function withdrawMine(id, btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = '撤回中…';
    sb.from('messages').update({ status: 'withdrawn' }).eq('id', id).then(function (res) {
      if (res.error) {
        btnEl.disabled = false;
        btnEl.textContent = '撤回这条留言';
        setMsg(userMsg, '撤回失败：' + core.errorText(res.error), 'error');
        return;
      }
      setMsg(userMsg, '已撤回。', 'ok');
      loadMine(currentUser);
    });
  }

  function loadMine(user) {
    if (!myList) return;
    myList.innerHTML = '<li class="gb-empty">正在加载…</li>';

    sb.from('messages')
      .select('id,body,status,created_at,author_id,profiles!messages_author_fkey(username)')
      .eq('author_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(function (res) {
        if (res.error) {
          myList.innerHTML = '';
          setMsg(userMsg, '留言读取失败：' + core.errorText(res.error), 'error');
          return;
        }

        var rows = res.data || [];
        if (!rows.length) {
          myList.innerHTML = '<li class="gb-empty">还没发过留言。</li>';
          return;
        }
        if (!window.GBUI) {
          myList.innerHTML = '<li class="gb-empty">渲染脚本没加载成功，请刷新页面。</li>';
          return;
        }
        window.GBUI.renderList(myList, rows, { mine: true, onWithdraw: withdrawMine });
      });
  }

  function loadProfile(user) {
    if (userPanel) userPanel.hidden = false;
    if (guestPanel) guestPanel.hidden = true;

    sb.from('profiles')
      .select('username,bio,trust_level,is_banned,created_at')
      .eq('id', user.id)
      .single()
      .then(function (res) {
        if (res.error) {
          fillProfile(user, null);
          setMsg(userMsg, '资料读取失败：' + core.errorText(res.error) +
            '（多半是注册时的建资料触发器没生效，重新执行一次 01_schema.sql 即可）', 'error');
          return;
        }
        fillProfile(user, res.data);
        loadMine(user);
      });
  }

  /* ---------- 保存昵称 / 简介 ---------- */
  if (profileForm) {
    profileForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!currentUser) return;

      var username = profileForm.elements.username.value.trim();
      var bio = profileForm.elements.bio.value.trim();

      if (username.length < 3 || username.length > 20) {
        setMsg(userMsg, '昵称要 3–20 个字符', 'error');
        return;
      }

      setMsg(userMsg, '');
      busy(profileForm, true);

      sb.from('profiles')
        .update({ username: username, bio: bio })
        .eq('id', currentUser.id)
        .select('username,bio,trust_level,is_banned,created_at')
        .single()
        .then(function (res) {
          busy(profileForm, false);
          if (res.error) {
            setMsg(userMsg, '保存失败：' + core.errorText(res.error), 'error');
            return;
          }
          fillProfile(currentUser, res.data);
          setMsg(userMsg, '已保存。', 'ok');
        });
    });
  }

  /* ---------- 启动 ---------- */
  core.session().then(function (s) {
    if (!s || !s.user) {
      showGuest();
      return;
    }
    currentUser = s.user;
    loadProfile(s.user);
  });

  core.onAuthChange(function (s, event) {
    if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
    if (!s || !s.user) {
      currentUser = null;
      showGuest();
      return;
    }
    currentUser = s.user;
    loadProfile(s.user);
  });
})(window, document);
