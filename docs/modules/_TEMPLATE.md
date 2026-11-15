# 模块页模板（复制后改名为 `<module>.md` 并登记到 INDEX.md）

> 状态：todo / doing / review / stable　｜　最后更新：YYYY-MM-DD　｜　Owner：dsh / zcode / trae

## 1. 定位

- 用户视角：这个模块解决什么问题
- 代码入口：`ui/...`、`core/...`、`shared/...`、`engine/...`
- 相关数据字段（settings / 文件 / 缓存）

## 2. 现状（事实，不写愿望）

- 现在怎么工作（一段流程）
- 数据存在哪、重载/切换后表现
- 已知语义错误或历史包袱

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| M-01 | P1 |  |  | open / doing / done / dropped |

## 4. 关键决策

- 日期：决策 + 理由（没采纳的方案也记一句）

## 5. 验收记录

| 日期 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
|  |  |  | 单测 / DOM / 实机 / preflight |

## 6. 测试清单

- 纯逻辑：`tests/unit/shared/<x>.test.ts`
- UI/DOM：`tests/unit/ui/<x>.test.ts`
- 回归：受影响的既有测试
- 实机：reload 后要检查的状态（默认/空/错误/切换/重载）

## 7. 剩余 backlog（P2/P3）

- [ ] 

## 8. 交接备注

- 下一轮建议从哪开始；已知坑
