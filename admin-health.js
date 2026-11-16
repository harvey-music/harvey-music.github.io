/* ============================================================
   Arthur Studio · 后台「系统健康」演示模块 admin-health.js
   —— 仅界面占位，不接入任何真实监测 / 统计。
   —— 所有状态点显示“未接入”，不伪造“正常/异常”。
   ============================================================ */
(function (window, document) {
  'use strict';

  var host = document.querySelector('[data-as-health]');
  if (!host) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  var services = [
    { name: 'GitHub Pages 托管', desc: '静态页面托管与发布' },
    { name: '静态资源', desc: 'logo / 图片 / 安装包直链' },
    { name: '数据服务（Supabase）', desc: '账号与留言（本期不接入）' },
    { name: '下载存储（COS）', desc: '软件安装包对象存储' }
  ];

  var grid = el('div', 'adm2-demo-grid');
  services.forEach(function (s) {
    var card = el('div', 'adm2-demo-card');
    card.appendChild(el('h4', null, s.name));
    card.appendChild(el('p', null, s.desc));
    card.appendChild(el('span', 'adm2-dot adm2-dot--na', '未接入'));
    grid.appendChild(card);
  });
  host.appendChild(grid);

  var meta = el('p', 'form-hint', '系统健康仅提供界面框架，不反映真实服务状态，也不包含任何真实统计数据。');
  host.appendChild(meta);
})(window, document);
