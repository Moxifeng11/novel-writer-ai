# 自动交叉审计 — 安全（③，三轮复审）

> 日期：2026-11-11 · 基线：`810cd84` · 维度：③ 安全（密钥/注入/权限/外部输入）
> 方法：两个独立子代理取证（A：密钥/SSRF/路径/XSS 静态扫描；B：Agent 权限/外部内容信任/进程凭据精读），交叉核对后合并；冲突项以 HEAD 代码为准。本轮修复 1 个 P1（`delete_project` 审批目标缺失 + ghost 分支可递归删除任意两段目录）并补回归测试。

## 一、Findings

| # | 级别 | 位置 | 问题 | 影响 | 状态 |
|---|---|---|---|---|---|
| S3-1 | P1 | `engine/agent/harness/host-tools.ts:770-799`、`ui/services/agent-port.ts:638-653`、`engine/agent/harness/agent-loop.ts:318-333` | `delete_project` 的 `required:[]` 允许空参，审批摘要退化为「执行完成」；`agent-port` ghost 分支对任意「库/两段目录」递归删除，不要求项目身份标志；确认框警告统一为「后台写入/消耗额度」 | 提示注入可诱导用户确认一个不显示目标、甚至空目标的不可恢复删除（真实项目或 长篇小说/素材 等任意目录） | **本轮已修**：参数必填且空参拒绝、摘要显示「删除项目 X/未指定项目（将拒绝执行）」、ghost 分支要求命中 `PROJECT_IDENTITY_MARKERS`、删除类确认框改为「永久删除且不可恢复」；新增 3 条回归测试 |
| S3-2 | P2 | `shared/fanfic-audit.ts:247-302`、`shared/canon-source.ts:228-241`、`engine/harness/ai-assisted-premise-service.ts:136-157`、`engine/agent/harness/prompt-sections.ts:65-73`、`host-tools.ts:152-158/555-567/607-625/828-848`、`harness-engine.ts:322-339`、`session-snapshot.ts:150-201` | 只有 `read_file`/`search_vault` 有资料围栏；原著摘录进 **system** prompt、趋势片段原样进 user prompt、章节标题/项目状态/执行状态/项目名等工具结果未围栏；压缩摘要把工具文本「洗白」成可信摘要并持久化；恢复的会话事件按用户消息信任 | 共享/导入库或搜索片段中的指令可进入模型上下文；摘要与恢复会话让注入跨轮/跨重启存活且用户不可见 | 未修 → fix queue（所有外部/库内文本统一 `wrapUntrustedContent`；摘要与恢复事件加数据处理） |
| S3-3 | P2 | `shared/canon-source.ts:101-113`、`services/canon-research-service.ts:206-218/383-391` | `official` 等级由标题关键词（官方/原著/official/author…）或调用方 `tier` 授予；缓存的 `sources.json` 原样信任 | 任意域名的搜索页可被标成「官方原著」，绕过「无官方来源不生成」硬闸门，并把攻击者文本当权威资料注入 | 未修 → fix queue（官方等级只认域名白名单/用户显式确认；缓存条目重分类+校验） |
| S3-4 | P2 | `core/settings-service.ts:193-208`、`engine/embedding/provider-factory.ts:112-128`、`services/model-discovery.ts:229-240`、`services/canon-research-service.ts:282-340`、`services/update-checker.ts:352-354` | 锁定态下 `decryptWithoutPrompt` 返回密文；向量化/模型列表/考据/更新检查仍把 `aes256v2:` 当 Bearer/x-api-key 发出 | 口令保护密文离开设备（离线爆破面+第三方日志），请求静默 401；v1 密文可公开 seed 解密 | 未修 → fix queue（统一 `resolveStoredSecret`，禁止发送 `aes256(v2)?:` 前缀值） |
| S3-5 | P2 | `engine/agent/dsh/dsh-launch.ts:113-120`、`dsh-process.ts:91-134`、`ui/agent-workbench-view.ts:1271-1292` | dsh 子进程 env 仍注入 `DEEPSEEK_API_KEY` 且后代继承；只读 workspace 仍是 vault 根，`.obsidian`/`data.json`/`.sessions` 可读，无 deny 列表 | 密钥经 env/`/proc` 可读；提示注入可外传；插件凭据与私密笔记可被读取 | 未修（S2-2 仍开） → fix queue |
| S3-6 | P2 | `engine/agent/harness/tool-registry.ts:275-278`、`host-tools.ts:718-728`、`ui/agent-workbench-view.ts:1173-1181`、`ui/services/agent-port.ts:579-596` | 布尔参数接受字符串 `"true"`（`append:"true"` 被当 false → 覆盖而非追加）；审批的 exists 探测与锁内写存在 TOCTOU；activeProject 内新文件全自动放行（含 `sources.json` 等信任配置） | 静默截断/覆盖已有正文；审批意图与实际动作不一致；可植入信任配置 | 未修 → fix queue（严格布尔、锁内重查存在、敏感路径不自动放行、摘要显示覆盖/追加） |
| S3-7 | P2 | `engine/agent/harness/host-tools.ts:901-915`、`ui/services/agent-port.ts:423-456`、`ui/command-ui-executor.ts:241-247` | `run_command` 审批只显示 commandId+模型理由，不显示目标项目；守卫解析项目与命令实际作用项目来自不同上下文（会话/工作台/活动文件） | 高成本/写盘命令可能在误导性确认后作用于另一个项目 | 未修 → fix queue（参数显式 project + 审批摘要带目标 + 命令层 fail-closed） |
| S3-8 | P2 | `core/settings-service.ts:280-298/309-355`、`ui/settings/api-section.ts:350-362`、`ui/manage-providers-modal.ts:318-328` | 加密失败仍返回旧密文/空串，`saveSettings()` 返回 void，UI 无条件提示「已保存」；`.bak` 单份覆盖不轮转 | 泄露的旧 Key 实际未替换，用户误以为已轮换 | 未修（S2-4 仍开） → fix queue |
| S3-9 | P2 | `scripts/check-secrets.mjs:30-36/69-72` | 仍漏 GitHub PAT/AWS/Tavily/Slack/`x-api-key` 与 UTF-16；无 pre-push | 密钥可进入公开历史，CI 在 push 后才发现 | 未修（S2-3 仍开） → fix queue |
| S3-10 | P2 | `shared/secret-display.ts:14-15/105-125`、`shared/secret-redaction.ts:92/128-133`、`services/backup-center-service.ts:109-119`、`core/settings-service.ts:130-144` | v1 密文（公开 seed 派生）仍被文案称作「加密」；混合态（明文+密文）被报成「已加密」 | 用户误以为 data.json/.bak 安全 | 未修（S2-1 仍开） → fix queue |
| S3-11 | P3 | `shared/canon-source.ts:68-79/132-146/238`、`ui/fanfic-review-modal.ts:404` | 手工来源 URL 保留 userinfo 与 `?token=`，并写入 system prompt/审核记录/sources.json | 内嵌凭据泄露给模型供应商并明文落库 | 未修 → fix queue（拒绝 userinfo、脱敏敏感 query） |
| S3-12 | P3 | `core/crypto-service.ts:228-234/348-363` | `aes256v2:` 的 PBKDF2 迭代数无上限（仅 >0） | 篡改/同步的 data.json 可让解锁卡死（DoS） | 未修 → fix queue（夹到 100k–1M） |
| S3-13 | P3 | `services/update-checker.ts:494-535`、`ui/settings/general-sections.ts:753-768` | 自定义更新 URL 无 scheme/私网校验，启动后自动请求 | 盲 SSRF 打 localhost/LAN | 未修（S2-7 旁路） → fix queue（复用 isPrivateHost、非手动要求 https） |
| S3-14 | P3 | `ui/settings/api-section.ts:344-349`、`ui/manage-providers-modal.ts:307-317`、`ui/password-modal.ts:77-81` 等 | 密钥框无 `autocomplete=new-password`/`1p-ignore`；解锁后明文进 DOM；Token 逐键保存 | 自动填充/屏幕共享泄露 | 未修（S2-5 仍开） → fix queue |
| S3-15 | P3 | `ui/settings/general-sections.ts:741-747`、`services/update-checker.ts:352-354`、`main.ts:1581-1591` | 密文被当输入值显示；UpdateChecker 把密文当 Bearer；重置口令漏 `canonResearch.apiKey` | 私有仓库检查 401；考据 Key 永久解不开 | 未修（S2-6 仍开） → fix queue |
| S3-16 | P3 | `shared/paths.ts:976-1004/1439-1453`、`shared/plugin-data-migration.ts:78-118`、`core/settings-service.ts:373-386`、`shared/plugin-cache.ts:177-197` | 路径 helper 不拒 `..`/绝对路径；`contentType` 无白名单；`deepMergeSettings` 接受 `__proto__`；cache 动态键不看 own property | manifest.dir/同步数据被污染时单点越界与原型替换 | 未修（S2-10/11/12 仍开） → fix queue |
| S3-17 | P3 | `engine/agent/harness/host-tools.ts:752-769`、`ui/services/agent-port.ts:618-637` | `move_file` 仅写级、无项目范围；allow 模式静默跨项目移动/覆盖 | 项目身份文件被搬走导致「项目消失」 | 未修 → fix queue |
| S3-18 | P3 | `ui/services/agent-port.ts:95-98`、`ui/agent-workbench-view.ts:1196`、`ui/services/agent-spill-store.ts:34-36` | spill 作用域用活动项目、会话用另一项目；slug 冲突（`长篇小说/书A` 与 `长篇小说-书A`） | 跨项目 spill 读取/删除与恢复错位 | 未修 → fix queue |
| S3-19 | P3 | `ui/services/agent-session-store.ts:174-183`、`engine/agent/harness/session-snapshot.ts:150-201`、`harness-engine.ts:418-428` | 恢复的快照事件/记忆未校验，`memory.pickedProject` 可预置 | 同步/本地篡改可预置注入与权限输入 | 未修 → fix queue（校验项目在活跃列表；恢复记忆降级为不可信） |
| S3-20 | P3 | `services/canon-research-service.ts:350-356`、`shared/http-request.ts:105-123` | 地址字面量已补 IPv4-mapped/ULA/link-local，但重定向仍跟随、无 DNS 解析校验 | 3xx/DNS 重绑定绕过私网判断 | 未修（S2-7 部分） → fix queue |
| S3-21 | P3 | `engine/chapter-utils.ts:37-39` | 中央章节文件名 helper 未净化标题参数（当前 AI 路径在调用方已净化） | 未来调用方传入 `../` 即路径穿越 | 未修 → fix queue（helper 内 sanitize） |

## 二、r2 遗留项复核（HEAD 810cd84）

- **已修**：S2-8（资料围栏+新文件项目前缀+端口兜底）、S2-9（记忆碎片名净化）。
- **部分已修**：S2-7（地址字面量增强；重定向/DNS 仍开 → S3-20）、S2-10（入口校验加严但 helper 原语仍开 → S3-16）。
- **仍开**：S2-1 → S3-10、S2-2 → S3-5、S2-3 → S3-9、S2-4 → S3-8、S2-5 → S3-14、S2-6 → S3-15、S2-11/12 → S3-16。

## 三、已排除项（交叉确认）

- **HTML 汇**：生产 `*.ts` 已无 `innerHTML/outerHTML/insertAdjacentHTML` 赋值；`ui/rendering/safe-html.ts` 统一走 `sanitizeHTMLToDom`；Markdown 渲染走 `MarkdownRenderer`。
- **路径守卫**：`shared/file-path-guard.ts` 拒绝绝对路径/盘符/控制字符/`.`/`..`/隐藏目录；Agent 文件工具全部经过它；spill 前缀为精确前缀匹配。
- **命令执行**：`run_command` 只允许插件注册表内命令（`registry.has` 先于任何 fallback）；无 `eval`/`new Function`/shell exec；唯一子进程是 dsh（见 S3-5）。
- **密钥账本/备份**：`secret-redaction` 覆盖 apiKey/token/secret/password/cookie/credential 与整个 providerKeys；usage-ledger 只记模型/token/状态/错误；`data.json`/`data/`/`*.bak` 均未入库；`check:secrets` 当前 1,952 文件通过（缺口是模式覆盖，不是已入库密钥）。
- **无「AI 内容直接外传密钥到攻击者主机」链路**：A 视角未发现 P1；B 视角的 P1 是可破坏性删除（S3-1，已修）。

## 四、待用户拍板

- 无（本轮修复为收紧权限，不改变产品语义）。

## 五、fix queue

1. S3-2 外部/库内文本统一围栏 + 摘要/恢复事件降级（P2）
2. S3-3 官方来源等级去标题化 + 缓存重分类（P2）
3. S3-4 统一 `resolveStoredSecret`，禁止发送密文（P2）
4. S3-5 dsh 凭据/workspace deny（P2）
5. S3-6 布尔严格化 + 锁内重查 + 敏感路径不自动放行（P2）
6. S3-7 run_command 目标项目显式化（P2）
7. S3-8/S3-9/S3-10 保存结果可观测、check-secrets 补模式、加密文案如实（P2）
8. S3-11~S3-21（P3）
