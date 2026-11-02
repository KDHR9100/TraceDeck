# TraceDeck 痕迹台 — 工作痕迹看板与留痕助手

一句话：**把你现有的留痕体系（reports/ 日期档、CHANGELOG、ISSUES、双台账、ZCode 会话库）变成一个本地看板 + 一组留痕命令**，让"昨晚干到哪、现在等谁、明早干什么"一屏看清。

- **零依赖**：纯 Node（≥22，本机 v24）标准库，无 npm install、无第三方 SDK、无网络请求。
- **只读数据面**：看板对 ziniao-cd / OmniLister 全程只读；唯一的写动作是你主动执行的
  `wt today`（在 reports/ 建当日档）与 `wt note`（写 TraceDeck 自己的 data/inbox.md）。
- **本地边界**：服务只绑 `127.0.0.1`；文件查看接口有白名单（reports 目录 + 显式登记文件），
  **实测拒绝读取 config.json 等凭证文件**；不上传任何数据。

## 30 秒验收（明早看这里）

1. 双击 `wt-board.bat`（或命令行 `node wt.js board`）→ 浏览器自动开 `http://127.0.0.1:7788`；
2. 看**概览**页：今日档有无 / 等平台·等用户·可开工三栏 / 阻塞 ISSUE / 台账近 7 天动态 / 今日会话；
3. 看**时间线**（11 天日期档全文）、**ISSUES 看板**（四状态列）、**往来台账**、**会话痕迹**（78 条历史会话标题）；
4. 顶部搜索框输一个工单号或关键词回车 → 应命中总日记、往来稿、台账；
5. 不想起服务：双击打开 `dist/index.html`（离线快照，内嵌三档案数据）。

> ⚠ 离线快照内嵌了你工作记录的摘录（含会话首条输入预览），**只在本机看，别把 dist/index.html 发给外部**。

## 命令（`node wt.js <cmd>`，或 `wt-cli.bat <cmd>`）

| 命令 | 作用 |
|---|---|
| `board [--profile 档案] [--port 7788] [--no-open]` | 启动本地看板 |
| `export [--out dist/index.html]` | 生成自包含静态快照（离线双击即看） |
| `today --profile 档案 [--date YYYY-MM-DD]` | 建当日日期档（里程碑+总日记，按 AGENTS §7.2 模板；已存在则拒绝，绝不覆盖） |
| `weekly --profile 档案 [--from 周一] [--out 文件]` | 归并当周总日记 → 周报草稿（默认打 stdout，自己审完再落档） |
| `issues [--status 阻塞]` | ISSUE 速览（含状态过滤） |
| `ledger` | 双台账速览 |
| `search <关键词>` | 全文检索（日期档全文/ISSUES/CHANGELOG/台账/一手记录） |
| `sessions [--limit 30]` | 最近 ZCode 会话（只读元数据：标题/目录/时长/首条输入预览） |
| `note "随手记"` | 便签进 `data/inbox.md`（写日报时消化，看板概览可见条数） |
| `doctor` | 体检：各数据源可读性 + 解析计数 |

## 认识它怎么读你的数据（约定式解析）

对齐 `AGENTS.md §7` 与 `reports/README.md` 的既有格式，容错优先（不符合约定就整段跳过，不让看板崩）：

- **日期档**：`reports/YYYY-MM-DD/里程碑.md` + `总日记.md`（三段式 + 任意"补记"小节）；
- **ISSUES.md**：`### ISSUE-NNN · 标题`，`- 日期：… ｜ 状态：阻塞（备注）` 可同一行，字段 现象/原因/处理/教训…；
- **台账**：`## 工单线程 XXX` + markdown 表 + `**线程状态**：…`；
- **CHANGELOG**：`## [日期] 主题` + Added/Changed/Fixed/Security/Removed 分节；
- **会话库**：`~/.zcode/cli/db/db.sqlite`（node:sqlite 只读打开，只取元数据，不读对话正文）。

"等谁"识别（概览三栏）：`等用户/等老板/等苏总` → 等用户；`等平台/等回复/等Engineering/等合同…` → 等平台/外部；`可直接开工` → 可开工。

## 新档案（profile）接入

**首次使用**：复制 `config.example.json` 为 `config.json`（本地配置，**不入库**，已在
.gitignore），按实际路径修改——`sessions.db` 指向 ZCode 会话库，`profiles` 每项指到
root/reports/changelog/issues/ledgers。之后想加档案照抄一个 key 改路径即可，看板下拉框
自动出现。OmniLister、ziniao-cd、demo 夹具已在本地配置中预接。

## ZCode `/` 命令（技能）

常用操作已封装为 ZCode 技能（正本在 `skills/`，部署到 `~/.zcode/skills/`，新会话生效）：

| 命令 | 干什么 |
|---|---|
| `/wt-progress` | 进度速览：等谁/卡在哪/可开工（MCP 优先，CLI 兜底）——**新会话开工前先敲这个** |
| `/wt-today` | 建今日日报档（已存在则拒绝） |
| `/wt-weekly` | 周报草稿（归并当周总日记） |
| `/wt-note 内容` | 记便签 |
| `/wt-search 关键词` | 全文检索留痕 |
| `/wt-board` | 启动本地看板 |

## MCP 接入（ZCode 会话直接问进度）

TraceDeck 自带零依赖 MCP 服务器（`src/mcp.js`，JSON-RPC 2.0 over stdio），已注册进
ZCode 用户配置（`~/.zcode/cli/config.json` → `mcp.servers.tracedeck`）。**新开的会话**
可直接调用工具（工具名 `mcp__tracedeck__*`）：

| 工具 | 用途 | 写? |
|---|---|---|
| `trace_overview` | 进度概览：等平台/等用户/可开工三栏、阻塞 ISSUE、台账动态 | 只读 |
| `trace_recent` | 最近 N 天总日记+里程碑（days 默认 3，最大 14） | 只读 |
| `trace_issues` / `trace_search` | ISSUE 速览 / 全文检索 | 只读 |
| `trace_weekly_draft` / `trace_doctor` | 周报草稿文本 / 数据源体检 | 只读 |
| `trace_note` | 记便签进收件箱 | 写 TraceDeck 自身 |
| `trace_today_create` | 建当日日报档（仅用户要求时；存在即拒绝） | 写业务仓 reports/ |

这样任何新会话**开工前调用一次 `trace_overview`（+`trace_recent`）就能接上进度**，
不用你手动粘贴日报。已开的会话要重启才能连上；排错看 ZCode 的 Settings → MCP。

手动改配置：schema 严格（无未知键）、模板变量不展开、command 用绝对路径
（`C:\Program Files\nodejs\node.exe`）。备份在 `~/.zcode/cli/config.json.bak-tracedeck`。

## 项目结构

```
wt.js               CLI 入口        src/parse.js   五种留痕格式的解析器
src/scan.js         扫描+概览聚合   src/server.js  零依赖看板服务（127.0.0.1）
src/sessions.js     会话库只读      src/export.js  静态快照导出
src/gen.js          today/weekly/note 生成器    src/ui/  前端（vanilla JS）
src/mcp.js          MCP 服务器      templates/     日报模板
skills/             ZCode 斜杠技能（部署到 ~/.zcode/skills/）
fixtures/           合成演示数据（写测试只打这里）   tests/  自动化测试
```

> 交付文档（使用报告/验收清单/SPEC/ADR 决策记录/CHANGELOG）只留本机 `local/`，
> 不入库不上云——云端仓库只保留让工具能跑起来的代码与这一份 README。

## 边界与红线（重要）

- 看板/CLI 对业务仓**只读**；`wt today` 是唯一会写业务仓的命令，且你手动执行、存在即拒绝。
- 文件查看白名单**不含仓库根**（根下有 config.json）；有测试钉死：`config.json`、`AGENTS.md` 一律 403。
- 会话库只读元数据（标题/目录/时间/首条输入前 120 字），不解析对话正文。
- 本项目自身不推 GitHub（决策见 docs/ADR-0002）；要推时自行评估。

## 已知限制

- OmniLister 无日期档（旧版 daily-*.md 散件归入"一手记录"，时间线为空属正常）。
- "等谁"识别靠关键词，个别句子可能落错栏（宁多勿漏，概览页可人工校准）。
- 会话时长按 created/updated 差粗算，跨天挂机会话会偏大。
- 静态快照是生成时点的切片，不自动刷新（要新快照重跑 `node wt.js export`）。
