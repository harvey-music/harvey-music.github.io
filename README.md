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

## 本地预览

```
python -m http.server 8000
```
然后打开 http://localhost:8000
