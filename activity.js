/* ============================================================
   活动心跳 activity.js
   —— 用户真实使用网站时，定期调 touch_activity() 更新
      profiles.last_active_at，作为游客 15 天清理的「最后活动」依据。
   —— 只在「真实前台使用」时心跳：后台标签页暂停、长时间无操作停止，
      避免「仅打开页面就永久保持活跃」。
   —— 5 分钟节流（后端 RPC 内还会再拦一次，双保险）。
   ============================================================ */
(function (window, document) {
  'use strict';

  if (!window.SiteCore) return;

  var MIN_INTERVAL = 5 * 60 * 1000; // 5 分钟
  var lastBeat = 0;
  var beating = false;

  function beat() {
    if (document.hidden) return;               // 后台标签页不心跳
    var now = Date.now();
    if (now - lastBeat < MIN_INTERVAL) return; // 节流
    lastBeat = now;
    if (beating) return;
    beating = true;

    try {
      var sb = window.SiteCore.getClient();
      sb.rpc('touch_activity')
        .then(function () { beating = false; })
        .catch(function () { beating = false; }); // 未登录/网络失败静默
    } catch (err) {
      beating = false;
    }
  }

  // 页面加载完成 → 心跳一次
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', beat);
  } else {
    beat();
  }

  // 真实用户活动才心跳：点击、键盘、滚动、触摸、鼠标移动
  ['click', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(function (evt) {
    document.addEventListener(evt, beat, { passive: true, capture: true });
  });

  // 从后台切回前台 → 立即补一次
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) beat();
  });
})(window, document);
