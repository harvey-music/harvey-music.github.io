/* ============================================================
   Arthur Studio · 后台「软件管理」演示模块 admin-software.js
   —— 只读渲染 data/downloads.json 的现有条目（与 softlib.html
      同一份静态数据），明确标注「演示模式 · 暂未接入 CRUD」。
   —— 不新增数据接口、不伪造保存、不写任何内容。
   ============================================================ */
(function (window, document) {
  'use strict';

  var host = document.querySelector('[data-as-software]');
  if (!host) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  host.appendChild(el('p', 'form-hint', '正在读取只读快照（data/downloads.json）…'));

  fetch('data/downloads.json', { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      var items = (data && data.items) || {};
      var keys = Object.keys(items);
      host.innerHTML = '';

      if (!keys.length) {
        host.appendChild(el('p', 'form-hint', '没有条目。'));
        return;
      }

      var table = el('table', 'adm2-list');
      var thead = el('thead');
      var hr = el('tr');
      hr.appendChild(el('th', null, '名称'));
      hr.appendChild(el('th', null, '版本'));
      hr.appendChild(el('th', null, '大小'));
      hr.appendChild(el('th', null, '直链'));
      thead.appendChild(hr);
      table.appendChild(thead);

      var tbody = el('tbody');
      keys.forEach(function (k) {
        var it = items[k] || {};
        var tr = el('tr');
        tr.appendChild(el('td', null, it.name || k));
        tr.appendChild(el('td', null, it.ver || '—'));
        tr.appendChild(el('td', null, it.size || '—'));
        tr.appendChild(el('td', it.url ? null : 'dim', it.url ? '已上架' : '待上架'));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      host.appendChild(table);
      host.appendChild(el('p', 'form-hint', '共 ' + keys.length + ' 个条目。增删改尚未接入后台，请继续通过 data/downloads.json 维护直链。'));
    })
    .catch(function (err) {
      host.innerHTML = '';
      host.appendChild(el('p', 'form-hint', '只读快照读取失败（演示模式）：' + err.message));
    });
})(window, document);
