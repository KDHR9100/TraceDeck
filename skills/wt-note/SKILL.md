---
name: wt-note
description: 随手记一条便签进 TraceDeck 收件箱（写日报时消化），不碰业务仓
disable-model-invocation: false
---

# /wt-note — 记便签

用户随手记一条。执行：

```
node D:/TraceDeck/wt.js note "用户给的内容"
```

要点：
- 便签落到 `D:/TraceDeck/data/inbox.md`（TraceDeck 自己的收件箱，**不写任何业务仓**）；
- 看板概览页会显示待消化条数；写日报时应把便签内容消化进总日记后删除对应行；
- 内容为空时让用户补一句要记什么，别自己编。

用户参数（便签正文）：$ARGUMENTS
