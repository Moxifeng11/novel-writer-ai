# 自动推进 — 三项待拍板项收口（O-1 / O-3 / SEC-11）

> 日期：2026-11-10 · 基线：`e0e6427` · 轮次：台账第 25 轮
> 用户指令：解决此前挂起的三项——O-1 移动端 requestUrl 兜底、O-3 热重载承诺修法、SEC-11 `.bak` 明文副本文案。

## 一、本轮改动

| # | 原问题 | 修法 | 验收 |
|---|---|---|---|
| O-1 | 生成/向量化/本地探测共 7 处直连 `fetch`；移动端 WebView 无 CORS 豁免，第三方 API 预检失败 → 手机端整体不可用 | 新增 `shared/http-transport.ts` 作为唯一 HTTP 出口：移动端 `requestUrl`（`throw:false`），桌面端保留原生 `fetch`；流式调用在移动端缓冲整段 SSE 后合成一次性 reader，复用现有协议解析；`engine/ai-api-client.ts`、`ai-api-stream.ts`（2 处）、两个 embedding provider、`local-model-probe`、`local-model-utils` 全部改走该出口 | `tests/unit/shared/http-transport.test.ts` 7 条：桌面/移动分流、`throw:false` 与 header/body 透传、429 不抛错、桌面超时、移动端取消、桌面流式原样返回、移动端缓冲 SSE 可被现有循环读完 |
| O-3 | 设置页承诺「关闭再启用后工作台状态自动恢复」，但 `_pendingReloadState` 只存在旧实例内存；新实例读到 null，承诺从未兑现 | 新增 `shared/reload-state.ts`：同一窗口 `sessionStorage` 交接、10 分钟 TTL、读取即删除、结构/时间戳非法不恢复；`ui/settings-tab.ts` 写、`main.ts::onload` 消费；注释同步更正 | `tests/unit/shared/reload-state.test.ts` 6 条：一次性消费、可选字段、过期、未来时间戳、损坏 JSON/缺项目、存储不可用静默降级 |
| SEC-11 | `data.json.bak` 是逐字节副本；未启用会话口令时它就是明文 API Key 副本，但备份中心固定写「含密文」 | `shared/secret-redaction.ts` 新增 `detectSecretStorageMode` / `detectSecretStorageModeFromJson`（混合状态按明文报告）；`backup-center-service` 按实际形态生成 label/detail（明文时明示「⚠ 含明文 API Key，请勿分享或同步」）；`engine-registry` 写备份后留 warn 日志 | `tests/unit/shared/secret-storage-mode.test.ts` 6 条 + `backup-center-service.test.ts` 新增明文/密文文案断言 |

## 二、门禁变化

- `direct-fetch` 白名单从 5 组（`ai-api-stream` / `ai-api-client` / `embedding/` / `local-model-utils` / `local-model-probe`）收窄为 **1 个文件**（`shared/http-transport.ts`，传输层唯一出口）。业务代码再出现 `await fetch(` 会直接在 CI 失败。
- `requestUrl` 路径的已知边界：不支持 `AbortSignal` 与流式；取消语义是「拒绝等待」，移动端流式没有逐字动效——这是平台能力限制，已在模块头注释记录。

## 三、验证

- `npx vitest run`：新增 19 条 + 受影响 74 条全部通过（transport / reload-state / secret-mode / backup-center / providers / ai-api-client / streaming / embedding-fallback / local-model-probe）。
- `npx tsc --noEmit` = 0；`npm run lint` = 0 error；`check:jsdoc` 100%（@example 52/52）；`check:any` 74/74；`check:obsidian-api` 无新增违规；`gen:docs` + `check:docs` 通过。
- `preflight:release` 结果见提交信息与台账（bundle 基线若上涨按 `--update-baseline --note` 记录）。

## 四、遗留（不阻塞）

- 移动端流式为「缓冲后一次性解析」：正确性一致，但无打字机效果；若后续官方 `requestUrl` 支持流式再升级。
- `sessionStorage` 交接按窗口隔离：若设置页在 popout 窗口打开，插件 onload 在主窗口，状态不会跨窗口传递（极端路径，已在模块注释说明）。
