/* ============================================================
   Arthur Studio · 后台「系统设置」演示模块 admin-settings.js
   —— 仅演示交互；任何开关都只改本地 UI，点击会明确提示
      「不会保存、不影响生产配置」，绝不伪造保存成功。
   —— 不修改认证 / MFA / 权限等任何业务逻辑。
   ============================================================ */
(function (window, document) {
  'use strict';

  var host = document.querySelector('[data-as-settings]');
  if (!host) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  var msg = el('p', 'form-msg', '');
  msg.setAttribute('role', 'status');

  function say(text) {
    msg.textContent = text;
  }

  var card = el('div', 'adm-card');

  function row(label, hint) {
    var r = el('div', 'adm2-switch-row');
    var l = el('label', 'adm2-switch-label', label);
    var small = el('small', null, hint);
    l.appendChild(small);
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('change', function () {
      input.checked = !input.checked; // 立即回弹，绝不“保存”
      say('演示模式：此开关仅演示交互，不会保存、不影响生产配置。');
    });
    r.appendChild(l);
    r.appendChild(input);
    return r;
  }

  card.appendChild(el('h3', 'adm-card-title', '站点设置（演示）'));
  card.appendChild(row('公告维护提醒', '演示项，不会生效'));
  card.appendChild(row('下载闸门严格模式', '演示项，不会生效'));
  card.appendChild(row('留言审核开关', '演示项，不会生效'));

  // 两步验证：仅说明入口，不改变现有 MFA 逻辑
  var mfa = el('div', 'adm-card');
  mfa.style.marginTop = '16px';
  mfa.appendChild(el('h3', 'adm-card-title', '两步验证（MFA）'));
  mfa.appendChild(el('p', 'form-hint', '两步验证的绑定与校验在进入后台前完成（登录后自动弹出），此处仅为说明，不提供额外入口。'));

  host.appendChild(card);
  host.appendChild(mfa);
  host.appendChild(msg);
})(window, document);
