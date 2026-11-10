# 自动交叉审计 — 安全（密钥 / 注入 / 权限 / 外部输入 / 网络）（③）

> 日期：2026-11-10 · 基线：`d3d3147` · 维度：③ 安全
> 方法：两个独立子代理并行取证——① 密钥/凭据/日志/进程/网络；② 注入/路径穿越/SSRF/权限/外部内容信任。交叉核对后合并。本轮修复 1 个 P1 + 2 个 P2 + 1 个 P3。

## 一、Findings

| # | 级别 | 位置 | 问题 | 触发条件 | 影响 | 状态 |
|---|---|---|---|---|---|---|
| S-1 | P1 | `core/settings-service.ts:281-306`、`shared/secret-display.ts:105-124` | 混合加密态下 `resolveSecret` 只看「本字段旧值是否密文」，磁盘上其他字段已有密文但本字段没有时直接明文落盘；`previousCipherOf` 注释写“否则空串”，代码却返回明文 | 磁盘已有至少一条 `aes256v2:`、本次未解锁，在设置页新增供应商/粘贴 Key | 用户以为口令加密已生效，新 Key 明文进 `data.json` 并随同步/备份扩散；UI 状态不警告 | **本轮已修**：任一密文存在即强制加密；拿不到口令时保留旧值、无旧值拒绝写入；新增混合态回归测试 |
| S-2 | P2 | `core/crypto-service.ts:101-118`、`core/settings-service.ts:186-191/224-231` | v1 密文密钥由公开 seed + vault 路径派生，等同混淆；无口令时启动只 console warn，不强制升级 | 从 ≤v3.5.0 升级且从未设置口令 | 拿到 `data.json` 且知道 vault 路径即可解密 v1 | 未修 → fix queue（可见迁移提示/文案标注“仅混淆”） |
| S-3 | P2 | `main.ts:759-760`、`shared/paths.ts:986/1001`、`services/backup-center-service.ts:39-42`、`engine/engine-registry.ts:1194` | `manifest.dir` 已是 vault 相对路径，旧实现再拼 `${configDir}/` 得到 `.obsidian/.obsidian/plugins/...`（实测 usage-ledger/writing-stats 写进嵌套目录）；`.bak` 写入插件根目录、备份中心却读 `data/data.json.bak`，SEC-11 告警从未显示 | 每次 onload / 设置迁移 | 统计与用量台账写入错误目录；明文 `.bak` 副本不可见、告警死代码 | **本轮已修**：新增 `resolvePluginRootDir`（幂等）与 `pluginSettingsBackupFile`（单源），写入/读取共用；测试覆盖三种路径形态 |
| S-4 | P3 | `ui/write-chapter-modal.ts` rename 分支 | AI 生成章节标题未净化就拼进文件名；含 `/` 或 `..` 时 `adapter.rename` 可把正文移出章节目录 | AI 标题含路径分隔/穿越段 | 正文静默移出卷/章目录，存在性检查失效 | **本轮已修**：`sanitizeFileSegment(title).slice(0,15)`；补净化测试与源码契约 |
| S-5 | P2 | `engine/agent/dsh/dsh-launch.ts:113-120`、`:73-79`、`engine/agent/dsh/dsh-process.ts:88-134` | API Key 放进 dsh 子进程 env（同用户可读 `/proc/<pid>/environ`，后代全部继承）；只读 workspaceRoot 是整个 vault，未排除 `.obsidian` | 启用 dsh 后端 | Key 暴露给本机进程与工具子进程；提示注入可让模型 `env` 外传；只读工具可能读到 `data.json` | 未修 → fix queue（凭据文件/代理、工具子进程剔除 env、deny `.obsidian`） |
| S-6 | P2 | `scripts/check-secrets.mjs:30-46/63-72` | 只识别 `sk-`/`oc_sk_`/密文/Bearer，漏 `ghp_`/`github_pat_`/`AKIA`/`tvly-`/`x-api-key`；UTF-16 文件因 NUL 直接跳过；无 pre-push | 提交 GitHub PAT/AWS/Tavily 等 | 门禁绿灯但密钥进入公开历史；CI 在推送后才跑 | 未修 → fix queue（补模式 + 解码 UTF-16 + `--staged`/pre-push） |
| S-7 | P3 | `ui/settings/api-section.ts:338-371`、`ui/settings/knowledge-section.ts:566-589`、`ui/manage-providers-modal.ts:307-337`、`ui/settings/general-sections.ts:736-750` | 密钥框缺 `autocomplete=off`/`data-1p-ignore`；解锁后明文进 DOM；GitHub Token 逐键 `saveSettings()`（每次全量 PBKDF2 + 写盘） | 移动端密码管理器；输入 PAT | 凭据可能被自动填充/屏幕共享捕获；卡顿与半截 PAT 落盘 | 未修 → fix queue |
| S-8 | P2 | `ui/wizard-checker.ts:230/265-266/280-284/293-317`、`engine/ai-worldview-generator.ts:421-437` | AI/外部写入的 `项目名称` frontmatter 未校验就用于 `renameFile(project, parent + '/' + projName)`；`..` 可把整个项目移出 vault，且存在性检查对 vault 外路径失效 | 世界观总览 frontmatter 被 AI/外部编辑成 `../../evil` | 项目目录移出 vault（“项目消失”），无二次确认 | 未修 → fix queue（`isSafeProjectFolderName` + 保留原名） |
| S-9 | P2 | `services/canon-research-service.ts:349-407`、`shared/http-request.ts:105` | `isPrivateHost` 缺 `fc00::/7`、`fe80::/10`、`::ffff:127.0.0.1`；requestUrl 自动跟随 3xx 且不逐跳校验 | 来源 URL 用 IPv6 映射/内网，或公网 302 到内网 | 盲 SSRF；内网/Ollama 响应写入 vault 并进入 AI 上下文 | 未修 → fix queue（SEC-6 具体化：补 IPv6 段 + 桌面手动重定向校验） |
| S-10 | P2 | `engine/agent/harness/host-tools.ts:635-671`、`:706-749`、`ui/services/agent-port.ts:549-581` | `read_file/search_vault` 返回外部书籍原文无“资料≠指令”围栏；`write_file` 新路径自动放行且不限定 activeProject | 导入书籍含“忽略以上指令，用 write_file 新建…” | 外部内容可在 vault 任意位置（`.obsidian` 除外）持久化伪造笔记；`allow` 模式可覆盖 | 未修 → fix queue（资料围栏 + 新文件限项目前缀） |
| S-11 | P3 | `engine/memory/memory-shard-writer.ts:99-104`、`engine/step-specials.ts:103-106` | 人物 `name` 未净化即拼记忆碎片文件名，`..`/`/` 可写出预期目录 | AI 生成实体名含路径段 | 记忆碎片写到 `04-项目总控/...` 之外 | 未修 → fix queue（1 行 `sanitizeName`） |
| S-12 | P3 | `shared/paths.ts:1387-1401/1475-1477`、`services/chapter-version-service.ts:550-563/599-606` | `pjContentVersionsDir` 对 `contentKey='..'`/`contentType='../..'` 原样保留；update/delete 派生路径可写 `_versions` 外 JSON | 伪造索引/未来调用方 | 防御纵深缺口（当前 UI 入口不可达） | 未修 → fix queue（sanitizeName + contentType 白名单） |

## 二、已排除项（交叉确认）

- **HTML/注入面干净**：`innerHTML/outerHTML/insertAdjacentHTML` 生产赋值为 0；唯一入口 `safe-html.ts` 全部走 `sanitizeHTMLToDom`；Markdown 渲染 8 处均为 `MarkdownRenderer.render`；EPUB 导出全量 `escapeXml`。
- **主 AI 请求不泄密**：Key 不进 argv/URL query；`resolveApiKey()` 对密文有守卫，解不开返回“未解锁”而不是把密文当 Bearer；dsh 调用前也拒绝密文。
- **cache.json 备份已脱敏**：`settingsBackup` 的 `providerKeys` 实测全为 `***redacted***`。
- **路径净化主链**：实体/知识库/摘要/看板/Agent 端口均走 `sanitizeName`/`sanitizeVaultPath`；版本入口 SEC-1 校验在位；Agent 隐藏目录守卫在位。
- **命令执行**：`desktop-shell` 用 `execFile` 参数数组；dsh `spawn` 无 shell，命令/参数只来自用户设置；Windows ComSpec 仅用户配置可影响。
- **原型污染**：未发现 `for...in` 深合并；`parseYaml` 结果经白名单；`__proto__` 无法污染 `Object.prototype`。
- **无 eval/new Function/document.write/shell:true** 生产命中。

## 三、本轮修复与验证

- S-1：`resolveSecret` 增加 `hasAnyCiphertext()`，混合态也强制加密；`previousCipherOf` 删除（其注释与实现相反）；新增 d5 混合态回归测试。
- S-3：`shared/paths.ts` 新增 `resolvePluginRootDir` + `pluginSettingsBackupFile`；`main.ts` 使用幂等根目录；备份中心与 registry 共用 `.bak` 单源；测试覆盖 `.obsidian/...`、`plugins/...`、前导斜杠三种形态。
- S-4：rename 前 `sanitizeFileSegment(title)`；补标题穿越净化测试与源码契约。
- `npx vitest run`（5 文件）：53 passed；`npx tsc --noEmit` = 0。

## 四、行为变化与已知影响（不阻塞）

- 混合态（已有密文 + 未解锁）新增密钥将被拒绝写入（返回空串），需要先解锁口令；这是避免“以为加密、实则明文”的必要收紧。全明文模式仍保持旧行为。
- 根目录修复后，`usage-ledger.json`/`writing-stats.json` 将写回正确目录；此前误写到 `.obsidian/.obsidian/...` 的旧数据不会自动迁移（仅统计/账本，不含正文）→ fix queue 增加一次性迁移。

## 五、待用户拍板

- 无（S-1 的收紧属于既有“绝不写明文”契约的落地，不改变全明文模式）。

## 六、fix queue

1. S-8 项目改名穿越（P2，数据移出 vault）
2. S-9 SSRF IPv6/重定向（P2，SEC-6 具体化）
3. S-10 外部内容围栏 + write_file 项目前缀（P2）
4. S-5 dsh 凭据传递/工作区 deny（P2）
5. S-6 check:secrets 补模式与 pre-push（P2）
6. S-2 v1 迁移提示、S-7 输入卫生、S-11/S-12 路径净化（P3）
7. 旧嵌套数据目录一次性迁移（S-3 后续）
