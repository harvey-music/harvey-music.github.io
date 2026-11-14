/* ============================================================
   留言板：首页区块 + 可复用的留言条目渲染器
   —— 列表、发布、撤回全部走 Supabase，无需自建后端；
   —— 待审状态只有作者自己和站长看得见，这是数据库策略决定的，
      前端只是照着显示。
   ============================================================ */
(function (window, document) {
  'use strict';

  if (!window.SiteCore) return;
  var core = window.SiteCore;

  /* ---------- 小工具：建元素（一律用 textContent，杜绝 XSS） ---------- */
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  var STATUS = {
    pending:   { text: '待审核', cls: 'gb-badge' },
    rejected:  { text: '未通过', cls: 'gb-badge gb-badge--gone' },
    withdrawn: { text: '已撤回', cls: 'gb-badge gb-badge--gone' },
    deleted:   { text: '已删除', cls: 'gb-badge gb-badge--gone' }
  };

  /* ---------- 渲染一条留言 ----------
     opts.mine       是否本人（描金边 + 可撤回）
     opts.onWithdraw 撤回回调 (id, buttonEl)
     opts.hideBody   软删除时是否隐藏正文（后台列表用）            */
  function renderItem(row, opts) {
    opts = opts || {};
    var prof = row.profiles || null;
    var name = (prof && prof.username) ? prof.username : '已注销账号';

    var li = el('li', 'gb-item' + (opts.mine ? ' is-own' : ''));

    var av = el('span', 'gb-avatar', core.firstChar(name));
    av.style.setProperty('--gb-hue', core.hueOf(name));
    av.setAttribute('aria-hidden', 'true');

    var body = el('div', 'gb-item-body');
    var head = el('div', 'gb-item-head');
    head.appendChild(el('span', 'gb-name', name));
    head.appendChild(el('span', 'gb-time', core.fmtTime(row.created_at)));

    var st = STATUS[row.status];
    if (st) {
      var badge = el('span', st.cls, st.text);
      if (opts.mine) badge.className += ' gb-badge--mine';
      head.appendChild(badge);
    }

    body.appendChild(head);

    var text = row.body;
    if (opts.hideBody && row.status === 'deleted') text = '（正文已删除）';
    body.appendChild(el('p', 'gb-text', text || ''));

    if (opts.mine && opts.onWithdraw &&
        (row.status === 'pending' || row.status === 'published')) {
      var act = el('button', 'gb-act', '撤回这条留言');
      act.type = 'button';
      act.addEventListener('click', function () { opts.onWithdraw(row.id, act); });
      body.appendChild(act);
    }

    li.appendChild(av);
    li.appendChild(body);
    return li;
  }

  /* ---------- 供账号页 / 后台复用 ---------- */
  window.GBUI = {
    el: el,
    renderItem: renderItem,
    renderList: function (listEl, rows, opts) {
      listEl.innerHTML = '';
      rows.forEach(function (row) { listEl.appendChild(renderItem(row, opts)); });
    }
  };
  /* ============ 下面是首页的留言板区块 ============ */
  var board = document.querySelector('[data-gb-board]');
  if (!board) return;

  var MAX_LEN = 1000;
  var PAGE = parseInt(board.getAttribute('data-gb-limit'), 10) || 8;

  var listEl = board.querySelector('[data-gb-list]');
  var statusEl = board.querySelector('[data-gb-status]');
  var composerEl = board.querySelector('[data-gb-composer]');
  var moreBtn = board.querySelector('[data-gb-more]');

  var sb = null;
  try {
    sb = core.getClient();
  } catch (err) {
    setStatus(err.message, 'error');
    return;
  }

  var sess = null;
  var offset = 0;
  var busy = false;
  var dirty = false;
  var finished = false;

  function setStatus(text, kind) {
    if (!statusEl) return;
    if (!text) {
      statusEl.hidden = true;
      statusEl.textContent = '';
      return;
    }
    statusEl.hidden = false;
    statusEl.className = 'gb-status' + (kind ? ' is-' + kind : '');
    statusEl.textContent = text;
  }

  /* ---------- 列表 ---------- */
  function load(reset) {
    if (busy) {
      if (reset) dirty = true;
      return;
    }
    busy = true;

    if (reset) {
      offset = 0;
      finished = false;
      listEl.innerHTML = '';
      setStatus('正在加载留言…');
    }

    sb.from('messages')
      .select('id,body,status,created_at,author_id,profiles!messages_author_fkey(username)')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE - 1)
      .then(function (res) {
        busy = false;

        if (res.error) {
          setStatus('留言加载失败：' + core.errorText(res.error), 'error');
          return;
        }

        var rows = res.data || [];
        var me = sess && sess.user ? sess.user.id : null;

        rows.forEach(function (row) {
          listEl.appendChild(renderItem(row, {
            mine: !!me && row.author_id === me,
            onWithdraw: withdraw
          }));
        });

        offset += rows.length;
        finished = rows.length < PAGE;
        if (moreBtn) moreBtn.hidden = finished;

        if (offset === 0) {
          setStatus('');
          listEl.appendChild(el('li', 'gb-empty', '还没有公开留言，来做第一个吧。'));
        } else if (reset) {
          setStatus('');
        }

        if (dirty) { dirty = false; load(true); }
      });
  }

  /* ---------- 撤回自己的留言 ---------- */
  function withdraw(id, btnEl) {
    btnEl.disabled = true;
    btnEl.classList.add('is-loading');
    btnEl.textContent = '撤回中…';
    sb.from('messages').update({ status: 'withdrawn' }).eq('id', id).then(function (res) {
      if (res.error) {
        btnEl.disabled = false;
        btnEl.classList.remove('is-loading');
        btnEl.textContent = '撤回这条留言';
        setStatus('撤回失败：' + core.errorText(res.error), 'error');
        return;
      }
      setStatus('已撤回，这条留言不再公开展示。', 'ok');
      load(true);
    });
  }

  /* ---------- 输入区：没登录给入口，登录了给表单 ---------- */
  function renderComposer() {
    if (!composerEl) return;
    composerEl.innerHTML = '';

    if (!sess || !sess.user) {
      var tip = el('p', 'gb-tip', '登录后即可留言。留言会先由站长过一眼，通过后公开显示。');
      var link = el('a', null, '去登录 / 注册 ›');
      link.href = 'account.html?next=' + encodeURIComponent('index.html#liuyan');
      tip.appendChild(document.createTextNode(' '));
      tip.appendChild(link);
      composerEl.appendChild(tip);
      return;
    }

    var form = el('form', 'gb-form');
    var ta = el('textarea', 'gb-textarea');
    ta.maxLength = MAX_LEN;
    ta.placeholder = '说点什么…（最多 1000 字）';
    ta.setAttribute('aria-label', '留言内容');

    var row = el('div', 'gb-submit-row');
    var count = el('span', 'gb-count', '0 / ' + MAX_LEN);
    var hint = el('span', 'gb-hint', '提交后需站长审核');
    var btn = el('button', 'btn btn-primary', '发布留言');
    btn.type = 'submit';

    row.appendChild(count);
    row.appendChild(hint);
    row.appendChild(btn);
    form.appendChild(ta);
    form.appendChild(row);

    ta.addEventListener('input', function () {
      var n = ta.value.length;
      count.textContent = n + ' / ' + MAX_LEN;
      count.classList.toggle('is-over', n > MAX_LEN);
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = ta.value.trim();
      if (!text) {
        setStatus('先写点内容再发布。', 'error');
        ta.focus();
        return;
      }

      btn.disabled = true;
      btn.classList.add('is-loading');
      btn.textContent = '发布中…';

      sb.from('messages')
        .insert({ body: text, author_id: sess.user.id })
        .select('id,status')
        .single()
        .then(function (res) {
          btn.disabled = false;
          btn.classList.remove('is-loading');
          btn.textContent = '发布留言';

          if (res.error) {
            setStatus('发布失败：' + core.errorText(res.error), 'error');
            return;
          }

          ta.value = '';
          count.textContent = '0 / ' + MAX_LEN;
          var published = res.data && res.data.status === 'published';
          setStatus(published ? '已发布。' : '已提交，站长通过后会出现在下面的列表里。', 'ok');
          load(true);
        });
    });

    composerEl.appendChild(form);
  }

  if (moreBtn) {
    moreBtn.addEventListener('click', function () {
      if (finished || busy) return;
      load(false);
    });
  }

  /* ---------- 启动 ---------- */
  setStatus('正在加载留言…');
  core.session().then(function (s) {
    sess = s;
    renderComposer();
    load(true);
  });

  core.onAuthChange(function (s, event) {
    // INITIAL_SESSION 已在上面 session() 里处理过；
    // TOKEN_REFRESHED 只是令牌续期，列表没变，重建会让人眼看到闪烁
    if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
    sess = s;
    renderComposer();
    load(true);
  });
})(window, document);
