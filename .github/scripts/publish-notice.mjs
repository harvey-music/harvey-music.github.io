#!/usr/bin/env node
/* ===================================================================
   公告发布 publish-notice.mjs
   -------------------------------------------------------------------
   把「发布公告」Issue 表单（.github/ISSUE_TEMPLATE/notice.yml）的内容
   写进 data/notices.json。由 .github/workflows/publish-notice.yml 在
   issue 打开 / 编辑时调用。

   为什么用 Issue 当入口：站是纯静态托管，浏览器里存任何密钥都有泄露
   风险；改由 GitHub 承担鉴权，工作流只用仓库自带的 GITHUB_TOKEN，因此
   不存在需要保管的密钥。代价是要离开网站填写、约 1 分钟后上线。

   安全：Issue 人人可开，所以只接受仓库所有者（ALLOWED_AUTHORS 可额外
   放行几个用户名）提交的内容，其他人的提交直接报错退出，不碰文件。

   防重复：同一条 Issue 再次编辑提交时，按 id 末尾的 issue 编号找回原
   条目并原地替换，所以编辑等于修改，不会多出一条。

   用法：
     node .github/scripts/publish-notice.mjs            写入 data/notices.json
     node .github/scripts/publish-notice.mjs --dry-run  只把结果 JSON 打到 stdout
     node .github/scripts/publish-notice.mjs --data a.json --dry-run

   环境变量（工作流注入）：
     ISSUE_BODY     Issue 正文
     ISSUE_NUMBER   Issue 编号
     ISSUE_AUTHOR   提交者用户名
     ISSUE_ACTION   opened / edited
     REPO_OWNER     仓库所有者用户名
     ALLOWED_AUTHORS 可选，逗号分隔的额外用户名
   =================================================================== */

import fs from 'node:fs';
import path from 'node:path';

class NoticeError extends Error {}

function fail(msg) {
  throw new NoticeError(msg);
}

/* ---------------- 参数与环境 ---------------- */

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const dataArgIndex = argv.indexOf('--data');
const DATA_PATH = path.resolve(dataArgIndex >= 0 ? argv[dataArgIndex + 1] : 'data/notices.json');

const env = process.env;
const ISSUE_BODY = env.ISSUE_BODY || '';
const ISSUE_NUMBER = String(env.ISSUE_NUMBER || '').trim();
const ISSUE_AUTHOR = String(env.ISSUE_AUTHOR || '').trim();
const ISSUE_ACTION = env.ISSUE_ACTION || 'opened';
const REPO_OWNER = String(env.REPO_OWNER || '').trim();

/* 表单字段名必须与 ISSUE_TEMPLATE/notice.yml 里的 label 完全一致 */
const FIELDS = {
  title: '公告标题',
  date: '日期',
  tags: '标签',
  body: '正文',
  anchor: '锚点 id',
  flags: '其他'
};
const FIELD_NAMES = Object.keys(FIELDS).map((k) => FIELDS[k]);

const LIMIT = { title: 120, body: 20000 };

/* ---------------- 小工具 ---------------- */

// 北京时间「今天」：工作流跑在 UTC，直接取本地日期会在早上 8 点前差一天
function todayCN() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function log(msg) {
  // dry-run 时 stdout 只留纯 JSON，日志改走 stderr
  (DRY_RUN ? process.stderr : process.stdout).write(msg + '\n');
}

// 把结果写给工作流的步骤输出，多行内容压成一行免得破坏 GITHUB_OUTPUT 格式
function output(pairs) {
  const file = env.GITHUB_OUTPUT;
  if (!file) return;
  const lines = Object.keys(pairs).map(function (key) {
    const value = String(pairs[key] == null ? '' : pairs[key]).replace(/\r?\n/g, ' ');
    return key + '=' + value;
  });
  fs.appendFileSync(file, lines.join('\n') + '\n', 'utf8');
}

/* ---------------- 解析 Issue 正文 ---------------- */

/* Issue 表单的输出形如：
     ### 公告标题

     Prism 中文汉化已发布

     ### 日期

     2026-11-15
   只认 FIELDS 里列出的字段名，正文里自己写的 ### 小标题不会把内容切断。 */
function parseIssueBody(body) {
  const out = {};
  const seen = {};
  const lines = String(body).split(/\r?\n/);
  let key = null;
  let buf = [];

  function flush() {
    if (!key) return;
    const text = buf.join('\n').trim();
    out[key] = /^_No response_$/i.test(text) ? '' : text;
  }

  for (let i = 0; i < lines.length; i++) {
    const m = /^###[ \t]+(.+?)[ \t]*$/.exec(lines[i]);
    // 每个字段名只认第一次出现：正文里再来一个「### 公告标题」应当算正文
    if (m && FIELD_NAMES.indexOf(m[1]) >= 0 && !seen[m[1]]) {
      flush();
      seen[m[1]] = 1;
      key = m[1];
      buf = [];
      continue;
    }
    if (key) buf.push(lines[i]);
  }
  flush();
  return out;
}

/* 正文 → 段落数组：空行分段，段内换行合并成空格 */
function toParagraphs(text) {
  return String(text || '')
    .split(/\n[ \t]*\n/)
    .map(function (p) {
      return p.replace(/[ \t]*\r?\n[ \t]*/g, ' ').trim();
    })
    .filter(function (p) {
      return p.length > 0;
    });
}

/* 勾选框输出形如 "- [X] 置顶（…）"，只要出现打勾就算选中 */
function hasFlag(block, keyword) {
  const lines = String(block || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*[-*]\s*\[[xX]\]/.test(lines[i]) && lines[i].indexOf(keyword) >= 0) return true;
  }
  return false;
}

// 从 id 末尾取 issue 编号：「notice-20261115-42」→ 42
function issueNumberOf(id) {
  const m = /-(\d+)$/.exec(String(id || ''));
  return m ? Number(m[1]) : null;
}

/* ---------------- 主流程 ---------------- */

function run() {
  /* 1. 作者校验：只认仓库所有者（和白名单），挡住任何人往公告栏塞内容 */
  const allowed = [REPO_OWNER]
    .concat(
      String(env.ALLOWED_AUTHORS || '')
        .split(',')
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean)
    )
    .filter(Boolean);

  if (!ISSUE_AUTHOR) fail('没有拿到 issue 作者（ISSUE_AUTHOR 为空），无法校验发布权限。');
  if (allowed.length && allowed.indexOf(ISSUE_AUTHOR) < 0) {
    fail(
      '只有仓库所有者可以发布公告。\n' +
        '当前提交者：' + ISSUE_AUTHOR + '\n' +
        '允许的账号：' + allowed.join(', ')
    );
  }

  if (!ISSUE_NUMBER) fail('没有拿到 issue 编号（ISSUE_NUMBER 为空）。');

  /* 2. 解析表单 */
  const form = parseIssueBody(ISSUE_BODY);
  if (!Object.keys(form).length) {
    fail('issue 正文不是公告表单格式，找不到「### 公告标题」等字段。请用「发布公告」模板新建。');
  }

  const title = String(form[FIELDS.title] || '').replace(/\s+/g, ' ').trim();
  if (!title) fail('「公告标题」不能为空。');
  if (title.length > LIMIT.title) {
    fail('标题过长（' + title.length + ' 字），请控制在 ' + LIMIT.title + ' 字以内。');
  }

  let date = String(form[FIELDS.date] || '').trim();
  if (!date) date = todayCN();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    fail('「日期」格式应为 YYYY-MM-DD 且月日补零，例如 2026-11-15。当前填写：' + date);
  }
  const parsed = new Date(date + 'T00:00:00Z');
  if (isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    fail('「日期」不是一个真实存在的日期：' + date);
  }

  const tags = String(form[FIELDS.tags] || '')
    .split(',')
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);

  const paragraphs = toParagraphs(form[FIELDS.body]);
  if (!paragraphs.length) fail('「正文」不能为空。');
  const bodyLen = paragraphs.join('').length;
  if (bodyLen > LIMIT.body) {
    fail('正文过长（' + bodyLen + ' 字），请精简后再提交。');
  }

  const pin = hasFlag(form[FIELDS.flags], '置顶');
  const hidden = hasFlag(form[FIELDS.flags], '隐藏');
  const explicitId = String(form[FIELDS.anchor] || '').trim();

  if (explicitId && !/^[A-Za-z0-9_-]+$/.test(explicitId)) {
    fail('「锚点 id」只能用字母、数字、下划线、连字符。当前填写：' + explicitId);
  }

  /* 3. 读现有数据 */
  if (!fs.existsSync(DATA_PATH)) fail('找不到数据文件：' + DATA_PATH);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (err) {
    fail('data/notices.json 不是合法 JSON，先修好它再发布：' + err.message);
  }
  if (!data || !Array.isArray(data.items)) fail('data/notices.json 缺少 items 数组。');

  const items = data.items;

  /* 4. 找回同一条 issue 之前的发布记录，编辑时原地替换 */
  // 优先认 _issue 记录（自定义过锚点 id 的条目也能认回来），
  // 其次是 id 末尾的 issue 编号（早期没有 _issue 字段的条目）
  const issueNo = Number(ISSUE_NUMBER);
  const existingIndex = items.findIndex(function (it) {
    if (it._issue === issueNo) return true;
    return issueNumberOf(it.id) === issueNo;
  });
  const existing = existingIndex >= 0 ? items[existingIndex] : null;

  const finalId =
    explicitId ||
    (existing ? existing.id : 'notice-' + date.replace(/-/g, '') + '-' + ISSUE_NUMBER);

  const clash = items.findIndex(function (it, i) {
    return it.id === finalId && i !== existingIndex;
  });
  if (clash >= 0) fail('锚点 id「' + finalId + '」已被另一条公告占用，换一个。');

  /* 5. 组装条目：字段顺序与现有数据一致，值为 false 的开关不写进文件 */
  const entry = { id: finalId, date: date, tags: tags };
  if (pin) entry.pin = true;
  if (hidden) entry.hidden = true;
  entry.title = title;
  entry.body = paragraphs;
  entry._issue = issueNo; // 记录来源，便于下次编辑找回；渲染时会忽略

  const unchanged = existing ? JSON.stringify(existing) === JSON.stringify(entry) : false;
  if (unchanged) {
    log('内容与现有条目完全一致，不做改动：' + finalId);
    output({ changed: 'false', verb: '更新', notice_id: finalId, notice_title: title });
    return;
  }

  if (existing) items[existingIndex] = entry;
  else items.unshift(entry);

  data.updated = todayCN();
  const text = JSON.stringify(data, null, 2) + '\n';

  const verb = existing ? '更新' : '发布';
  log(verb + '公告：' + finalId);
  log('  日期：' + date);
  log('  标题：' + title);
  log('  标签：' + (tags.length ? tags.join(' / ') : '（无）'));
  log('  段落：' + paragraphs.length + ' 段' + (pin ? '　置顶' : '') + (hidden ? '　隐藏' : ''));
  log('  总数：' + items.length + ' 条' + (ISSUE_ACTION === 'edited' ? '（来自编辑操作）' : ''));

  if (DRY_RUN) {
    process.stdout.write(text);
    return;
  }

  fs.writeFileSync(DATA_PATH, text, 'utf8');
  log('已写入 ' + DATA_PATH);
  output({ changed: 'true', verb: verb, notice_id: finalId, notice_title: title });
}

try {
  run();
} catch (err) {
  const msg = err instanceof NoticeError ? err.message : (err && err.stack) || String(err);
  log('失败：' + msg);
  output({ changed: 'false', verb: '发布', notice_id: '', notice_title: '', error: msg });
  process.exit(1);
}
