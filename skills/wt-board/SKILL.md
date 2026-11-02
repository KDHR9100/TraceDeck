---
name: wt-board
description: 启动 TraceDeck 本地看板（工作痕迹浏览器），自动打开 http://127.0.0.1:7788
disable-model-invocation: false
---

# /wt-board — 启动看板

在后台启动 TraceDeck 看板服务并让用户浏览器打开：

```
node D:/TraceDeck/wt.js board
```

要点：
- 用 run_in_background 方式跑（服务是常驻进程，不自行退出）；
- 起来后告诉用户地址 `http://127.0.0.1:7788`（默认自动开浏览器；没开就让用户手动访问）；
- 服务只绑 127.0.0.1，只读用户留痕文件，关掉窗口/杀进程即停，无副作用；
- 端口被占时改用 `--port 7789`。

用户参数：$ARGUMENTS（可指定 --profile 或 --port）。
