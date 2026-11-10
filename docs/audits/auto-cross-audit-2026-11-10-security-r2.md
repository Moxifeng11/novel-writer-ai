# 自动交叉审计 — 安全（密钥 / 注入 / 权限 / 外部输入 / 网络）（③，二轮复审）

> 日期：2026-11-10 · 基线：`6e7ab34` · 维度：③ 安全（二轮）
> 方法：两个独立子代理复审——① 密钥/凭据；② 注入/路径/SSRF/权限。交叉核对后合并。本轮修复 2 个 P2（SSRF IPv6 段、记忆碎片路径净化）。

## 一、Findings

| # | 级别 | 位置 | 问题 | 影响 | 状态 |
|---|---|---|---|---|---|
| S2-1 | P2 | `shared/secret-display.ts:105-124`、`core/settings-service.ts:186-191`、`shared/secret-redaction.ts:128-133` | v1 密文（公开 seed 派生）仍被文案称作“加密”；备份中心把 `aes256:` 计入 encrypted；无可见迁移提示 | 用户误以为 data.json/.bak 安全，实际知道库路径即可解密 | 未修 → fix queue（增加 obfuscated 模式与提示） |
| S2-2 | P2 | `engine/agent/dsh/dsh-launch.ts:119`、`dsh-process.ts:91-134` | dsh 的 API Key 仍放子进程 env，工具后代继承；只读 workspace 仍是 vault 根，未 deny `.obsidian` | Key 可被 `env`/`/proc` 读取；提示注入可外传；可读 data.json | 未修 → fix queue（凭据文件/代理、env 剔除、deny 列表） |
| S2-3 | P2 | `scripts/check-secrets.mjs:30-36/69-72` | 仍漏 GitHub PAT/AWS/Tavily/`x-api-key` 与 UTF-16；无 pre-push | 密钥可进入公开历史，CI 在 push 后才发现 | 未修 → fix queue（补模式 + 解码 + hooks:install） |
| S2-4 | P2 | `core/settings-service.ts:280-298`、`ui/settings/api-section.ts:350-361` | S-1 收紧后加密失败写空串：新 Key 被丢弃/旧 Key 未轮换，UI 仍弹“密钥已保存”；设置写盘非原子、不轮转 .bak | 用户以为泄露的旧 Key 已替换，实际仍有效 | 未修 → fix queue（SaveOutcome + UI 提示 + 备份轮转） |
| S2-5 | P3 | `ui/settings/api-section.ts:344-349`、`general-sections.ts:735-751` 等 6 处 | 密钥框无 `autocomplete/1p-ignore`；解锁后明文进 DOM；GitHub Token 逐键保存 | 自动填充/屏幕共享泄露；PBKDF2 写放大 | 未修 → fix queue |
| S2-6 | P3 | `ui/settings/general-sections.ts:738-751`、`services/update-checker.ts:352-353`、`main.ts:1512-1541` | 密文被当值：Token 输入框显示密文；UpdateChecker 可能把密文当 Bearer；重置口令漏 `canonResearch.apiKey` | 私有仓库检查静默 401；考据 Key 永久解不开 | 未修 → fix queue（字段单源表驱动） |
| S2-7 | P2 | `services/canon-research-service.ts:394-407` | `isPrivateHost` 只处理 `::1` 与点分 IPv4：`::ffff:127.0.0.1`、`fc00::/7`、`fe80::/10`、`localhost.` 均可绕过；3xx 仍自动跟随 | 盲 SSRF，内网/Ollama 响应写入 vault 并进入模型上下文 | **部分已修**：新增 IPv4-mapped/唯一本地/链路本地/尾点识别；重定向逐跳校验仍受 requestUrl 限制（fix queue） |
| S2-8 | P2 | `engine/agent/harness/host-tools.ts:634-727`、`ui/services/agent-port.ts:549-581` | 外部书籍原文无“资料≠指令”围栏；`write_file` 新文件自动放行且不限 activeProject | 提示注入可在 vault 任意非隐藏位置持久化伪造笔记 | 未修 → fix queue（围栏 + 新文件项目前缀） |
| S2-9 | P3 | `engine/memory/memory-shard-writer.ts:99-105` | 角色名未净化就拼记忆碎片文件名 | `../` 可写出记忆碎片目录 | **本轮已修**：`sanitizeName(name)` + 回归测试 |
| S2-10 | P3 | `shared/paths.ts:1439-1454`、`services/chapter-version-service.ts:557-606` | `pjContentVersionsDir` 对 `contentKey='..'` 原样保留；contentType 无运行时白名单 | 当前 UI 不可达，防御纵深缺口 | 未修 → fix queue |
| S2-11 | P3 | `shared/paths.ts:976-1005`、`shared/plugin-data-migration.ts:34-93` | 插件根目录/迁移路径不拒绝 `..`/绝对路径；`adapter.rename` 可把 data 移出插件目录 | manifest.dir 被污染时单点越界（正常安装不可控） | 未修 → fix queue（assertPluginRelativePath） |
| S2-12 | P3 | `core/settings-service.ts:373-386`、`shared/plugin-cache.ts:178-225` | `deepMergeSettings` 的 `__proto__` 键会替换结果对象原型；cache 动态键未用 hasOwnProperty | 可继承注入未声明设置项（不污染全局原型） | 未修 → fix queue（跳过危险键） |

## 二、已排除项（交叉确认）

- S-1（混合态明文）、S-3（路径单源/.bak）、S-4（标题净化）、S-8（项目改名）、D2-1（目录 sourcePath）修复未回退。
- 危险工具 fail-closed 仍成立；工作台审批超时默认拒绝。
- worker URL 已去除 `configDir + PLUGIN_ID` 硬拼；cache 路径惰性且在插件 data 内；backupSettings 源/目标同源，无法只伪造目标。
- `plugin-data-migration` 目标文件名取单段 `basename`，正常 adapter 下写不出 `current/data`；迁移只读旧 data，不碰正文。
- 未发现全局 `Object.prototype` 污染、eval/new Function/shell:true 新增命中；HTML 注入面与上轮一致。
- 版本 `TFolder` 拒绝仍在；`sanitizeVaultPath` 对绝对路径/`..`/隐藏目录拒绝仍在。

## 三、本轮修复与验证

- `services/canon-research-service.ts`：拆分 `isPrivateIpv4`/`isPrivateIpv6`；支持 IPv4-mapped（点分/十六进制）、`fc00::/7`、`fe80::/10`、`::` 与尾点 localhost；导出 `isPrivateHost` 供表驱动测试。
- `engine/memory/memory-shard-writer.ts`：记忆碎片文件名过 `sanitizeName`。
- 新增 5 条 SSRF 表驱动测试 + 1 条记忆碎片路径测试。
- `npx vitest run`（2 文件）：10 passed；`npx tsc --noEmit` = 0。

## 四、待用户拍板

- S2-7 的重定向部分：`requestUrl` 无 redirect 策略、无最终 URL。是接受“桌面专用手动重定向客户端 + 移动端已知残余”，还是暂不处理重定向（仅保留 IPv6/私网拦截）？本轮只做地址段拦截。

## 五、fix queue

1. S2-8 外部资料围栏 + write_file 项目前缀（P2）
2. S2-4 保存结果可观测 + 设置备份轮转（P2）
3. S2-7 重定向逐跳校验（P2，待拍板方案）
4. S2-1 v1 混淆文案、S2-2 dsh 凭据、S2-3 check:secrets 补模式（P2）
5. S2-10/S2-11 路径断言、S2-12 原型键、S2-5/S2-6 输入卫生（P3）
