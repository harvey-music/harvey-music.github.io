/* ============================================================
   站长后台 · 公告管理 admin-notices.js
   —— 写操作全部走 RPC（notice_save / notice_delete），函数内部
      再判 private.is_admin()，前端按钮只是入口，绕过也改不了。
   —— 等 admin.js 判权通过后（admin:ready）才加载列表。
   ============================================================ */
(function (window, document) {
  'use strict';
  if (!window.SiteCore) return;
  var core = window.SiteCore;

  var formEl = document.querySelector('[data-notice-form]');
  var listEl = document.querySelector('[data-notice-list]');
  var msgEl = document.querySelector('[data-notice-msg]');
  if (!formEl && !listEl) return;

  var sb = null;
  try { sb = core.getClient(); } catch (err) { say(err.message, 'error'); return; }

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

  function today() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function load() {
    if (listEl) {
      listEl.innerHTML = '';
      listEl.appendChild(el('p', 'form-hint', '加载中…'));
    }
    sb.rpc('notice_list_admin').then(function (res) {
      if (res.error) {
        var t = core.errorText(res.error);
        say('公告列表读取失败：' + t, 'error');
        if (listEl) { listEl.innerHTML = ''; listEl.appendChild(el('p', 'form-hint', '读取失败：' + t)); }
        return;
      }
      render(res.data || []);
    });
  }

  function render(rows) {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!rows.length) {
      listEl.appendChild(el('p', 'form-hint', '还没有公告。用上面的表单发布第一条。'));
      return;
    }
    rows.forEach(function (r) { listEl.appendChild(row(r)); });
  }

  function badge(r) {
    if (r.hidden) return el('span', 'adm-status adm-status--hidden', '已下架');
    if (r.pin) return el('span', 'adm-status adm-status--pin', '置顶 · 公开');
    return el('span', 'adm-status', '公开');
  }

  function row(r) {
    var wrap = el('div', 'adm-notice' + (r.hidden ? ' is-hidden' : ''));

    var main = el('div', 'adm-notice-main');
    main.appendChild(el('div', 'adm-notice-title', r.title || '(无标题)'));
    main.appendChild(el('div', 'adm-notice-meta', (r.date || '') + '  ·  ' + (r.id || '')));

    var ops = el('div', 'adm-ops');
    ops.appendChild(badge(r));

    var pinBtn = el('button', 'btn btn-ghost btn--sm', r.pin ? '取消置顶' : '置顶');
    pinBtn.type = 'button';
    pinBtn.addEventListener('click', function () { save(r, { pin: !r.pin }, pinBtn); });
    ops.appendChild(pinBtn);

    var hideBtn = el('button', 'btn btn-ghost btn--sm', r.hidden ? '发布' : '下架');
    hideBtn.type = 'button';
    hideBtn.addEventListener('click', function () { save(r, { hidden: !r.hidden }, hideBtn); });
    ops.appendChild(hideBtn);

    var editBtn = el('button', 'btn btn-ghost btn--sm', '编辑');
    editBtn.type = 'button';
    editBtn.addEventListener('click', function () { fillForm(r); });
    ops.appendChild(editBtn);

    var delBtn = el('button', 'btn btn--danger btn--sm', '删除');
    delBtn.type = 'button';
    delBtn.addEventListener('click', function () {
      if (!window.confirm('确定彻底删除公告「' + (r.title || r.id) + '」？删除后不可恢复；只想临时下架请用「下架」。')) return;
      delBtn.disabled = true;
      sb.rpc('notice_delete', { p_id: r.id }).then(function (res) {
        delBtn.disabled = false;
        if (res.error) { say('删除失败：' + core.errorText(res.error), 'error'); return; }
        say('已删除。', 'ok');
        load();
      });
    });
    ops.appendChild(delBtn);

    wrap.appendChild(main);
    wrap.appendChild(ops);
    return wrap;
  }

  function save(r, patch, btn) {
    if (btn) btn.disabled = true;
    sb.rpc('notice_save', {
      p_id: r.id,
      p_date: r.date,
      p_tags: r.tags || [],
      p_pin: patch.pin !== undefined ? patch.pin : !!r.pin,
      p_hidden: patch.hidden !== undefined ? patch.hidden : !!r.hidden,
      p_title: r.title,
      p_body: r.body || []
    }).then(function (res) {
      if (btn) btn.disabled = false;
      if (res.error) { say('操作失败：' + core.errorText(res.error), 'error'); return; }
      say('已保存。', 'ok');
      load();
    });
  }

  function fillForm(r) {
    if (!formEl) return;
    formEl.elements.id.value = r.id || '';
    formEl.elements.date.value = r.date || today();
    formEl.elements.title.value = r.title || '';
    formEl.elements.tags.value = (r.tags || []).join(', ');
    formEl.elements.body.value = (r.body || []).join('\n');
    formEl.elements.pin.checked = !!r.pin;
    formEl.elements.hidden.checked = !!r.hidden;
    if (formEl.scrollIntoView) formEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (formEl && formEl.elements.date && !formEl.elements.date.value) {
    formEl.elements.date.value = today();
  }

  if (formEl) {
    formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = formEl.elements;
      var id = (f.id.value || '').trim();
      var title = (f.title.value || '').trim();
      var date = (f.date.value || '').trim();
      var body = (f.body.value || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      var tags = (f.tags.value || '').split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);

      if (!/^[a-z0-9-]+$/.test(id)) { say('锚点名只能用小写字母、数字和连字符。', 'error'); return; }
      if (!title) { say('标题不能为空。', 'error'); return; }
      if (!date) { say('请选择日期。', 'error'); return; }
      if (!body.length) { say('正文不能为空。', 'error'); return; }

      var btn = formEl.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
      sb.rpc('notice_save', {
        p_id: id,
        p_date: date,
        p_tags: tags,
        p_pin: !!f.pin.checked,
        p_hidden: !!f.hidden.checked,
        p_title: title,
        p_body: body
      }).then(function (res) {
        if (btn) { btn.disabled = false; btn.textContent = '发布 / 保存'; }
        if (res.error) { say('保存失败：' + core.errorText(res.error), 'error'); return; }
        say('已保存，前台约数秒内生效。', 'ok');
        formEl.reset();
        if (formEl.elements.date) formEl.elements.date.value = today();
        load();
      });
    });
  }

  document.addEventListener('admin:ready', load);
})(window, document);
