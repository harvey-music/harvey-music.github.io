import functools
import http.server
import os
import re
import socketserver
import threading
import urllib.request
from html.parser import HTMLParser

ROOT = r"E:\Arthur\harvey-music.github.io-main"
PORT = 8128
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr"}
PAGES = ["index.html", "start.html", "silverdaw.html", "home.html", "notice.html"]


class Balance(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.errors = [], []

    def handle_starttag(self, tag, attrs):
        if tag not in VOID:
            self.stack.append((tag, self.getpos()))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack:
            self.errors.append("多余 </%s>行%d" % (tag, self.getpos()[0]))
            return
        o, pos = self.stack.pop()
        if o != tag:
            self.errors.append("不匹配 <%s>行%d vs </%s>行%d" % (o, pos[0], tag, self.getpos()[0]))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass


srcs = {n: open(os.path.join(ROOT, n), encoding="utf-8").read() for n in PAGES}

print("=== 1. 标签闭合 ===")
for n in PAGES:
    p = Balance()
    p.feed(srcs[n])
    p.close()
    probs = p.errors + ["未闭合 <%s>行%d" % (t, pos[0]) for t, pos in p.stack]
    print("%-15s 行数=%-4d %s" % (n, srcs[n].count("\n") + 1, "OK" if not probs else probs))

print()
print("=== 2. HTML 用到的 class 是否都有样式定义 ===")
for n in PAGES:
    src = srcs[n]
    style = "\n".join(re.findall(r"<style>(.*?)</style>", src, re.S))
    html = re.sub(r"<style>.*?</style>", "", src, flags=re.S)
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    used = set()
    for val in re.findall(r'class="([^"]+)"', html):
        used.update(val.split())
    missing = sorted(c for c in used if ("." + c) not in style)
    print("%-15s 用到 %-2d 个 class -> %s" % (n, len(used), "全部有定义 OK" if not missing else "缺样式: %s" % missing))

print()
print("=== 3. 清理检查 ===")
print("home.html 还有「正在进行的项目」:", "正在进行的项目" in srcs["home.html"])
print("home.html 还有 card-grid/.tag/.lead:", any(k in srcs["home.html"] for k in ("card-grid", 'class="tag"', 'class="lead"', ".card p")))
for n in ("start.html", "silverdaw.html"):
    print("%-14s 残留 back-wrap: %s | 顶栏 topbar: %s | back-link: %s | brand: %s"
          % (n, "back-wrap" in srcs[n], 'class="topbar"' in srcs[n],
             'class="back-link"' in srcs[n], 'class="brand"' in srcs[n]))

print()
print("=== 4. 顶栏内容 ===")
for n in ("home.html", "start.html", "silverdaw.html", "notice.html"):
    bar = re.search(r'<div class="topbar">(.*?)</div>', srcs[n], re.S).group(1)
    links = re.findall(r'href="([^"]+)"[^>]*>([^<]+)<', bar)
    print("%-14s %s" % (n, " | ".join("%s -> %s" % (t.strip(), h) for h, t in links)))

print()
print("=== 5. 站内链接可达性 ===")
bad = 0
for n in PAGES:
    body = re.sub(r"<!--.*?-->", "", srcs[n], flags=re.S)
    for href in sorted(set(re.findall(r'href="([^"#:]+\.html)"', body))):
        ok = os.path.isfile(os.path.join(ROOT, href))
        if not ok:
            bad += 1
        print("%-15s -> %-16s %s" % (n, href, "存在" if ok else "★缺失★"))
print("死链数量:", bad)

print()
print("=== 6. HTTP 实测 ===")
handler = functools.partial(Quiet, directory=ROOT)
httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
for path in ["/", "/start.html", "/silverdaw.html", "/home.html", "/notice.html", "/logo.png"]:
    r = urllib.request.urlopen("http://127.0.0.1:%d%s" % (PORT, path), timeout=5)
    print("%-17s -> HTTP %s, %d bytes" % (path, r.status, len(r.read())))
httpd.shutdown()
