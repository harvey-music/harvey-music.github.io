/* ===================================================================
   公告渲染 notices.js
   -------------------------------------------------------------------
   数据来源：data/notices.json（唯一来源）
   职责：把这个 JSON 渲染到页面上的四处容器里

     [data-notice-ribbon]   首页顶部公告条（最新一条，不看置顶）
     [data-notice-list]     首页最新几条（默认 3，可用 data-limit 改）
     [data-notice-page]     公告页全部条目（置顶在上，其余按日期倒序）
     [data-notice-alert]    公告页顶部金色提示条
     [data-notice-count]    任何位置显示的总条数

   排序两种口径：横幅与首页一律按日期取最新（横幅是新闻位，不该长期挂着
   置顶的旧公告）；公告页则置顶优先，其余按日期倒序 —— 与页面上那句
   「置顶条目在上，其余按时间倒序排列」一致。
   发一条新公告、日期填最新，横幅和首页三条会自动换过去，不必动 HTML。

   为什么是运行时渲染：改 JSON 提交后即可生效，不必改多个 HTML。
   代价是依赖 JavaScript，因此各页容器里配了 <noscript> 说明。

   排序规则（与公告页原有说明一致）：
     置顶优先 → 日期倒序（YYYY-MM-DD 可直接字符串比较）→ JSON 数组顺序兜底，
     同一天的几条公告因此不会在每次加载时变换位置。

   渲染完成后派发 document 上的 'notices:rendered' 事件：
   两页的锚点定位 / 滚动还原脚本依赖它，因为 #notice-xxx 要等渲染后
   才在 DOM 里出现（详情见 notice.html 尾部的跨页返回脚本）。
   =================================================================== */
(function (window, document) {
  'use strict';

  var DATA_URL = 'data/notices.json';
  var EVENT = 'notices:rendered';
  var DEFAULT_LIMIT = 3;

  // 公告正文里允许出现的标签：够用，且挡住脚本注入
  var ALLOWED = { A: 1, B: 1, STRONG: 1, EM: 1, CODE: 1, BR: 1 };

  /* ---------------- 小工具 ---------------- */

  // 2026-11-08 -> 2026 年 11 月 8 日（与原手写文案一致，月日不补零）
  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return m[1] + ' 年 ' + parseInt(m[2], 10) + ' 月 ' + parseInt(m[3], 10) + ' 日';
  }

  // 只放行站内相对路径、锚点、http(s)、mailto，其他协议（javascript: 等）一律丢掉
  function safeHref(href) {
    var h = String(href == null ? '' : href).replace(/^[\s\u0000-\u001f]+/, '');
    if (!h) return '';
    if (/^(javascript|data|vbscript|file):/i.test(h)) return '';
    return h;
  }

  // 白名单清洗：非白名单标签展开成文字，保留可读性；属性除 a[href] 外全部剥掉
  function sanitize(parent) {
    var node = parent.firstChild;
    while (node) {
      var next = node.nextSibling;
      if (node.nodeType === 1) {
        sanitize(node);
        if (!ALLOWED[node.tagName]) {
          while (node.firstChild) parent.insertBefore(node.firstChild, node);
          parent.removeChild(node);
        } else {
          var href = node.tagName === 'A' ? safeHref(node.getAttribute('href')) : '';
          var attrs = Array.prototype.slice.call(node.attributes);
          for (var i = 0; i < attrs.length; i++) node.removeAttribute(attrs[i].name);
          if (node.tagName === 'A' && href) {
            node.setAttribute('href', href);
            if (/^https?:/i.test(href)) {
              node.setAttribute('target', '_blank');
              node.setAttribute('rel', 'noopener');
            }
          }
        }
      } else if (node.nodeType !== 3) {
        parent.removeChild(node); // 注释、CDATA 之类
      }
      node = next;
    }
  }

  function frag(html) {
    var box = document.createElement('div');
    box.innerHTML = String(html == null ? '' : html);
    sanitize(box);
    return box;
  }

  /* ---------------- 排序 ---------------- */

  function usable(items) {
    return (items || []).map(function (item, i) {
      return { item: item, i: i };
    }).filter(function (x) {
      return x.item && typeof x.item === 'object' && !x.item.hidden;
    });
  }

  // 公告栏顺序：置顶 → 日期倒序 → 原顺序（公告页用这个）
  function ordered(items) {
    return usable(items).sort(function (a, b) {
      var pa = a.item.pin ? 1 : 0;
      var pb = b.item.pin ? 1 : 0;
      if (pa !== pb) return pb - pa;
      var da = a.item.date || '';
      var db = b.item.date || '';
      if (da !== db) return da < db ? 1 : -1;
      return a.i - b.i;
    }).map(function (x) { return x.item; });
  }

  // 纯日期倒序：首页横幅与首页列表用这个
  // 横幅是「新闻位」，一直挂着置顶的旧公告没有意义，所以置顶不参与首页排序。
  function byDate(items) {
    return usable(items).sort(function (a, b) {
      var da = a.item.date || '';
      var db = b.item.date || '';
      if (da !== db) return da < db ? 1 : -1;
      return a.i - b.i;
    }).map(function (x) { return x.item; });
  }

  /* ---------------- 元素构造（复刻原手写 DOM，样式零改动） ---------------- */

  function makeTime(item) {
    var t = document.createElement('time');
    t.className = 'notice-date';
    t.setAttribute('datetime', item.date || '');
    t.textContent = formatDate(item.date);
    return t;
  }

  function makeTag(label, accent) {
    var s = document.createElement('span');
    s.className = 'tag' + (accent ? ' tag--accent' : '');
    s.textContent = label;
    return s;
  }

  // 公告页条目：<article class="notice [notice--pin]" id="notice-xxx">
  function makeArticle(item) {
    var art = document.createElement('article');
    art.className = 'notice' + (item.pin ? ' notice--pin' : '');
    if (item.id) art.id = item.id;

    var head = document.createElement('div');
    head.className = 'notice-head';
    head.appendChild(makeTime(item));
    if (item.pin) head.appendChild(makeTag('置顶', true));
    (item.tags || []).forEach(function (tag) {
      if (tag) head.appendChild(makeTag(tag, false));
    });
    art.appendChild(head);

    var h3 = document.createElement('h3');
    h3.textContent = item.title || '';
    art.appendChild(h3);

    (item.body || []).forEach(function (para) {
      if (para == null || para === '') return;
      var p = document.createElement('p');
      p.appendChild(frag(para));
      art.appendChild(p);
    });
    return art;
  }

  // 首页一行：<a class="notice-row" href="notice.html#notice-xxx">
  function makeRow(item) {
    var a = document.createElement('a');
    a.className = 'notice-row';
    a.href = 'notice.html' + (item.id ? '#' + item.id : '');
    a.appendChild(makeTime(item));

    var title = document.createElement('span');
    title.className = 'notice-title';
    title.textContent = item.title || '';
    a.appendChild(title);

    var arrow = document.createElement('span');
    arrow.className = 'notice-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';
    a.appendChild(arrow);
    return a;
  }

  /* ---------------- 各处渲染 ---------------- */

  function fill(host, nodes) {
    if (!host) return;
    host.textContent = '';
    for (var i = 0; i < nodes.length; i++) host.appendChild(nodes[i]);
  }

  function renderRibbon(data, latest) {
    var host = document.querySelector('[data-notice-ribbon]');
    if (!host) return;
    // 横幅 = 最新一条（公告页里的置顶不参与，免得横幅长期挂着旧公告）
    var item = latest[0];
    if (!item) {
      host.textContent = '暂无公告';
      return;
    }
    host.textContent = item.title || '';
    host.setAttribute('title', formatDate(item.date) + ' · ' + (item.title || ''));
  }

  function renderHomeList(data, list) {
    var host = document.querySelector('[data-notice-list]');
    if (!host) return;
    var limit = parseInt(host.getAttribute('data-limit'), 10);
    if (!(limit > 0)) limit = DEFAULT_LIMIT;
    fill(host, list.slice(0, limit).map(makeRow));
  }

  function renderPage(list) {
    var host = document.querySelector('[data-notice-page]');
    if (!host) return;
    fill(host, list.map(makeArticle));
  }

  function renderAlert(data) {
    var host = document.querySelector('[data-notice-alert]');
    if (!host) return;
    var alert = data.alert;
    if (!alert || !alert.body) {
      host.hidden = true;
      host.textContent = '';
      return;
    }
    host.hidden = false;
    host.textContent = '';

    var icon = document.createElement('span');
    icon.className = 'alert-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '!';
    host.appendChild(icon);

    var body = document.createElement('div');
    body.className = 'alert-body';
    if (alert.title) {
      var t = document.createElement('p');
      t.className = 'alert-title';
      t.textContent = alert.title;
      body.appendChild(t);
    }
    var p = document.createElement('p');
    p.appendChild(frag(alert.body));
    body.appendChild(p);
    host.appendChild(body);
  }

  function renderCounts(n) {
    var nodes = document.querySelectorAll('[data-notice-count]');
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = String(n);
  }

  function renderAll(data) {
    var all = ordered(data.items);     // 公告页：置顶优先
    var latest = byDate(data.items);   // 横幅与首页：最新优先
    renderRibbon(data, latest);
    renderHomeList(data, latest);
    renderPage(all);
    renderAlert(data);
    renderCounts(all.length);
    return all.length;
  }

  /* ---------------- 加载与启动 ---------------- */

  var loading = null;

  function load() {
    if (loading) return loading;
    // 加时间戳 + no-store：改完 JSON 不会读到浏览器或 CDN 的旧副本
    loading = window.fetch(DATA_URL + '?t=' + Date.now(), {
      cache: 'no-store',
      credentials: 'same-origin'
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
    return loading;
  }

  function placeholder(text) {
    var hosts = document.querySelectorAll('[data-notice-list], [data-notice-page]');
    for (var i = 0; i < hosts.length; i++) {
      hosts[i].textContent = '';
      var p = document.createElement('p');
      p.className = 'group-hint';
      p.textContent = text;
      hosts[i].appendChild(p);
    }
  }

  function refresh() {
    var host = document.querySelector('[data-notice-ribbon], [data-notice-list], [data-notice-page], [data-notice-alert]');
    if (!host) return null; // 本页没有公告容器，直接跳过，不浪费请求

    return load().then(function (data) {
      var count = renderAll(data || {});
      document.dispatchEvent(new CustomEvent(EVENT, { detail: { count: count } }));
      return count;
    }).catch(function (err) {
      if (window.console && window.console.error) window.console.error('[notices] 公告加载失败：', err);
      placeholder('公告加载失败，请刷新页面重试。');
      document.dispatchEvent(new CustomEvent('notices:failed', { detail: { error: err } }));
      return null;
    });
  }

  window.Notices = {
    refresh: refresh,
    url: DATA_URL
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh);
  } else {
    refresh();
  }
})(window, document);

