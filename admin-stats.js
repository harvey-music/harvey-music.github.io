/* ============================================================
   站长后台 · 下载统计 admin-stats.js
   —— 数据走 dl_stats() RPC（内部判权，客户端读不到 downloads 表）。
   —— 等 admin.js 判权通过后（admin:ready）才加载。
   ============================================================ */
(function (window, document) {
  'use strict';
  if (!window.SiteCore) return;
  var core = window.SiteCore;

  var host = document.querySelector('[data-stats]');
  if (!host) return;

  var sb = null;
  try { sb = core.getClient(); } catch (err) {
    host.innerHTML = '';
    host.appendChild(el('p', 'form-hint', '统计不可用：' + err.message));
    return;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function load() {
    host.innerHTML = '';
    host.appendChild(el('p', 'form-hint', '加载中…'));
    sb.rpc('dl_stats').then(function (res) {
      if (res.error) {
        host.innerHTML = '';
        host.appendChild(el('p', 'form-hint', '统计读取失败：' + core.errorText(res.error)));
        return;
      }
      render(res.data || {});
    });
  }

  function render(data) {
    host.innerHTML = '';
    var total = data.total || 0;
    var top = data.top || [];
    var days = data.days || [];

    // ---- 概览卡片 ----
    var grid = el('div', 'adm-stat-grid');
    grid.appendChild(stat(total, '总下载次数'));
    grid.appendChild(stat(top.length, '被下载的项目数'));
    var todayCnt = days.length ? days[days.length - 1].cnt : 0;
    grid.appendChild(stat(todayCnt, '今天下载'));
    grid.appendChild(stat(top.length ? top[0].cnt : 0, '最高单项'));
    host.appendChild(grid);

    // ---- 近 30 天趋势 ----
    var trendTitle = el('h3', 'adm-card-title', '近 30 天下载趋势');
    trendTitle.style.marginTop = '26px';
    host.appendChild(trendTitle);
    host.appendChild(trend(days));

    // ---- 排行 ----
    var rankTitle = el('h3', 'adm-card-title', '按软件 / 文件排行');
    rankTitle.style.marginTop = '26px';
    host.appendChild(rankTitle);
    host.appendChild(ranking(top));
  }

  function stat(n, label) {
    var box = el('div', 'adm-stat');
    box.appendChild(el('b', null, String(n)));
    box.appendChild(el('span', null, label));
    return box;
  }

  function trend(days) {
    if (!days || !days.length) return el('p', 'form-hint', '还没有下载记录。');
    var max = 1;
    days.forEach(function (d) { if (d.cnt > max) max = d.cnt; });

    var bars = el('div', 'adm-bars');
    days.forEach(function (d) {
      var pct = Math.round((d.cnt / max) * 100);
      var bar = el('div', d.cnt ? 'adm-bar' : 'adm-bar is-zero');
      bar.style.height = Math.max(pct, d.cnt ? 3 : 2) + '%';
      bar.title = d.day + ' · ' + d.cnt + ' 次';
      bars.appendChild(bar);
    });

    var labels = el('div', 'adm-bar-labels');
    days.forEach(function (d, i) {
      var span = el('span');
      if (i % 5 === 0 || i === days.length - 1) span.textContent = shortDay(d.day);
      labels.appendChild(span);
    });

    var wrap = el('div');
    wrap.appendChild(bars);
    wrap.appendChild(labels);
    return wrap;
  }

  function shortDay(day) {
    var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(day || '');
    return m ? m[1] + '-' + m[2] : day;
  }

  function ranking(top) {
    if (!top || !top.length) return el('p', 'form-hint', '还没有下载记录。');

    var table = el('table', 'adm-table');
    var thead = el('thead');
    var hr = el('tr');
    hr.appendChild(el('th', null, '软件 / 文件'));
    hr.appendChild(el('th', null, '类型'));
    hr.appendChild(el('th', null, '次数'));
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el('tbody');
    top.slice(0, 30).forEach(function (r) {
      var tr = el('tr');
      var tdKey = el('td');
      tdKey.textContent = r.key || 'unknown';
      tr.appendChild(tdKey);
      tr.appendChild(el('td', 'dim', r.kind || 'download'));
      tr.appendChild(el('td', 'num', String(r.cnt)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  document.addEventListener('admin:ready', load);
})(window, document);
