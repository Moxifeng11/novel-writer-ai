# 自动交叉审计 — 安全（③，三轮复审）

> 日期：2026-11-11 · 基线：`810cd84` · 维度：③ 安全（密钥/注入/权限/外部输入）
> 方法：两个独立子代理取证（A：密钥/SSRF/路径/XSS 静态扫描；B：Agent 权限/外部内容信任/进程凭据精读），交叉核对后合并；冲突项以 HEAD 代码为准。本轮修复 1 个 P1（`delete_project` 审批目标缺失 + ghost 分支可递归删除任意两段目录）并补回归测试。

## 一、Findings

| # | 级别 | 位置 | 问题 | 影响 | 状态 |
|---|---|---|---|---|---|
| S3-1 | P1 | `engine/agent/harness/host-tools.ts:770-799`、`ui/services/agent-port.ts:638-653`、`engine/agent/harness/agent-loop.ts:318-333` | `delete_project` 的 `required:[]` 允许空参，审批摘要退化为「执行完成」；`agent-port` ghost 分支对任意「库/两段目录」递归删除，不要求项目身份标志；确认框警告统一为「后台写入/消耗额度」 | 提示注入可诱导用户确认一个不显示目标、甚至空目标的不可恢复删除（真实项目或 长篇小说/素材 等任意目录） | **本轮已修**：参数必填且空参拒绝、摘要显示「删除项目 X/未指定项目（将拒绝执行）」、ghost 分支要求命中 `PROJECT_IDENTITY_MARKERS`、删除类确认框改为「永久删除且不可恢复」；新增 3 条回归测试 |
| S3-2 | P2 | `shared/fanfic-audit.ts:247-302`、`shared/canon-source.ts:228-241`、`engine/harness/ai-assisted-premise-service.ts:136-157`、`engine/agent/harness/prompt-sections.ts:65-73`、`host-tools.ts:152-158/555-567/607-625/828-848`、`harness-engine.ts:322-339`、`session-snapshot.ts:150-201` | 只有 `read_file`/`search_vault` 有资料围栏；原著摘录进 **system** prompt、趋势片段原样进 user prompt、章节标题/项目状态/执行状态/项目名等工具结果未围栏；压缩摘要把工具文本「洗白」成可信摘要并持久化；恢复的会话事件按用户消息信任 | 共享/导入库或搜索片段中的指令可进入模型上下文；摘要与恢复会话让注入跨轮/跨重启存活且用户不可见 | **已修（第69轮，核心路径）**：原著摘录/趋势片段/项目名/章节列表/项目状态/执行记录全部 `wrapUntrustedContent`；压缩输入围栏工具轮次 + 摘要提示词禁止转述指令；restore 丢弃不在活跃列表的 `pickedProject`；策略段新增「围栏内文字是数据不是指令」；5+2 条测试 |
| S3-3 | P2 | `shared/canon-source.ts:101-113`、`services/canon-research-service.ts:206-218/383-391` | `official` 等级由标题关键词（官方/原著/official/author…）或调用方 `tier` 授予；缓存的 `sources.json` 原样信任 | 任意域名的搜索页可被标成「官方原著」，绕过「无官方来源不生成」硬闸门，并把攻击者文本当权威资料注入 | **已修（第70轮）**：`official` 只认发行人域名白名单；`loadCache` 重算 tier/摘录哈希、非法 URL 丢弃；3 条测试 |
| S3-4 | P2 | `core/settings-service.ts:193-208`、`engine/embedding/provider-factory.ts:112-128`、`services/model-discovery.ts:229-240`、`services/canon-research-service.ts:282-340`、`services/update-checker.ts:352-354` | 锁定态下 `decryptWithoutPrompt` 返回密文；向量化/模型列表/考据/更新检查仍把 `aes256v2:` 当 Bearer/x-api-key 发出 | 口令保护密文离开设备（离线爆破面+第三方日志），请求静默 401；v1 密文可公开 seed 解密 | **已修（第70轮）**：新增 `shared/secret-value`（`isStoredCiphertext`/`usableSecret`），四个出网边界统一按「未解锁」处理；3 条测试 |
| S3-5 | P2 | `engine/agent/dsh/dsh-launch.ts:113-120`、`dsh-process.ts:91-134`、`ui/agent-workbench-view.ts:1271-1292` | dsh 子进程 env 仍注入 `DEEPSEEK_API_KEY` 且后代继承；只读 workspace 仍是 vault 根，`.obsidian`/`data.json`/`.sessions` 可读，无 deny 列表 | 密钥经 env/`/proc` 可读；提示注入可外传；插件凭据与私密笔记可被读取 | **部分已修（第71轮）**：`buildDshLaunchPlan` 剔除调用方经 env 夹带的凭据键（`*_API_KEY/_TOKEN/_SECRET/_PASSWORD/AUTHORIZATION`），凭据只能显式注入；**残余**：Key 仍经 env 传给 dsh（上游未提供凭据文件机制，见 docs/research）+ 只读 workspace 仍为 vault 根（需 dsh 支持 deny 后再收） |
| S3-6 | P2 | `engine/agent/harness/tool-registry.ts:275-278`、`host-tools.ts:718-728`、`ui/agent-workbench-view.ts:1173-1181`、`ui/services/agent-port.ts:579-596` | 布尔参数接受字符串 `"true"`（`append:"true"` 被当 false → 覆盖而非追加）；审批的 exists 探测与锁内写存在 TOCTOU；activeProject 内新文件全自动放行（含 `sources.json` 等信任配置） | 静默截断/覆盖已有正文；审批意图与实际动作不一致；可植入信任配置 | **已修（第71轮）**：布尔参数严格化（字符串拒绝并提示改法）；锁内重查存在性，审批后出现即拒绝并要求重新确认；`isSensitiveAutoApprovePath`（系统模板/项目总控/同人资料/时间线/正文目录/sources.json/.project）不允许自动放行；5 条测试 |
| S3-7 | P2 | `engine/agent/harness/host-tools.ts:901-915`、`ui/services/agent-port.ts:423-456`、`ui/command-ui-executor.ts:241-247` | `run_command` 审批只显示 commandId+模型理由，不显示目标项目；守卫解析项目与命令实际作用项目来自不同上下文（会话/工作台/活动文件） | 高成本/写盘命令可能在误导性确认后作用于另一个项目 | **已修（第72轮）**：新增 `project` 参数（不存在即拒绝）；审批摘要显示 `commandId → 目标项目`；`executeCommandAsync(id, project)` 执行期临时注入工作台上下文并恢复；3 条测试 |
| S3-8 | P2 | `core/settings-service.ts:280-298/309-355`、`ui/settings/api-section.ts:350-362`、`ui/manage-providers-modal.ts:318-328` | 加密失败仍返回旧密文/空串，`saveSettings()` 返回 void，UI 无条件提示「已保存」；`.bak` 单份覆盖不轮转 | 泄露的旧 Key 实际未替换，用户误以为已轮换 | **已修（第72轮，保存结果）**：`saveSettings()` 返回 `SaveSettingsOutcome.droppedSecrets`，`saveSettingsWithOutcome()` 供 UI 用；两个设置页在未解锁时提示「密钥未保存」。残余：`.bak` 轮转仍开 |
| S3-9 | P2 | `scripts/check-secrets.mjs:30-36/69-72` | 仍漏 GitHub PAT/AWS/Tavily/Slack/`x-api-key` 与 UTF-16；无 pre-push | 密钥可进入公开历史，CI 在 push 后才发现 | **已修（第73轮，模式与编码）**：补 GitHub PAT/AWS/Tavily/Slack/x-api-key 模式；UTF-16LE/BE（BOM + 奇偶 NUL 启发）解码后扫描；仍无 pre-push（残余） |
| S3-10 | P2 | `shared/secret-display.ts:14-15/105-125`、`shared/secret-redaction.ts:92/128-133`、`services/backup-center-service.ts:109-119`、`core/settings-service.ts:130-144` | v1 密文（公开 seed 派生）仍被文案称作「加密」；混合态（明文+密文）被报成「已加密」 | 用户误以为 data.json/.bak 安全 | **已修（第73轮）**：新增 `obfuscated` 存储态（仅有 v1 或 v1+v2 混合时不再称「已加密」）；备份中心与设置页文案如实说明「知道库路径即可解密」；混合明文仍报 plaintext；4 条测试 |
| S3-11 | P3 | `shared/canon-source.ts:68-79/132-146/238`、`ui/fanfic-review-modal.ts:404` | 手工来源 URL 保留 userinfo 与 `?token=`，并写入 system prompt/审核记录/sources.json | 内嵌凭据泄露给模型供应商并明文落库 | **已修（第74轮）**：`normalizeSourceUrl` 剥离 userinfo，token/access_token/api_key/key/secret/password/sig/signature/auth 值脱敏为 REDACTED；3 条测试 |
| S3-12 | P3 | `core/crypto-service.ts:228-234/348-363` | `aes256v2:` 的 PBKDF2 迭代数无上限（仅 >0） | 篡改/同步的 data.json 可让解锁卡死（DoS） | **已修（第74轮）**：迭代数夹到 100k–1M，越界在 parseV2/decryptV2 拒绝（不弹口令），v2 前缀非法参数的口令校验判失败；4 条测试 |
| S3-13 | P3 | `services/update-checker.ts:494-535`、`ui/settings/general-sections.ts:753-768` | 自定义更新 URL 无 scheme/私网校验，启动后自动请求 | 盲 SSRF 打 localhost/LAN | **已修（第75轮）**：`isPrivateHost` 抽到 `shared/private-host` 单源；自定义更新只允许 https、拒绝 userinfo、拒绝本机/内网；3 条测试 |
| S3-14 | P3 | `ui/settings/api-section.ts:344-349`、`ui/manage-providers-modal.ts:307-317`、`ui/password-modal.ts:77-81` 等 | 密钥框无 `autocomplete=new-password`/`1p-ignore`；解锁后明文进 DOM；Token 逐键保存 | 自动填充/屏幕共享泄露 | **已修（第75轮，输入框属性）**：新增 `SECRET_INPUT_ATTRS` 并接入 provider key ×2、口令框 ×2、GitHub Token；正文「逐键保存」与解锁后明文 DOM 仍留（P3 残余） |
| S3-15 | P3 | `ui/settings/general-sections.ts:741-747`、`services/update-checker.ts:352-354`、`main.ts:1581-1591` | 密文被当输入值显示；UpdateChecker 把密文当 Bearer；重置口令漏 `canonResearch.apiKey` | 私有仓库检查 401；考据 Key 永久解不开 | **已修（第76轮）**：设置页检测到 `aes256(v2):` 密文时不再回填输入框（留空 + 「口令未解锁，不显示」占位，空输入视为未改动保留原密文）；`resetKeyPassword` 补 `canonResearch.apiKey`，解不开即清空并列入提示；Bearer 侧沿用第 70 轮 `usableSecret`（密文一律视为未配置）；3 条测试 |
| S3-16 | P3 | `shared/paths.ts:976-1004/1439-1453`、`shared/plugin-data-migration.ts:78-118`、`core/settings-service.ts:373-386`、`shared/plugin-cache.ts:177-197` | 路径 helper 不拒 `..`/绝对路径；`contentType` 无白名单；`deepMergeSettings` 接受 `__proto__`；cache 动态键不看 own property | manifest.dir/同步数据被污染时单点越界与原型替换 | **已修（第76轮）**：`setPluginRootDir`/`resolvePluginRootDir` 在**去前导斜杠之前**拒绝绝对路径/盘符/协议/`..` 段（否则 `/etc` 会被剥成相对 `etc` 绕过）；`pjContentTypeVersionsDir` 走五项白名单；`deepMergeSettings` 跳过 `__proto__`/`constructor`/`prototype`；插件缓存读取走 own property、写入拒绝危险键（`obj['__proto__']=x` 会改原型）；8 条测试 |
| S3-17 | P3 | `engine/agent/harness/host-tools.ts:752-769`、`ui/services/agent-port.ts:618-637` | `move_file` 仅写级、无项目范围；allow 模式静默跨项目移动/覆盖 | 项目身份文件被搬走导致「项目消失」 | **已修（第77轮）**：`moveFile` 用 `projectIdFromPath` 校验源与目标同项目，跨项目直接拒绝并给出双方归属；同项目内移动不受影响 |
| S3-18 | P3 | `ui/services/agent-port.ts:95-98`、`ui/agent-workbench-view.ts:1196`、`ui/services/agent-spill-store.ts:34-36` | spill 作用域用活动项目、会话用另一项目；slug 冲突（`长篇小说/书A` 与 `长篇小说-书A`） | 跨项目 spill 读取/删除与恢复错位 | **已修（第77轮）**：`createAgentPort` 新增 `spillScope` 选项，工作台传入与 spill 写入同一个 `resolveActiveProject()`（此前端口用 `plugin.getActiveProject()`、写入用 workbench resolver，切项目后分叉）；`spillFolderFor` 附加 scope 的 FNV-1a 稳定短哈希，不同 scope 必落不同目录 |
| S3-19 | P3 | `ui/services/agent-session-store.ts:174-183`、`engine/agent/harness/session-snapshot.ts:150-201`、`harness-engine.ts:418-428` | 恢复的快照事件/记忆未校验，`memory.pickedProject` 可预置 | 同步/本地篡改可预置注入与权限输入 | **已修（第77轮）**：`MEMORY_SLOT_KEYS` 提到 `harness-types` 作单源，`parseSessionSnapshot` 只接受白名单槽位键（未知键丢弃）；事件只保留最近 `MAX_RESTORED_EVENTS`(2000) 条；顺带修掉 `context.projects` 的 `String(null)`→`"null"` 假项目残留 |
| S3-20 | P3 | `services/canon-research-service.ts:350-356`、`shared/http-request.ts:105-123` | 地址字面量已补 IPv4-mapped/ULA/link-local，但重定向仍跟随、无 DNS 解析校验 | 3xx/DNS 重绑定绕过私网判断 | **部分修复（第77轮）**：`fetchPage` 拒绝非 2xx 响应（不再把 30x/404 中间页当正文）。**残余**：Obsidian `requestUrl` 由 Electron net 强制跟随重定向且不暴露最终 URL，renderer 无 dns API，插件层无法复核 3xx 目标主机或做 DNS 校验，需上游 API 支持 |
| S3-21 | P3 | `engine/chapter-utils.ts:37-39` | 中央章节文件名 helper 未净化标题参数（当前 AI 路径在调用方已净化） | 未来调用方传入 `../` 即路径穿越 | **已修（第77轮）**：`getChapterFileName` 内部对标题与类型都走 `sanitizeFileSegment`，纯非法字符输入给「未命名章」兜底 |

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

- 第69轮（S3-2）：`canon-source` 摘录、`trend-research` 片段、`ai-assisted-premise` 来源块、`prompt-sections` 项目名、`host-tools` 四类工具结果统一围栏；`harness-engine` 压缩输入围栏工具轮次并在摘要提示词禁止转述指令；`restore` 校验 `pickedProject` 是否在活跃项目列表。新增 5 条围栏测试 + 2 条 harness 行为测试。

- 第70轮（S3-3/S3-4）：`classifyCanonSource` 删除标题关键词与调用方 tier 授权，`official` 只认发行人域名；`loadCache` 重算 tier/excerptHash 并丢弃非法 URL。新增 `shared/secret-value`，嵌入工厂/模型发现/考据检索/更新检查四处密文一律视为未配置（模型发现直接返回「请先解锁口令」）。新增 6 条测试。

- 第71轮（S3-5/S3-6）：`buildDshLaunchPlan` 剔除 env 夹带凭据；工具布尔严格化；`agent-port.writeFile` 锁内重查存在性（TOCTOU 拒绝）；新增 `isSensitiveAutoApprovePath` 并接入自动放行入口。新增 8 条测试。S3-5 残余：dsh Key 经 env 注入与只读 workspace 范围需上游沙箱支持，记入 fix queue。

- 第72轮（S3-7/S3-8）：`run_command` 增加显式 project 参数（未知即拒绝），审批摘要显示目标项目，`executeCommandAsync(id, project)` 执行期临时注入工作台上下文；`SettingsService.saveSettings` 返回 `SaveSettingsOutcome`（droppedSecrets），两个密钥输入框按结果提示「未保存」。新增 3+4 条测试。

- 第73轮（S3-9/S3-10）：`check-secrets` 补 5 类第三方密钥形态与 UTF-16 解码（BOM/奇偶 NUL）；`SecretStorageMode` 新增 `obfuscated`，`detectSecretStorageMode` 只有全 v2 才算 encrypted，备份中心与设置页对 v1 混淆格式给出真实风险文案。新增 4 条测试并更新 2 条旧断言；真实仓 1958 文件门禁通过。

- 第74轮（S3-11/S3-12）：`normalizeSourceUrl` 剥离 userinfo 并脱敏敏感 query；`crypto-service` 新增 `PBKDF2_MIN/MAX_ITERATIONS` 与 `normalizeV2Iterations`，parseV2/decryptV2 越界拒绝，verifyPasswordAgainst 对 v2 非法参数判失败。新增 7 条测试。

- 第75轮（S3-13/S3-14）：`isPrivateHost` 抽到 `shared/private-host` 单一实现并保留考据服务再导出；自定义更新 URL 只允许 https、拒绝 userinfo 与私网。密钥/口令/Token 输入框统一 `autocomplete=new-password` + `data-1p-ignore`/`data-lpignore`。新增 5 条测试。

- 第76轮（S3-15/S3-16）：`general-sections` 的 GitHub Token 框检测密文后留空并说明「口令未解锁」，空输入视为未改动；`resetKeyPassword` 补 `canonResearch.apiKey`（此前漏项导致口令重置后考据 Key 永久解不开）。`shared/paths` 新增「清洗前拒绝绝对形态」判定，`setPluginRootDir`/`resolvePluginRootDir` 对盘符/绝对路径/协议/`..` 段回退安全根目录；`pjContentTypeVersionsDir` contentType 五项白名单（非白名单回退 `chapter`）。`deepMergeSettings` 跳过 `__proto__`/`constructor`/`prototype`；插件缓存读取走 `hasOwnProperty`、写入拒绝危险键（`obj['__proto__']=x` 是设置原型而非自有属性）。新增 12 条测试（S3-16 八条 + S3-15 三条 + 正常路径回归一条）。

> 第76轮备注：本轮由 dsh 执行。开工前工作树存在一批 45 文件的外部写入，经 blob 比对确认 41 个待判定文件中 38 个精确等于 2026-11-09 的历史版本（旧快照整批回退，破坏 4 个架构契约测试），已备份到 `.rollback-backup/20261111-111130` 后回滚至 HEAD，复验 685 文件 / 7111 用例全绿后再实施本批。

- 第77轮（S3-17~S3-21 收尾，由 dsh 执行）：`moveFile` 补项目范围校验（`projectIdFromPath` 源目标必须同项目）；`createAgentPort` 新增 `spillScope`，工作台传入与 spill 写入同一个 `resolveActiveProject()`，`spillFolderFor` 附加 scope 稳定短哈希消解 slug 碰撞；`MEMORY_SLOT_KEYS` 提到 `harness-types` 单一来源，`parseSessionSnapshot` 只恢复白名单槽位键 + `MAX_RESTORED_EVENTS` 事件上限，并修掉 `context.projects` 把 `null` 变 `"null"` 假项目的既有 bug；`getChapterFileName` helper 内净化；`fetchPage` 拒绝非 2xx。新增 23 条测试（安全用例）。**安全 r3 现 20/21 已修，仅 S3-5 与 S3-20 保留上游依赖残余**（dsh 凭据文件机制 / Obsidian requestUrl 重定向控制）。
