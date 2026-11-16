/* ============================================================
   Arthur Studio · 后台「汉化项目」演示模块 admin-hanhua.js
   —— 只读展示三个汉化项目的静态进度卡片，明确标注演示模式。
   —— 数据与各产品页一致，不新增接口、不写任何内容。
   ============================================================ */
(function (window, document) {
  'use strict';

  var host = document.querySelector('[data-as-hanhua]');
  if (!host) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  var projects = [
    { name: 'Silverdaw 中文汉化', status: '已发布', ver: '完整版 1.9.0', pct: 100, note: '完整中文本地化，菜单 · 面板 · 提示 · 报错。' },
    { name: 'Prism 中文汉化', status: '已发布', ver: '0.4.0-beta', pct: 100, note: '八种仪表，安装包与便携版两种形式。' },
    { name: 'Chatbox 中文汉化', status: '制作中', ver: '尚未发布', pct: 68, note: '界面文本约完成 68%，暂不提供安装包。' }
  ];

  var grid = el('div', 'adm2-demo-grid');
  projects.forEach(function (p) {
    var card = el('div', 'adm2-demo-card');
    var h = el('h4', null, p.name);
    var bar = el('div', 'adm2-bar');
    var fill = el('span');
    fill.style.width = p.pct + '%';
    bar.appendChild(fill);
    var meta = el('span', 'adm2-meta', p.status + ' · ' + p.ver + ' · 进度 ' + p.pct + '%');
    var note = el('p', null, p.note);
    card.appendChild(h);
    card.appendChild(meta);
    card.appendChild(bar);
    card.appendChild(note);
    grid.appendChild(card);
  });
  host.appendChild(grid);
  host.appendChild(el('p', 'form-hint', '项目信息当前硬编码于各产品页，后台的项目/版本/进度管理尚未接入。'));
})(window, document);
