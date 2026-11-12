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
- **key（`7z`、`powertoys` …）必须和 `softlib.html` 里卡片的 `data-key` 对得上**，共 18 个
- 改了 JSON 但页面还显示「待上架」时，多半是浏览器缓存：页面对这份 JSON 用了 `no-cache`，强制刷新（Ctrl+F5）即可

## 本地预览

```
python -m http.server 8000
```
然后打开 http://localhost:8000
