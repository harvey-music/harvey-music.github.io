(function (window) {
  'use strict';

  /* ============================================================
     站点与 Supabase 的连接点
     —— 这里只用 Publishable（公开）key：它天生就是给浏览器用的，
        受 RLS 约束，泄露了也读不到别人的待审留言、改不了任何权限。
     —— service_role / secret key 永远不进这个仓库，只在你自己本地用。
     —— 真正拦人的是数据库策略，前端这些判断只是给界面看的。
     ============================================================ */

  var SUPABASE_URL = 'https://fowurkaatlohtiqvqvoc.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_aKWkBeYJh1pHo38dV6bkPQ_PWR7FD44';

  var client = null;

  function getClient() {
    if (client) return client;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('supabase-js 没有加载成功：请确认 vendor/supabase.js 存在并可访问');
    }
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,      // 登录态存 localStorage，换页面不用重登
        autoRefreshToken: true,    // 令牌过期自动续
        detectSessionInUrl: false  // 全程不发邮件，不需要解析地址里的链接令牌
      }
    });
    return client;
  }

  /* ---------- 登录态 ---------- */

  // 返回当前 session（没登录就是 null）
  function session() {
    return getClient().auth.getSession().then(function (res) {
      return res && res.data ? res.data.session : null;
    });
  }

  // 监听登录/登出，cb 收到 session
  function onAuthChange(cb) {
    getClient().auth.onAuthStateChange(function (event, sess) {
      cb(sess || null, event);
    });
  }

  /* ---------- 小工具 ---------- */

  // 昵称首字：兼容中文和 emoji（emoji 占两个码元，不能只取 [0]）
  function firstChar(name) {
    var s = String(name || '?').trim();
    if (!s) return '?';
    var chars = Array.from ? Array.from(s) : s.split('');
    return chars[0].toUpperCase();
  }

  // 昵称 → 稳定色相（0–359），刷新页面颜色不变，也不用存头像图
  function hueOf(name) {
    var s = String(name || '');
    var h = 0;
    for (var i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) % 360000;
    }
    return h % 360;
  }

  // 时间显示成 2026-11-14 21:30（本地时区）
  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // 把 Supabase 的英文报错翻成人话；认不出来的原样返回
  var AUTH_MSG = [
    ['Invalid login credentials', '邮箱或密码不对'],
    ['Email not confirmed', '邮箱还没验证。本站不发送邮件，请联系站长处理'],
    ['User already registered', '这个邮箱已经注册过了，直接登录即可'],
    ['Password should be at least', '密码太短，至少 8 位'],
    ['Unable to validate email address', '邮箱格式不对'],
    ['Email rate limit exceeded', '发送太频繁，稍后再试'],
    ['signup is disabled', '注册通道已关闭'],
    ['New password should be different', '新密码不能和旧密码相同'],
    ['Auth session missing', '登录状态已失效，请重新登录'],
    ['JWT expired', '登录状态已过期，请重新登录'],
    ['该账号已被封禁', '你的账号正在封禁期，暂时不能发言。申诉请发邮件到 zjh041106@qq.com']
  ];

  function errorText(err) {
    if (!err) return '未知错误';
    var raw = String(err.message || err.error_description || err);
    for (var i = 0; i < AUTH_MSG.length; i++) {
      if (raw.indexOf(AUTH_MSG[i][0]) !== -1) return AUTH_MSG[i][1];
    }
    // 数据库约束撞车：昵称重复
    if (err.code === '23505' || raw.indexOf('duplicate key') !== -1) return '这个昵称已经被占用了，换一个试试';
    if (err.code === '23514') return '内容不符合要求，检查一下长度和字符';
    return raw;
  }

  // 站内跳转白名单：只允许本站相对路径，挡掉 //evil.com 这种外跳
  function safeNext(next, fallback) {
    var fb = fallback || 'index.html';
    if (!next) return fb;
    if (/^[a-z][a-z0-9+.-]*:/i.test(next)) return fb;  // 带协议的一律不认
    if (next.charAt(0) === '/' || next.charAt(0) === '\\') return fb;
    if (next.indexOf('//') === 0) return fb;
    return next;
  }

  window.SiteCore = {
    url: SUPABASE_URL,
    getClient: getClient,
    session: session,
    onAuthChange: onAuthChange,
    firstChar: firstChar,
    hueOf: hueOf,
    fmtTime: fmtTime,
    errorText: errorText,
    safeNext: safeNext
  };
})(window);
