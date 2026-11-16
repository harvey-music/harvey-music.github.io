/* ============================================================
   Arthur Studio · 后台外壳交互 admin-shell.js
   —— 纯 UI：侧栏导航切换、移动端抽屉、总览 KPI 聚合、淡入。
   —— 不连接 Supabase、不新增接口、不触碰任何业务脚本逻辑。
   —— KPI 只“观察”现有 data-* 容器的变化来填数，绝不伪造结果：
       未加载显示骨架（加载中），加载完成填真实数字（含真实的 0），
       读取失败显示“—”，演示模块单独标注。
   ============================================================ */
(function (window, document) {
  'use strict';

  var shell = document.querySelector('.adm2-shell');
  if (!shell) return;

  /* ---------- 抽屉（移动端侧栏） ---------- */
  var drawerBtn = document.querySelector('[data-as-drawer]');
  var overlay = document.createElement('div');
  overlay.className = 'adm2-drawer-overlay';
  shell.appendChild(overlay);

  function openDrawer() { shell.classList.add('is-drawer-open'); }
  function closeDrawer() { shell.classList.remove('is-drawer-open'); }

  if (drawerBtn) {
    drawerBtn.addEventListener('click', function () {
      shell.classList.toggle('is-drawer-open');
    });
  }
  overlay.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer();
  });

  /* ---------- 模块切换 ---------- */
  function currentTab(name) {
    var tabs = document.querySelectorAll('[data-as-tab]');
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute('data-as-tab') === name) return tabs[i];
    }
    return null;
  }

  function showPanel(name) {
    var panels = document.querySelectorAll('[data-as-panel]');
    var found = false;
    for (var i = 0; i < panels.length; i++) {
      var p = panels[i];
      var on = p.getAttribute('data-as-panel') === name;
      if (on) found = true;
      p.hidden = !on;
      if (on) {
        // 每次切过来都重新淡入
        p.classList.remove('adm2-fade', 'is-in');
        void p.offsetWidth;
        p.classList.add('adm2-fade', 'is-in');
      }
    }
    if (!found) return;

    var tabs = document.querySelectorAll('[data-as-tab]');
    for (var j = 0; j < tabs.length; j++) {
      var t = tabs[j];
      var active = t.getAttribute('data-as-tab') === name;
      t.classList.toggle('is-active', active);
      if (active) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    }

    var title = document.querySelector('[data-as-topbar-title]');
    var tab = currentTab(name);
    if (title && tab) {
      var label = tab.querySelector('span');
      title.textContent = label ? label.textContent.trim() : '';
    }

    closeDrawer();
  }

  var nav = document.querySelector('[data-as-nav]');
  if (nav) {
    nav.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-as-tab]') : null;
      if (!btn) return;
      showPanel(btn.getAttribute('data-as-tab'));
    });
  }

  // 总览里的快捷入口
  document.addEventListener('click', function (e) {
    var jump = e.target && e.target.closest ? e.target.closest('[data-as-jump]') : null;
    if (!jump) return;
    showPanel(jump.getAttribute('data-as-jump'));
  });

  /* ---------- 总览 KPI：观察现有列表，区分加载中 / 真实 / 失败 ---------- */
  function syncKpi(kpi) {
    var watchSel = kpi.getAttribute('data-as-watch');
    var srcSel = kpi.getAttribute('data-as-src');
    if (!watchSel || !srcSel) return;
    var watch = document.querySelector(watchSel);
    if (!watch) return;
    var val = kpi.querySelector('[data-as-value]');
    var text = (watch.textContent || '');

    // 读取失败：容器里出现了“失败”字样
    if (/失败/.test(text)) {
      kpi.classList.remove('is-loading');
      kpi.classList.add('is-error');
      if (val) val.textContent = '—';
      return;
    }
    // 真实数据已到：容器里有条目或空态占位
    if (watch.querySelector('.adm-stat, .gb-item, .gb-empty')) {
      kpi.classList.remove('is-loading', 'is-error');
      var src = document.querySelector(srcSel);
      if (val && src) val.textContent = src.textContent;
      return;
    }
    // 否则保持“加载中”（骨架），不显示任何数字
    kpi.classList.add('is-loading');
    kpi.classList.remove('is-error');
    if (val) val.textContent = '—';
  }

  function initKpis() {
    var kpis = document.querySelectorAll('[data-as-kpi]');
    for (var i = 0; i < kpis.length; i++) {
      (function (kpi) {
        var watchSel = kpi.getAttribute('data-as-watch');
        if (!watchSel) return;
        var watch = document.querySelector(watchSel);
        if (!watch) return;
        syncKpi(kpi);
        if (window.MutationObserver) {
          var mo = new MutationObserver(function () { syncKpi(kpi); });
          mo.observe(watch, { childList: true, subtree: true, characterData: true });
        }
      })(kpis[i]);
    }
  }

  // 待审/全部留言列表加载失败时列表保持为空，需要靠全局提示兜底标记“读取失败”
  function initGlobalErrorWatch() {
    var msg = document.querySelector('[data-admin-msg]');
    if (!msg || !window.MutationObserver) return;
    var mo = new MutationObserver(function () {
      if (!/读取失败/.test(msg.textContent || '')) return;
      var loading = document.querySelectorAll('[data-as-kpi].is-loading');
      for (var i = 0; i < loading.length; i++) {
        loading[i].classList.remove('is-loading');
        loading[i].classList.add('is-error');
        var v = loading[i].querySelector('[data-as-value]');
        if (v) v.textContent = '—';
      }
    });
    mo.observe(msg, { childList: true, subtree: true, characterData: true });
  }

  initKpis();
  initGlobalErrorWatch();
  showPanel('dashboard');

  // 站长验证通过后，总览重新淡入一次
  document.addEventListener('admin:ready', function () {
    var dash = document.querySelector('[data-as-panel="dashboard"]');
    if (dash) {
      dash.classList.remove('adm2-fade', 'is-in');
      void dash.offsetWidth;
      dash.classList.add('adm2-fade', 'is-in');
    }
  });
})(window, document);
