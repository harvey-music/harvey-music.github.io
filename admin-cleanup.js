/* ============================================================
   站长后台 · 游客清理面板 admin-cleanup.js
   —— 三个按钮：身份审计 / 预览候选 / 执行清理
   —— 全部走 RPC（函数内部再判 is_admin），前端只是入口。
   —— 等 admin.js 判权通过后（admin:ready）才绑定按钮。
   ============================================================ */
(function (window, document) {
  'use strict';
  if (!window.SiteCore) return;
  var core = window.SiteCore;

  var msgEl = document.querySelector('[data-cleanup-msg]');
  var resultEl = document.querySelector('[data-cleanup-result]');
  var auditBtn = document.querySelector('[data-cleanup-audit]');
  var previewBtn = document.querySelector('[data-cleanup-preview]');
  var executeBtn = document.querySelector('[data-cleanup-execute]');
  if (!resultEl) return;

  var sb = null;
  try { sb = core.getClient(); } catch (e) { say(e.message, 'error'); return; }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function say(text, kind) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.className = 'form-msg' + (kind ? ' is-' + kind : '');
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    return core.fmtTime ? core.fmtTime(iso) : String(iso).slice(0, 16);
  }

  function table(headers) {
    var t = el('table', 'adm-table');
    var thead = el('thead');
    var hr = el('tr');
    headers.forEach(function (h) { hr.appendChild(el('th', null, h)); });
    thead.appendChild(hr);
    t.appendChild(thead);
    var tbody = el('tbody');
    t.appendChild(tbody);
    return { table: t, body: tbody };
  }

  function row(tbody, cells) {
    var tr = el('tr');
    cells.forEach(function (c) {
      tr.appendChild(el('td', c.cls || null, c.text));
    });
    tbody.appendChild(tr);
  }

  function busy(btn, on, label) {
    if (!btn) return;
    btn.disabled = on;
    if (label) btn.textContent = label;
  }

  function runAudit() {
    busy(auditBtn, true, '查询中…');
    say('正在检查身份异常账户…');
    sb.rpc('cleanup_identity_audit').then(function (res) {
      busy(auditBtn, false, '身份审计');
      if (res.error) { say('审计失败：' + core.errorText(res.error), 'error'); return; }
      var rows = res.data || [];
      resultEl.innerHTML = '';
      if (!rows.length) {
        resultEl.appendChild(el('p', 'form-hint', '没有身份异常账户。'));
        say('审计完成：无异常。', 'ok');
        return;
      }
      var t = table(['UID', '昵称 / 邮箱', '异常类型']);
      rows.forEach(function (r) {
        row(t.body, [
          { text: (r.uid || '').slice(0, 8) + '…' },
          { text: r.username || r.email || '—' },
          { text: r.anomaly_type, cls: 'dim' }
        ]);
      });
      resultEl.appendChild(t.table);
      say('审计完成：发现 ' + rows.length + ' 个异常账户（只报告，不删除）。', 'ok');
    });
  }

  function runPreview() {
    busy(previewBtn, true, '查询中…');
    say('正在列出清理候选…');
    sb.rpc('cleanup_guests_preview').then(function (res) {
      busy(previewBtn, false, '预览候选');
      if (res.error) { say('预览失败：' + core.errorText(res.error), 'error'); return; }
      var rows = res.data || [];
      resultEl.innerHTML = '';
      if (!rows.length) {
        resultEl.appendChild(el('p', 'form-hint', '当前没有进入清理候选的游客。'));
        say('预览完成：无候选。', 'ok');
        return;
      }
      var t = table(['昵称', '最后活动', '可删除', '说明']);
      rows.forEach(function (r) {
        row(t.body, [
          { text: r.username || (r.uid || '').slice(0, 8) },
          { text: fmtTime(r.last_active_at) },
          { text: r.can_delete ? '是' : '否', cls: r.can_delete ? 'num' : 'dim' },
          { text: r.block_reason || '无数据，可安全清理' }
        ]);
      });
      resultEl.appendChild(t.table);
      var can = rows.filter(function (r) { return r.can_delete; }).length;
      say('预览完成：共 ' + rows.length + ' 个候选，其中 ' + can + ' 个可安全删除。', 'ok');
    });
  }

  function runExecute() {
    if (!window.confirm('确定要清理游客吗？将删除「15 天无活动且无任何业务数据」的游客账户，此操作不可恢复。建议先执行「预览候选」核对。')) return;
    busy(executeBtn, true, '清理中…');
    say('正在执行清理…');
    sb.rpc('cleanup_guests_execute').then(function (res) {
      busy(executeBtn, false, '执行清理');
      if (res.error) { say('清理失败：' + core.errorText(res.error), 'error'); return; }
      var n = res.data || 0;
      say('清理完成：删除了 ' + n + ' 个游客账户。', 'ok');
      runPreview();
    });
  }

  document.addEventListener('admin:ready', function () {
    if (auditBtn) auditBtn.addEventListener('click', runAudit);
    if (previewBtn) previewBtn.addEventListener('click', runPreview);
    if (executeBtn) executeBtn.addEventListener('click', runExecute);
  });
})(window, document);
