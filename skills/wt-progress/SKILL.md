---
name: wt-progress
description: 查当前工作进度（TraceDeck）：等谁/卡在哪/可开工什么 + 最近几天日报。开工前先跑这个，别问用户。
disable-model-invocation: false
---

# /wt-progress — 进度速览

用户想知道当前工作进度，或本会话要续接工作。

**执行（按优先级）**：

1. 若本会话已连接 MCP 工具 `mcp__tracedeck__trace_overview`：调用它（profile 用 ziniao-cd），再调 `mcp__tracedeck__trace_recent`（days=3）。把结果整理成三段话汇报：等外部 / 等用户 / 可开工，外加阻塞 ISSUE。
2. 若 MCP 未连接，用 Bash 跑（零依赖、只读，秒出）：
   ```
   node D:/TraceDeck/wt.js doctor
   node D:/TraceDeck/wt.js issues --status 阻塞
   ```
   再读 `D:/ziniao-cd/reports/` 最新日期档的 `总日记.md` 汇报三段式（今日完成/问题与阻塞/明日下一步）。

**汇报格式**：开头一句总览，然后「等平台/外部」「等用户」「可直接开工」三栏逐条列出，最后列阻塞 ISSUE。不要展开长篇细节，用户要的是一屏看清。

用户附加参数：$ARGUMENTS（若指定了别的 profile 或天数，传给对应工具/命令）。
