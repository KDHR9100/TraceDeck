---
name: wt-weekly
description: 归并当周总日记生成周报草稿（四段式文本），人工提炼后才落档
disable-model-invocation: false
---

# /wt-weekly — 周报草稿

用户要写周报。执行（默认归并最近 7 天；周一日期可由用户给）：

```
node D:/TraceDeck/wt.js weekly --profile ziniao-cd
```

要点：
- 输出是**草稿文本**（周报四段式：本周汇总/关键进展与结论/风险与阻塞/下周计划），
  其中"本周汇总"是占位提示——帮用户从当周总日记提炼 3-6 条对外可读的汇总；
- 草稿默认打到屏幕，不落盘；用户确认后写到
  `D:/ziniao-cd/reports/weekly-YYYY-Www.md`（ISO 周号，参考 reports/README.md 模板）；
- 起止日期可用 `--from YYYY-MM-DD`（周一）指定。

用户参数：$ARGUMENTS（可为空，或含 --from 日期 / --profile）。
