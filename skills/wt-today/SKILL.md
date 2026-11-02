---
name: wt-today
description: 为 ziniao-cd 建今日日报档（reports/日期/里程碑+总日记，AGENTS §7 模板，已存在则拒绝不覆盖）
disable-model-invocation: false
---

# /wt-today — 建今日日报档

用户要写今天的日报（或"建今天的档"）。执行：

```
node D:/TraceDeck/wt.js today --profile ziniao-cd
```

要点：
- 会在 `D:/ziniao-cd/reports/YYYY-MM-DD/` 建 `里程碑.md` + `总日记.md` 两文档（按 AGENTS §7 模板）；
- **已存在则命令自己会拒绝**——此时告诉用户档案已建，改用直接编辑文件，绝不强推覆盖；
- 建完把两个文件路径给用户，提示直接往里填；若用户要求代填初稿，从当天会话内容起草
  （总日记三段式：今日完成 / 问题与阻塞（引用 ISSUE 编号）/ 明日下一步（注明等谁））；
- 其他 profile（如 omnilister）用 `--profile` 指定；指定日期用 `--date YYYY-MM-DD`。

用户参数：$ARGUMENTS（可为空=今天+ziniao-cd；或含 profile / 日期）。
