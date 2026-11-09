# 自动迭代成果台账

> 由每半小时自动化任务维护，每次运行追加一行。  
> 记录命令：`node scripts/record-iteration.mjs --type <code|audit|gate|docs> --deliverable "..." --files "..." --commit <sha> --tests "..." --gates "..." --next "..."`  
> 原则：**纯阅读/纯分析不算成果**；每轮至少产出一个可验收的文件、测试、门禁或提交。

| 轮次 | 时间 | 类型 | 本轮成果 | 关键文件 | 提交 | 测试/门禁 | 下一轮 |
|---:|---|---|---|---|---|---|---|
