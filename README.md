# harvey-music.github.io
Arthur Studio 亚瑟工作室

纯静态站点，托管在 GitHub Pages 上。

## 发布公告

公告数据只有一个来源：`data/notices.json`。首页顶部公告条、首页「公告」三条、公告页全部条目、各处「N 条」计数，全部由 `notices.js` 从这份 JSON 渲染，**不需要改 HTML**。

### 方式一：Issue 表单（推荐）

手机、电脑都能用，不用碰代码：

1. 打开 `Issues` → `New issue` → 选 **发布公告**
2. 填标题、日期（留空自动用今天，北京时间）、标签、正文（空一行分段）
3. 提交后机器人自动写入 JSON、回评论、关闭该 issue
4. 约 1 分钟后网站生效

- 改已发布的公告：**直接编辑那个 issue 再保存**，会按原条目覆盖，不会重复添加
- 只有仓库所有者（或 workflow 里 `ALLOWED_AUTHORS` 列出的账号）能发布，其他人提交会被拒绝且不改任何文件
- 实现：`.github/ISSUE_TEMPLATE/notice.yml`（表单）+ `.github/workflows/publish-notice.yml`（触发）+ `.github/scripts/publish-notice.mjs`（解析写入）

### 方式二：直接改 JSON

编辑 `data/notices.json`，在 `items` 数组里加一条（`_example` 是现成模板），提交后约 30 秒生效。字段说明见文件里的 `_hint`。

注意：
- `date` 必须 `YYYY-MM-DD` 且月日补零，写 `2026-11-8` 会排序错乱
- `id` 全文件唯一，会成为锚点 `notice.html#id`，定下后别改
- 本地双击 HTML 预览会提示「公告加载失败」，这是 `file://` 的 CORS 限制，起个静态服务即可

## 软件库下载直链

软件库（`softlib.html`）每张卡片下方有两个按钮：

| 按钮 | 来源 | 点击行为 |
| --- | --- | --- |
| 官方网站 | 卡片里的 `href` | 新窗口打开项目官网 / 仓库 |
| 下载安装包 | `data/downloads.json` | `url` 有值 → 直接下载；留空 → 虚线「待上架」，点了只弹一句「正在加急投放」 |

**要上线某个安装包，只改 `data/downloads.json`，`softlib.html` 一个字都不用动：**

```json
"7z": {
  "name": "7-Zip",
  "ver": "26.06",
  "file": "7z2606-x64.exe",
  "size": "1.6 MB",
  "url": "https://你的存储桶地址/7z2606-x64.exe"
}
```

- `url` 一填上，按钮就自动从虚线变金色实心，点击直接开始下载
- `ver` / `size` 会拼进鼠标悬停提示，例如「下载 7-Zip 安装包（v26.06 · 1.6 MB）」
- `name` 只是给维护者看的，可以不填
- **key（`7z`、`powertoys` …）必须和 `softlib.html` 里卡片的 `data-key` 对得上**，共 24 个
- 改了 JSON 但页面还显示「待上架」时，多半是浏览器缓存：页面对这份 JSON 用了 `no-cache`，强制刷新（Ctrl+F5）即可

## 本地预览

```
python -m http.server 8000
```
然后打开 http://localhost:8000

## 留言板与账号（Supabase）

第一期动态功能：邮箱 + 密码登录、个人主页、需要站长审核的公开留言板。
零构建、零服务器成本；公开与否由数据库的行级权限（RLS）决定，不靠前端隐藏。

留言规则：新用户（`trust_level = 0`）发的留言进入待审，只有作者本人和站长看得见，
站长放行后才对所有人公开；站长本人和信任用户（`trust_level >= 1`）发的留言**直接公开**。
命中 `banned_words` 里 `flag` 级敏感词时，哪怕站长也会被降回待审。

| 文件 | 作用 |
| --- | --- |
| `db/01_schema.sql` | 表结构、索引、触发器、站长 RPC |
| `db/02_policies.sql` | REVOKE / 列级 GRANT / RLS 策略 |
| `db/03_grant_admin.sql` | 把某个邮箱设为站长 |
| `db/05_fix_ip_leak.sql` | 把 `messages` 的 select 收窄成列级 + 站长专用 IP 列表 RPC（堵 `author_ip` 泄露） |
| `db/99_verify.sql` | 只读验收自查 |
| `vendor/supabase.js` | supabase-js 本地副本（不走 CDN，国内加载稳定） |
| `supabase-client.js` | 连接、登录态、格式化等公共小工具 |
| `guestbook.js` | 首页留言板 + 可复用的留言条渲染器 |
| `account.html` / `account.js` | 登录、注册、个人主页 |
| `admin.html` / `admin.js` | 站长审核后台 |
| `privacy.html` | 隐私说明 |
| `guestbook.css` / `subpage.css` | 新增样式（首页只多引一个 guestbook.css） |

部署顺序、控制台必改项与越权测试清单见 [`db/README.md`](db/README.md)。

