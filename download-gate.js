/* ===================================================================
   下载闸门 download-gate.js
   -------------------------------------------------------------------
   用途：所有安装包 / 压缩包在真正开始下载之前，先弹一层「运行环境核对」，
        把「能用 / 用不了」写清楚，并由用户主动确认后再下载。

   为什么不在计时器里下载：
        浏览器的下载 / 新标签必须发生在用户手势里，若把触发动作放进
        setTimeout 回调，会被当成非用户手势而遭拦截。因此倒计时只负责
        「解锁继续按钮」，真正的下载始终在「继续」的 click 回调里同步发起。

   用法一（声明式，用于直链 <a>）：
        <a href="…/X.exe" data-dl-gate>下载安装包</a>
        <a href="…/X.exe" data-dl-gate data-dl-mac="可改用官方原版，原生支持 macOS">下载</a>
        <script src="download-gate.js" defer></script>

   用法二（命令式，用于已有下载弹窗的页面）：
        DownloadGate.confirm({
          fileCount: 2,                      // 即将下载的文件数，>1 时文案会提示
          onConfirm: function () { … },      // 在「继续」的点击里同步执行
          onCancel:  function () { … }       // 关闭后回到上一步（可选）
        });

   可访问性：role="alertdialog" + aria-modal，焦点陷阱，Esc 等同放弃，
            「继续」在锁定期间用 aria-disabled 而非 disabled（保持可聚焦、
            屏幕阅读器可读），倒计时结束用 aria-live 播报一次。
   =================================================================== */
(function (window, document) {
  'use strict';

  var LOCK_MS = 5000;
  var STYLE_ID = 'dl-gate-style';

  var CSS = [
    '.dlg{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;',
    'padding:clamp(14px,4vw,32px);background:rgba(4,4,6,.74);opacity:0;visibility:hidden;',
    'transition:opacity .18s ease,visibility .18s ease}',
    '.dlg.is-open{opacity:1;visibility:visible}',
    '.dlg-card{width:min(600px,100%);max-height:calc(100vh - 40px);max-height:calc(100dvh - 40px);',
    'overflow-y:auto;padding:clamp(20px,3.2vw,30px);border-radius:20px;',
    'background:var(--card,#17181c);border:1px solid var(--line-strong,#3a3b42);',
    'box-shadow:0 30px 80px rgba(0,0,0,.62);transform:translateY(12px);',
    'transition:transform .2s ease}',
    '.dlg.is-open .dlg-card{transform:none}',

    '.dlg-eyebrow{display:inline-flex;align-items:center;gap:8px;color:var(--accent,#e3c274);',
    'font-size:.74rem;font-weight:600;letter-spacing:.14em}',
    '.dlg-eyebrow::before{content:"";width:6px;height:6px;border-radius:50%;',
    'background:var(--accent,#e3c274);box-shadow:0 0 10px var(--accent-dot,rgba(227,194,116,.55))}',

    '.dlg h2{margin-top:12px;font-size:clamp(1.18rem,2.6vw,1.4rem);font-weight:700;',
    'letter-spacing:-.01em;line-height:1.32;color:var(--text,#eaeaec)}',
    '.dlg-intro{margin-top:10px;font-size:.9rem;line-height:1.7;color:var(--text-mute,#9a9da4)}',

    '.dlg-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:18px}',
    '.dlg-col{padding:14px 16px;border-radius:12px;border:1px solid var(--line,#26272c);',
    'background:var(--bg-soft,#111216)}',
    '.dlg-col--ok{border-color:rgba(227,194,116,.26);background:var(--gold-wash,rgba(201,162,39,.08))}',
    '.dlg-col h3{font-size:.78rem;font-weight:600;letter-spacing:.1em;color:var(--text-faint,#6c6f76)}',
    '.dlg-col--ok h3{color:var(--accent,#e3c274)}',
    '.dlg-col ul{list-style:none;margin:10px 0 0;display:grid;gap:7px}',
    '.dlg-col li{position:relative;padding-left:15px;font-size:.84rem;line-height:1.6;',
    'color:var(--text-dim,#c4c6cb)}',
    '.dlg-col li::before{content:"·";position:absolute;left:0;top:0;',
    'color:var(--text-faint,#6c6f76);font-weight:700}',
    '.dlg-col--ok li::before{color:var(--accent,#e3c274)}',
    '.dlg-col strong{color:var(--text,#eaeaec);font-weight:600}',

    '.dlg-note{margin-top:14px;padding:11px 14px;border-radius:10px;font-size:.82rem;line-height:1.65;',
    'color:var(--text-mute,#9a9da4);background:var(--bg-deep,#08080a);border:1px solid var(--line-soft,#232429)}',

    '.dlg-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:10px;margin-top:20px}',
    '.dlg-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;',
    'min-width:108px;padding:11px 22px;border-radius:999px;border:1px solid transparent;',
    'font:inherit;font-size:.92rem;cursor:pointer;text-decoration:none;',
    'transition:background .18s,border-color .18s,color .18s,transform .18s,box-shadow .18s}',
    '.dlg-btn:active{transform:scale(.97)}',
    '.dlg-btn--ghost{border-color:var(--line-strong,#3a3b42);background:transparent;',
    'color:var(--text-dim,#c4c6cb)}',
    '.dlg-btn--ghost:hover{border-color:var(--accent-line,rgba(227,194,116,.45));',
    'color:var(--accent,#e3c274)}',
    '.dlg-btn--primary{background:var(--accent-grad,linear-gradient(180deg,#f2d99b,#d9b25c));',
    'color:var(--on-accent,#17181a);font-weight:600}',
    '.dlg-btn--primary:hover{background:var(--accent-grad-hover,linear-gradient(180deg,#f9e5b8,#e6c877));',
    'box-shadow:0 10px 26px rgba(201,162,39,.22)}',
    '.dlg-btn--primary.is-locked{background:transparent;border-color:var(--line-strong,#3a3b42);',
    'color:var(--text-faint,#6c6f76);cursor:progress;animation:none}',
    '.dlg-btn--primary.is-locked:hover{background:transparent;border-color:var(--line-strong,#3a3b42);',
    'box-shadow:none;color:var(--text-faint,#6c6f76)}',
    '.dlg-btn--primary:not(.is-locked){animation:dlg-pop .42s ease}',
    '@keyframes dlg-pop{0%{transform:scale(.97)}55%{transform:scale(1.03)}100%{transform:scale(1)}}',
    '.dlg-btn:focus-visible{outline:2px solid var(--accent,#e3c274);outline-offset:2px}',

    '.dlg-hint{margin-top:12px;font-size:.8rem;line-height:1.6;color:var(--danger,#ff9c8a)}',
    '.dlg-hint:empty{margin-top:0}',
    '.dlg-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;',
    'clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}',

    '@media (max-width:560px){',
    '.dlg-grid{grid-template-columns:1fr}',
    '.dlg-actions{flex-direction:column}',
    '.dlg-btn{width:100%}',
    '}',

    '@media (prefers-reduced-motion:reduce){',
    '.dlg,.dlg-card{transition:none}',
    '.dlg-btn--primary{animation:none}',
    '}'
  ].join('');

  var state = {
    root: null,
    opts: null,
    timer: 0,
    unlockAt: 0,
    locked: true,
    preLocked: false,
    lastFocus: null,
    onKeydown: null
  };

  var refs = {};

  var COPY = {
    intro: '请先核对当前系统能否运行本软件，确认后再开始下载。汉化版为 Windows 桌面程序，仅在 Windows 10 / 11（64 位）上可正常使用。',
    can: [
      'Windows 10 / 11（64 位）',
      '安装包与便携版内容一致，选其一即可',
      '便携版不写入系统，可放入 U 盘随身携带'
    ],
    cannot: [
      'Windows 7 / 8 / 8.1：缺少运行库，装上也无法启动',
      'macOS / Linux：汉化版仅提供 Windows 版本',
      '手机 / 平板：无法运行，请在 Windows 电脑上打开本页'
    ],
    note: '文件由腾讯云直链提供。浏览器若提示「此类文件可能有害」，属常规安全提示，选择保留即可。'
  };

  /* ---------------- 样式与 DOM：首次打开时才创建 ---------------- */

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureBuilt() {
    if (state.root) return;

    injectStyle();

    var root = document.createElement('div');
    root.className = 'dlg';
    root.setAttribute('role', 'alertdialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'dlg-title');
    root.setAttribute('aria-describedby', 'dlg-intro');
    root.innerHTML =
      '<div class="dlg-card">' +
        '<span class="dlg-eyebrow">下载前确认</span>' +
        '<h2 id="dlg-title">运行环境核对</h2>' +
        '<p class="dlg-intro" id="dlg-intro" data-dlg-intro></p>' +
        '<div class="dlg-grid">' +
          '<div class="dlg-col dlg-col--ok">' +
            '<h3>可以正常使用</h3>' +
            '<ul data-dlg-can></ul>' +
          '</div>' +
          '<div class="dlg-col">' +
            '<h3>当前版本无法使用</h3>' +
            '<ul data-dlg-cannot></ul>' +
          '</div>' +
        '</div>' +
        '<p class="dlg-note" data-dlg-note></p>' +
        '<div class="dlg-actions">' +
          '<button type="button" class="dlg-btn dlg-btn--ghost" data-dlg-cancel>放弃</button>' +
          '<button type="button" class="dlg-btn dlg-btn--primary is-locked" data-dlg-confirm aria-disabled="true">继续（5）</button>' +
        '</div>' +
        '<p class="dlg-hint" data-dlg-hint></p>' +
        '<p class="dlg-sr" aria-live="polite" data-dlg-live></p>' +
      '</div>';

    document.body.appendChild(root);

    refs.root = root;
    refs.intro = root.querySelector('[data-dlg-intro]');
    refs.can = root.querySelector('[data-dlg-can]');
    refs.cannot = root.querySelector('[data-dlg-cannot]');
    refs.note = root.querySelector('[data-dlg-note]');
    refs.cancel = root.querySelector('[data-dlg-cancel]');
    refs.confirm = root.querySelector('[data-dlg-confirm]');
    refs.hint = root.querySelector('[data-dlg-hint]');
    refs.live = root.querySelector('[data-dlg-live]');

    // 点遮罩空白处等同放弃（点卡片内部不关）
    root.addEventListener('click', function (e) {
      if (e.target === root) close('cancel');
    });
    refs.cancel.addEventListener('click', function () { close('cancel'); });
    refs.confirm.addEventListener('click', handleConfirm);

    state.root = root;
  }

  /* ---------------- 滚动锁：别处的弹窗已经锁过就不重复锁 ---------------- */

  function lockScroll() {
    // silverdaw 的下载弹窗用 body.style.overflow = 'hidden' 锁滚动；
    // 闸门叠在它上面时，滚动继续由它管理，这里只记账，不做改动
    state.preLocked = document.body.style.overflow === 'hidden';
    if (state.preLocked) return;

    var gap = window.innerWidth - document.documentElement.clientWidth;
    if (gap > 0) document.documentElement.style.paddingRight = gap + 'px';
    document.body.style.overflow = 'hidden';
  }

  function unlockScroll() {
    if (state.preLocked) return;
    document.body.style.overflow = '';
    document.documentElement.style.paddingRight = '';
  }

  /* ---------------- 倒计时：按时间戳算，后台节流也不跑偏 ---------------- */

  function setConfirmLabel(sec) {
    refs.confirm.textContent = sec > 0 ? '继续（' + sec + '）' : '继续';
  }

  function tick() {
    var left = state.unlockAt - Date.now();
    if (left > 0) {
      setConfirmLabel(Math.ceil(left / 1000));
      return;
    }
    window.clearInterval(state.timer);
    state.timer = 0;
    state.locked = false;
    refs.confirm.classList.remove('is-locked');
    refs.confirm.removeAttribute('aria-disabled');
    setConfirmLabel(0);
    refs.live.textContent = '倒计时结束，现在可以继续下载。';
  }

  function startCountdown() {
    state.locked = true;
    state.unlockAt = Date.now() + LOCK_MS;
    refs.confirm.classList.add('is-locked');
    refs.confirm.setAttribute('aria-disabled', 'true');
    setConfirmLabel(Math.ceil(LOCK_MS / 1000));
    if (state.timer) window.clearInterval(state.timer);
    state.timer = window.setInterval(tick, 200);
  }

  /* ---------------- 文案填充 ---------------- */

  function fillList(host, items) {
    host.textContent = '';
    for (var i = 0; i < items.length; i++) {
      var li = document.createElement('li');
      li.textContent = items[i];
      host.appendChild(li);
    }
  }

  function fillCopy(o) {
    var n = o.fileCount || 1;
    var intro = COPY.intro;
    if (n > 1) intro += '本次将开始 ' + n + ' 个下载。';
    refs.intro.textContent = intro;

    var cannot = COPY.cannot.slice();
    if (o.macText) cannot[1] = 'macOS / Linux：' + o.macText;

    fillList(refs.can, COPY.can);
    fillList(refs.cannot, cannot);
    refs.note.textContent = COPY.note;
  }

  /* ---------------- 焦点陷阱 ---------------- */

  function trapTab(e) {
    var items = refs.root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  /* ---------------- 打开 / 关闭 ---------------- */

  function open(options) {
    ensureBuilt();
    if (state.root.classList.contains('is-open')) return;

    state.opts = options || {};
    fillCopy(state.opts);
    refs.hint.textContent = '';
    refs.live.textContent = '';
    state.lastFocus = document.activeElement;

    state.root.classList.add('is-open');
    lockScroll();
    startCountdown();

    state.onKeydown = function (e) {
      if (e.key === 'Escape') {
        // 捕获阶段拦下：不让下层的下载弹窗跟着一起关
        e.preventDefault();
        e.stopPropagation();
        close('cancel');
        return;
      }
      if (e.key === 'Tab') trapTab(e);
    };
    document.addEventListener('keydown', state.onKeydown, true);

    // 焦点落在「继续」：它是主操作，Tab 顺序也顺（继续 → 放弃 → 回到继续）
    window.setTimeout(function () {
      if (state.root && state.root.classList.contains('is-open')) {
        refs.confirm.focus({ preventScroll: true });
      }
    }, 40);
  }

  function close(reason) {
    if (!state.root || !state.root.classList.contains('is-open')) return;

    if (state.timer) {
      window.clearInterval(state.timer);
      state.timer = 0;
    }
    state.root.classList.remove('is-open');
    if (state.onKeydown) {
      document.removeEventListener('keydown', state.onKeydown, true);
      state.onKeydown = null;
    }
    unlockScroll();

    var opts = state.opts;
    state.opts = null;

    var back = state.lastFocus;
    state.lastFocus = null;
    if (back && typeof back.focus === 'function') {
      try { back.focus({ preventScroll: true }); } catch (err) { back.focus(); }
    }

    if (!opts) return;
    var cb = reason === 'confirm' ? opts.onConfirm : opts.onCancel;
    // 同步调用：继续下载必须留在本次点击的调用栈里，浏览器才认这是用户手势
    if (typeof cb === 'function') cb();
  }

  function handleConfirm() {
    if (state.locked) {
      var left = Math.max(1, Math.ceil((state.unlockAt - Date.now()) / 1000));
      refs.hint.textContent = '请先看完上面的说明，还需 ' + left + ' 秒才能继续。';
      return;
    }
    close('confirm');
  }

  /* ---------------- 下载与声明式绑定 ---------------- */

  function download(url) {
    var a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function attach(node) {
    if (!node || node.__dlgBound) return;
    node.__dlgBound = true;

    node.addEventListener('click', function (e) {
      // 按住修饰键 / 中键时交给浏览器（用户想在新标签打开就由他）
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;
      var url = node.getAttribute('data-dl-url') || node.getAttribute('href') || '';
      if (!url || url === '#') return;
      e.preventDefault();
      open({
        fileCount: 1,
        macText: node.getAttribute('data-dl-mac') || '',
        onConfirm: function () { download(url); }
      });
    });
  }

  function autoInit() {
    var nodes = document.querySelectorAll('[data-dl-gate]');
    for (var i = 0; i < nodes.length; i++) attach(nodes[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

  window.DownloadGate = {
    open: open,
    confirm: function (options) { open(options); },
    close: function () { close('cancel'); },
    attach: attach,
    scan: autoInit,
    download: download
  };
})(window, document);


