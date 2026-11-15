# 桌宠（写作宠物）

> 状态：stable　｜　最后更新：2026-11-16　｜　Owner：dsh

## 1. 定位

- 用户视角：桌面上的写作宠物，随写作/思考/完成等状态切换形象，可拖拽吸附、查看字数、关闭。
- 代码入口：`ui/writing-pet.ts`、`shared/pet-image-model.ts`、`shared/pet-image-store.ts`、`shared/pet-activity.ts`
- 数据字段：`petEnabled`、`petImage`（元数据）、插件目录 `pet-image.png` + `pet-image.json`（图片本体）

## 2. 现状

- 默认用代码绘制的分层 SVG；用户可指定自己的图片，按网格切帧。
- 本机图片落插件目录独立文件，`data.json` 只存 `{source, cols, rows}`；启动时 `hydratePetImage()` 回读。
- 状态由 `shared/pet-activity.ts` 事件总线驱动（writing/thinking/happy/error + TTL + 优先级），不自动循环帧。
- 支持拖拽、屏幕边吸附、点击查看字数/双击统计、关闭按钮。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| PET-01 | P0 | 重载插件后自定义图片丢失，要重设 | 图片独立文件 + 启动自愈 | done |
| PET-02 | P1 | `data.json` 里存几百 KB base64 | settings 只存元数据 | done |
| PET-03 | P2 | 元数据存在但图片文件丢了会「假显示有图」 | 自动清元数据回内置形象 | done |

## 4. 关键决策

- 2026-11-16：图片本体落插件目录（`pet-image.png`），`data.json` 只留元数据。
- 2026-11-16：settings 完全丢失时，只要插件目录还有图就自动恢复（覆盖「设置被重置」场景）。
- 2026-11-16：运行时图片文件加入 `.gitignore`，不入版本库。

## 5. 验收记录

| 日期 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 2026-11-16 | 单测：`pet-image-store` 6 组 + `pet-image-runtime` 5 条 | 全过 | vitest |
| 2026-11-16 | 实机：应用本机图 → data.json 无 dataUrl、插件目录有 png/json、渲染正常 | 正常 | obsidian eval |
| 2026-11-16 | 实机：连续两次 reload 图片仍在；清空 settings.petImage 后 reload 自愈 | 正常 | obsidian eval |
| 2026-11-16 | 实机：clearPetImage 后 settings/data.json/文件全部清空 | 正常 | obsidian eval |
| 2026-11-16 | 门禁：`npm run preflight` EXIT=0 | 通过 | preflight |

## 6. 测试清单

- 纯逻辑：`tests/unit/shared/pet-image-store.test.ts`、`tests/unit/shared/pet-activity.test.ts`
- UI/DOM：`tests/unit/ui/pet-image-runtime.test.ts`、`tests/unit/ui/writing-pet-activity.test.ts`
- 实机检查：默认形象、自定义图片、重载、清空后恢复、拖拽吸附

## 7. 剩余 backlog

- [ ] 多套形象/主题切换（P3）

## 8. 交接备注

- 重载验证必须真机做一次：`obsidian plugin:reload` 后检查 `.nw-pet-pose` 的 backgroundImage 与插件目录文件。
