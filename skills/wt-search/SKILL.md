---
name: wt-search
description: 全文检索工作留痕（日报/ISSUES/CHANGELOG/台账/工单邮件稿），秒回哪里写过什么
disable-model-invocation: false
---

# /wt-search — 检索留痕

用户想找"哪份留痕写过某事"。执行：

```
node D:/TraceDeck/wt.js search "关键词"
```

要点：
- 覆盖 ziniao-cd 的日期档全文、ISSUES、CHANGELOG、双台账、reports/ 根部一手记录（工单稿/邮件稿/探针证据）；
- 输出是文件+行号+原文行，把命中整理成列表回用户，附文件路径；
- 关键词为空时用用户消息里最关键的业务词（如工单号 102629、submitV2、ISSUE-023）；
- 也可以用看板顶栏搜索（http://127.0.0.1:7788）。

用户参数（关键词）：$ARGUMENTS
