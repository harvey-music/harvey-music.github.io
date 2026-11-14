/* ===================================================================
   游客通行证 guest-gate.js
   -------------------------------------------------------------------
   一、未登录访客进站时弹一张「游客通行证」：点一下就走 Supabase 匿名
       登录（不填邮箱、不填密码），昵称由数据库触发器分配 ——
       游客2001、游客2002、游客2003…
   二、下载守卫：DownloadGate 在弹出「运行环境核对」之前先向本模块
       要权限，三种结局：
         没领通行证 → 弹框，领完自动继续
         封禁期内   → 直接拦下，写明解封时间与申诉邮箱
         正常       → 放行
   三、能力边界（重要）：本站是 GitHub Pages 纯静态站，安装包直链放在
       腾讯云 COS 公开桶里。这一层管得住"从站内点下载"的人，管不住
       直接访问直链、或者去扒 data/downloads.json 的人。真要锁死文件，
       得把 COS 桶改成私有读 + 签名 URL，那是另一套东西。

   依赖：vendor/supabase.js + supabase-client.js（必须先于本文件引入）
   用法：<script src="guest-gate.js" defer></script>
        其他脚本用 window.GuestGate.requireDownload() 取下载许可
   =================================================================== */
(function (window, document) {
  'use strict';

  if (!window.SiteCore) return;
  var core = window.SiteCore;

  var sb;
  try {
    sb = core.getClient();
  } catch (err) {
    return;
  }

  var APPEAL_MAIL = 'zjh041106@qq.com';
  var DISMISS_KEY = 'gb_guest_gate_dismissed';
  var STYLE_ID = 'gg-style';

  var CSS = [
    '.gg{position:fixed;inset:0;z-index:95;display:flex;align-items:center;justify-content:center;',
    'padding:clamp(14px,4vw,32px);background:rgba(4,4,6,.74);opacity:0;visibility:hidden;',
    'transition:opacity .18s ease,visibility .18s ease}',
    '.gg.is-open{opacity:1;visibility:visible}',
    '.gg-card{width:min(520px,100%);max-height:calc(100vh - 40px);max-height:calc(100dvh - 40px);',
    'overflow-y:auto;padding:clamp(20px,3.2vw,28px);border-radius:20px;',
    'background:var(--card,#17181c);border:1px solid var(--line-strong,#3a3b42);',
    'box-shadow:0 30px 80px rgba(0,0,0,.62);transform:translateY(12px);transition:transform .2s ease}',
    '.gg.is-open .gg-card{transform:none}',
    '.gg-eyebrow{display:inline-flex;align-items:center;gap:8px;color:var(--accent,#e3c274);',
    'font-size:.74rem;font-weight:600;letter-spacing:.14em}',
    '.gg-eyebrow::before{content:"";width:6px;height:6px;border-radius:50%;',
    'background:var(--accent,#e3c274);box-shadow:0 0 10px var(--accent-dot,rgba(227,194,116,.55))}',
    '.gg h2{margin:12px 0 0;font-size:clamp(1.18rem,2.6vw,1.38rem);font-weight:700;',
    'line-height:1.32;color:var(--text,#eaeaec)}',
    '.gg p{margin:10px 0 0;font-size:.9rem;line-height:1.7;color:var(--text-mute,#9a9da4)}',
    '.gg a{color:var(--accent,#e3c274)}',
    '.gg ul{margin:14px 0 0;padding:0;list-style:none;display:grid;gap:8px}',
    '.gg li{position:relative;padding-left:16px;font-size:.86rem;line-height:1.65;',
    'color:var(--text-dim,#c4c6cb)}',
    '.gg li::before{content:"·";position:absolute;left:0;top:0;color:var(--accent,#e3c274);font-weight:700}',
    '.gg-note{margin-top:14px;padding:11px 14px;border-radius:10px;font-size:.82rem;line-height:1.65;',
    'color:var(--text-mute,#9a9da4);background:var(--bg-deep,#08080a);',
    'border:1px solid var(--line-soft,#232429);word-break:break-word}',
    '.gg-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:10px;margin-top:20px}',
    '.gg-btn{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;',
    'min-width:104px;padding:11px 20px;border-radius:999px;font:inherit;font-size:.92rem;',
    'cursor:pointer;border:1px solid transparent;',
    'transition:background .18s,border-color .18s,color .18s,transform .18s}',
    '.gg-btn:active{transform:scale(.97)}',
    '.gg-btn:disabled{opacity:.62;cursor:progress;transform:none}',
    '.gg-btn--ghost{border-color:var(--line-strong,#3a3b42);background:transparent;',
    'color:var(--text-dim,#c4c6cb)}',
    '.gg-btn--ghost:hover{border-color:var(--accent-line,rgba(227,194,116,.45));color:var(--accent,#e3c274)}',
    '.gg-btn--primary{background:var(--accent-grad,linear-gradient(180deg,#f2d99b,#d9b25c));',
    'color:var(--on-accent,#17181a);font-weight:600}',
    '.gg-btn--primary:hover{background:var(--accent-grad-hover,linear-gradient(180deg,#f9e5b8,#e6c877));',
    'box-shadow:0 10px 26px rgba(201,162,39,.22)}',
    '.gg-btn:focus-visible{outline:2px solid var(--accent,#e3c274);outline-offset:2px}',
    '.gg-msg{margin-top:12px;font-size:.82rem;line-height:1.6;color:var(--text-faint,#6c6f76);',
    'min-height:1em}',
    '.gg-msg.is-error{color:var(--warn,#e0836f)}',
    '.gg-msg.is-ok{color:var(--accent,#e3c274)}',
    '.gg-toast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,12px);z-index:96;',
    'padding:10px 18px;border-radius:999px;background:var(--card,#17181c);',
    'border:1px solid var(--accent-line,rgba(227,194,116,.45));color:var(--text,#eaeaec);',
    'font-size:.86rem;box-shadow:0 16px 40px rgba(0,0,0,.5);opacity:0;pointer-events:none;',
    'transition:opacity .2s,transform .2s}',
    '.gg-toast.is-on{opacity:1;transform:translate(-50%,0)}'
  ].join('');

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /* ---------------- 状态 ---------------- */
  var state = { loaded: false, user: null, profile: null };
  var loading = null;
  var pendingResolve = null;

  function loadStatus(force) {
    if (loading && !force) return loading;

    loading = core.session().then(function (sess) {
      state.user = sess ? sess.user : null;
      state.profile = null;

      if (!sess) {
        state.loaded = true;
        return state;
      }

      return Promise.resolve(sb.rpc('gb_my_profile')).then(function (res) {
        state.profile = (res && res.data && res.data[0]) || null;
        state.loaded = true;
        return state;
      }).catch(function () {
        state.loaded = true;
        return state;
      });
    }).catch(function () {
      state.loaded = true;
      return state;
    });

    return loading;
  }

  // 数据库返回的 is_banned 已经算过"永久封 or 临时封未到期"；
  // 这里再核一次时间，是为了页面挂了两小时、封禁正好到点的那种情况。
  function banActive() {
    var p = state.profile;
    if (!p || !p.is_banned) return false;
    if (!p.banned_until) return true;
    return new Date(p.banned_until).getTime() > Date.now();
  }

  function banLine() {
    var p = state.profile || {};
    var when = p.banned_until ? core.fmtTime(p.banned_until) : '另行通知';
    var line = '这个账号被封禁到 ' + when + '，期间不能下载、不能留言。';
    if (p.ban_reason) line += '原因：' + p.ban_reason + '。';
    return line + '有异议请发邮件到 ' + APPEAL_MAIL + '。';
  }

  /* ---------------- 弹窗 ---------------- */
  var root = null;
  var refs = {};
  var mode = 'enter';

  function build() {
    if (root) return;
    injectStyle();

    root = document.createElement('div');
    root.className = 'gg';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'gg-title');
    root.innerHTML =
      '<div class="gg-card">' +
        '<span class="gg-eyebrow" data-gg-eyebrow>访客通行证</span>' +
        '<h2 id="gg-title" data-gg-title>先领一张游客通行证</h2>' +
        '<p data-gg-intro></p>' +
        '<ul data-gg-list>' +
          '<li>不用填任何信息，昵称自动分配：游客2001、游客2002…</li>' +
          '<li>下载必须先持号；被处理的账号会停掉下载和留言</li>' +
          '<li>换浏览器 / 清缓存后会是一张新通行证，老账号请直接登录</li>' +
        '</ul>' +
        '<p class="gg-note" data-gg-note></p>' +
        '<div class="gg-actions">' +
          '<button type="button" class="gg-btn gg-btn--ghost" data-gg-later>稍后再说</button>' +
          '<button type="button" class="gg-btn gg-btn--primary" data-gg-go>以游客身份进入</button>' +
        '</div>' +
        '<p class="gg-msg" data-gg-msg role="status"></p>' +
      '</div>';
    document.body.appendChild(root);

    refs.eyebrow = root.querySelector('[data-gg-eyebrow]');
    refs.title = root.querySelector('[data-gg-title]');
    refs.intro = root.querySelector('[data-gg-intro]');
    refs.list = root.querySelector('[data-gg-list]');
    refs.note = root.querySelector('[data-gg-note]');
    refs.later = root.querySelector('[data-gg-later]');
    refs.go = root.querySelector('[data-gg-go]');
    refs.msg = root.querySelector('[data-gg-msg]');

    refs.later.addEventListener('click', function () { close(false, 'later'); });
    refs.go.addEventListener('click', signIn);

    root.addEventListener('click', function (e) {
      if (e.target === root) close(false, 'backdrop');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && root.classList.contains('is-open')) close(false, 'esc');
    });
  }

  function say(text, kind) {
    if (!refs.msg) return;
    refs.msg.textContent = text || '';
    refs.msg.className = 'gg-msg' + (kind ? ' is-' + kind : '');
  }

  function open(nextMode) {
    build();
    mode = nextMode || 'enter';

    if (mode === 'download') {
      refs.eyebrow.textContent = '下载前需要通行证';
      refs.title.textContent = '先领一张游客通行证再下载';
      refs.intro.textContent = '本站的安装包只对持号访客开放。点一下就好，不用填邮箱、不用设密码。';
      refs.later.textContent = '取消下载';
      refs.note.innerHTML = '已经有正式账号？<a href="account.html">去登录</a>，不用再领游客号。';
    } else {
      refs.eyebrow.textContent = '访客通行证';
      refs.title.textContent = '先领一张游客通行证';
      refs.intro.textContent = '本站不收集邮箱、不收集手机号，点一下就能进。领了之后下载和留言都记在这个号上。';
      refs.later.textContent = '稍后再说';
      refs.note.innerHTML = '已经有正式账号？<a href="account.html">去登录</a>，不用再领游客号。';
    }

    say('');
    root.classList.add('is-open');
    window.setTimeout(function () {
      if (refs.go) refs.go.focus();
    }, 60);
  }

  function close(ok, how) {
    if (root) root.classList.remove('is-open');

    // 进站弹窗点了「稍后再说」：本次会话别再烦他，开着标签页翻页也不弹
    if (mode === 'enter' && how === 'later') {
      try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch (err) { /* 隐私模式无视 */ }
    }

    if (pendingResolve) {
      var fn = pendingResolve;
      pendingResolve = null;
      fn(!!ok);
    }
  }

  function toast(text) {
    injectStyle();
    var node = document.createElement('div');
    node.className = 'gg-toast';
    node.setAttribute('role', 'status');
    node.textContent = text;
    document.body.appendChild(node);
    requestAnimationFrame(function () { node.classList.add('is-on'); });
    window.setTimeout(function () {
      node.classList.remove('is-on');
      window.setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 260);
    }, 2600);
  }

  /* ---------------- 领通行证（匿名登录） ---------------- */
  function signIn() {
    if (!refs.go) return;
    refs.go.disabled = true;
    refs.go.textContent = '正在领取…';
    say('正在申请通行证…');

    Promise.resolve(sb.auth.signInAnonymously()).then(function (res) {
      if (res && res.error) throw res.error;
      return loadStatus(true);
    }).then(function () {
      var name = (state.profile && state.profile.username) || '游客';
      var resume = pendingResolve;
      pendingResolve = null;
      if (root) root.classList.remove('is-open');

      if (banActive()) {
        // 极端情况：新号就被封（不会发生，但兜一下）
        toast('已领取「' + name + '」，但这个账号正在封禁期');
        showBlocked();
        if (resume) resume(false);
        return;
      }

      toast('通行证已领取：' + name);
      if (resume) resume(true);
    }).catch(function (err) {
      var raw = String((err && (err.message || err.error_description)) || err);
      if (raw.indexOf('anonymous_provider_disabled') !== -1 ||
          raw.indexOf('Anonymous sign-ins are disabled') !== -1 ||
          raw.indexOf('anonymous') !== -1) {
        say('站点的游客通道还没打开：站长需要在 Supabase 控制台的 Authentication → Sign In / Providers 里启用 Anonymous sign-ins。', 'error');
      } else {
        say('领取失败：' + core.errorText(err), 'error');
      }
    }).then(function () {
      refs.go.disabled = false;
      refs.go.textContent = '以游客身份进入';
    });
  }

  /* ---------------- 封禁提示 ---------------- */
  var blockedRoot = null;

  function showBlocked() {
    injectStyle();

    if (!blockedRoot) {
      blockedRoot = document.createElement('div');
      blockedRoot.className = 'gg';
      blockedRoot.setAttribute('role', 'alertdialog');
      blockedRoot.setAttribute('aria-modal', 'true');
      blockedRoot.innerHTML =
        '<div class="gg-card">' +
          '<span class="gg-eyebrow">下载已暂停</span>' +
          '<h2>账号封禁中</h2>' +
          '<p class="gg-note" data-gg-banline></p>' +
          '<div class="gg-actions">' +
            '<a class="gg-btn gg-btn--ghost" href="account.html">账号状态</a>' +
            '<a class="gg-btn gg-btn--primary" href="mailto:' + APPEAL_MAIL + '">发邮件申诉</a>' +
          '</div>' +
        '</div>';
      document.body.appendChild(blockedRoot);

      blockedRoot.addEventListener('click', function (e) {
        if (e.target === blockedRoot) blockedRoot.classList.remove('is-open');
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') blockedRoot.classList.remove('is-open');
      });
    }

    var line = blockedRoot.querySelector('[data-gg-banline]');
    if (line) line.textContent = banLine();
    blockedRoot.classList.add('is-open');
  }

  /* ---------------- 对外接口 ---------------- */
  // DownloadGate 打开「运行环境核对」之前会先问这里：
  //   true  → 可以下
  //   false → 已经在弹框拦下了，调用方直接收手
  function requireDownload() {
    return loadStatus().then(function () {
      if (!state.user) {
        open('download');
        return new Promise(function (resolve) { pendingResolve = resolve; });
      }
      if (banActive()) {
        showBlocked();
        return false;
      }
      return true;
    });
  }

  function autoShow() {
    var dismissed = false;
    try { dismissed = sessionStorage.getItem(DISMISS_KEY) === '1'; } catch (err) { /* 无视 */ }
    if (dismissed) return;

    loadStatus().then(function () {
      if (state.user) return;
      // 等页面骨架铺完再弹，别一进站就糊一层
      window.setTimeout(function () {
        if (state.user) return;
        // 用户这 450ms 内已经点了下载（弹的是下载版），就别再盖一层
        if (root && root.classList.contains('is-open')) return;
        open('enter');
      }, 450);
    });
  }

  function start() {
    autoShow();
    // 登录 / 登出 / 换号后把缓存作废，下一次判断用新身份
    core.onAuthChange(function () {
      loading = null;
      loadStatus(true);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.GuestGate = {
    requireDownload: requireDownload,
    open: open,
    status: loadStatus,
    isBanned: banActive,
    user: function () { return state.user; },
    profile: function () { return state.profile; }
  };
})(window, document);
