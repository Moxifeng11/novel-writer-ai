# 自动交叉审计 · 维度③ 安全（密钥 / 注入 / 权限 / 外部输入）

- 日期：2026-11-09
- 触发：HANDOFF `nextAudit=security`（无 Trae 消息，分支 B2）
- 审计方式：**两个独立只读视角交叉取证**——A 视角做全仓安全模式扫描（密钥/注入/路径/权限/网络，302 次工具调用）；B 视角精读密钥链路、Agent 审批、内容注入、外部输入落盘与网络（134 次工具调用）。ZCode 对全部 P1 逐条复核并修复其中 2 项。
- 结论：**P1 3 项（本轮修 2 项、1 项经复核判为误报）**、P2 8 项、P3 若干；已排除 13 类「疑似问题」。**无 P0。**
- **交叉核对纠偏**：两方审计都报「向量/同人/更新 Token 的密文被当凭据发送（S-3）」，ZCode 复核发现 `core/settings-service.ts:200-208` 已对 `vectorOpenaiApiKey` / `vectorDoubaoApiKey` / `vectorQwenApiKey` / `updateGithubToken` / `canonResearch.apiKey` 统一 `decryptWithoutPrompt`，**该条不成立**，已移入 §三。这条也说明「双方同报≠事实」，必须落到代码行复核。

## 一、已修（本轮，P1，均带测试）

| ID | 位置 | 问题 | 触发条件 | 影响 | 复核 |
|---|---|---|---|---|---|
| S-1 | `engine/batch-import-manager.ts:504`、`services/knowledge-base-manager.ts:963`、`ui/views/knowledge-base-modals.ts:258` | 源文本路径 `${kbBookDir(bookName)}/${bookName}.txt` 的**文件名段用原始书名**（目录段已净化） | 导入一本首行为 `../../README` 的 txt（书名取自首行）或手填含 `/` 的书名 | 可穿越出书目录并向 vault 内任意 `.txt`（含 `.obsidian/**/*.txt`）写入/覆盖；`getSourceText` 可反向读取 | 复核成立（`sanitizeName` 只保护了目录段）；修法：新增 `kbBookSourceFile()` 单源，目录与文件名两段都净化，三处调用统一 |
| S-2 | `ui/agent-workbench-view.ts:1055-1062` | `write_file` 新文件自动放行用**原始** `args.path` 调 `adapter.exists`，而真正写入前 `sanitizeVaultPath` 会剥掉首尾引号 | 模型传 `path: "\"项目/正文/第1章_正文.md\""`（带引号） | `exists=false` → 自动放行；净化后命中已有正文并覆盖，**覆盖确认被完全跳过** | 复核成立；修法：新增 `shouldAutoApproveNewFile()`——先净化再探测，净化失败/探测异常一律走确认 |

| S-5 | `engine/agent/harness/agent-loop.ts:289-303` | 审批摘要只列**参数名**：`run_command` 一旦带 `reason`，确认框显示「commandId、reason」而不显示实际命令 ID；`write_file` 显示「path、content」 | 模型（或 prompt injection）给命令加 `reason` 字段 | 用户对删除/移动/覆盖/批量命令的确认退化为「盲点确认」 | 复核成立；修法：写/删/移/命令工具生成真实摘要（`写入 <path>` / `删除 <path>` / `<from> → <to>` / `<commandId> — <reason>`，长值截断 80 字符） |

测试：`tests/unit/shared/paths-sanitize.test.ts` +3（穿越/普通/非法字符）；`tests/unit/shared/file-path-guard.test.ts` +3（带引号已存在 → 必须确认；新文件放行；非法路径/异常 → 确认）；`tests/unit/engine/harness-tool-pipeline.test.ts` +2（`run_command` 带 reason 仍显示命令 ID；`write_file`/`move_file` 显示真实路径）。

## 二、Fix queue（未修）

| ID | 严重度 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| S-4 | **已拍板 B** | `core/settings-service.ts:279/297` + `ui/settings/api-section.ts` | **首次保存密钥默认明文落盘**：无会话口令且该字段磁盘上从无密文时直接 `return value`（当前 `data.json` 已是「部分密文 + 部分明文」混合） | **2026-11-09 用户拍板 B**：保持明文保存，但必须在设置页**明确标注风险**。已实现：`shared/secret-display.describeKeyEncryptionStatus()` 单源生成状态文案（未设口令 → 「⚠️ 明文保存在 data.json，会随 vault 同步/备份扩散」），设置页「密钥加密」行改用它；+3 单测 |
| S-6 | P2 | `ui/svg-charts.ts:471/552/677/1082/1225/1565…` | `data-value`/`data-x/y`/`fill`/`stroke` 直接拼未校验值；`knowledge-detail` 的图表数据来自 frontmatter `JSON.parse` + 类型断言（无 schema 校验） | 数值入口 `Number()` 强转 + 颜色白名单；或对属性值统一 `escapeHtml`（约 15 行） |
| S-7 | P2 | `ui/polish-editor.ts:41-45/86-90/251/310` | 本地 `escapeHtml` 用 `textContent→innerHTML` 实现，**不转义双引号**，随后拼进 `title="…" data-entity-name="…"` | 改用 `@/utils/helpers` 的 `escapeHtml`（已覆盖 `"`） |
| S-8 | P2 | `ui/agent-workbench-view.ts:1191`、`engine/agent/dsh/dsh-launch.ts:55-61` | dsh `workspace` = 整个 vault，`workspace-write` 未排除 `.obsidian`；解密后的 Key 以 `DEEPSEEK_API_KEY` 注入子进程 env | workspace 收窄到当前项目目录；`.obsidian` 排除；Key 改用请求时注入 |
| S-9 | P2 | `engine/agent/harness/host-tools.ts:952` | 危险命令正则漏网：`targeted-revision`（写正文）、`generate-bases`（写看板）、`complete-properties`、`migrate-*`、`rename-project` 等 | 改为「非只读命令一律确认」或把正则换成命令元数据白名单（约 20 行） |
| S-10 | P2 | `services/canon-research-service.ts:349-406` | SSRF 防护只校验初始 URL：3xx 跟随到内网不再校验；`isPrivateHost` 未覆盖 IPv6 ULA/link-local、IPv4-mapped、十进制 IP | 校验最终响应 URL/host，补全私网段 |
| S-11 | P2 | `ui/batch-import-modal.ts:1429`、`ui/views/knowledge-base-modals.ts:169` | 导入 `FileReader.readAsText`/`file.text()` 全量读入，无大小检查；`MAX_SOURCE_FILE_SIZE` 只 `log.warn` | 读取前用 `file.size` 拒绝，或流式分块 |
| S-12 | P2 | `ui/services/agent-port.ts:468/542/575/590` | `.sessions/` 白名单允许 Agent 读写删**整个** `.sessions`（跨项目会话 + 自身历史） | 收窄为 `.sessions/spill/agent/<当前项目>/`，禁止写 `agent/*.jsonl` |

P3（摘要）：v1 密文种子是公开常量；`iterations` 无上限（PBKDF2 DoS）；服务端错误体原样进日志/Notice；诊断包含 endpoint（query 可能带 token）；Agent 会话 JSONL 明文；`polish-editor` 日志打印正文前 80 字；远程图片随 Markdown 渲染外连；更新源允许 `http://` 且错误串带完整 URL；响应体无上限；导出同名静默覆盖；`data.json.bak` 单槽可能留旧明文。

## 三、已排除（复核后确认无问题）

| 项 | 证据 |
|---|---|
| 旁路密钥未解密（S-3，原报 P1） | `core/settings-service.ts:200-208` 已在加载时统一解密 `apiKey`/`providerKeys`/三个向量 Key/`updateGithubToken`/`canonResearch.apiKey`；消费方拿到的都是明文或空串 |
| 密钥进入日志/Notice/账本 | 全仓无 `log.*apiKey` / `Authorization` / `Bearer` 组合；账本只记模型/token/耗时/错误文本；诊断包只输出 `apiKeyConfigured` 布尔与脱敏 host |
| v2 加密算法 | PBKDF2 210k + 随机 salt/iv + GCM 校验；解密失败返回密文而非明文；主 AI 请求对密文有 `isEncryptedSecret` 拦截与「密钥未解锁」 |
| Agent 越出 vault / 读写 `.obsidian` | `sanitizeVaultPath` 拒绝绝对路径、盘符、`..`、控制字符、隐藏目录；读写删与删项目全部接入 |
| `eval` / `new Function` / `document.write` | 全仓源码 0 命中 |
| 命令 ID 注入 | `run_command` 先 `^novel-writer[-:]` 且 `registry.has` 双重限制；未注册命令直接失败，不回退 `executeCommandById` |
| dsh 命令行注入 | `spawn` 无 `shell:true`；版本号白名单；用户/模型输入走 stdin JSON-RPC，不拼命令行 |
| GitHub Token 外发 | 只发往 `api.github.com`；自定义更新源不带 Token |
| 参数绕过工具校验 | `tool-registry` 校验必填、拒绝未知参数；`approvalGranted` 由宿主注入，模型不可伪造 |
| 导出路径穿越 | `sanitizeFileName` 替换分隔符；导出目录固定 `导出文件/`；不覆盖正文 |
| 图表/实体/宠物 innerHTML | svg-charts 的 label/legend/轴标签已转义；其余 innerHTML 为数字/常量 |
| 模板导入/备份/项目迁移路径 | 均取 `file.name` / `detectProjects` / 固定时间戳，无外部可控穿越 |
| 更新下载完整性 | 客户端无下载/安装逻辑（`downloadUrl` 无消费方），不存在「下载后不校验」的现行漏洞 |

## 四、待用户拍板

- **S-4 已拍板（2026-11-09）**：用户选择 **B——保持明文保存，并在设置页明确标注风险**。已实现状态文案单源 `describeKeyEncryptionStatus()`（未设口令时提示「明文保存在 data.json，会随 vault 同步/备份扩散」）+ 3 条单测。若将来要改为 fail-closed（A），只需把该函数 `plaintext` 分支改为阻止保存（届时需要给「不设口令」的老用户加迁移提示）。

## 五、结论与下一步

- 本轮修复 2 项 P1（S-1 路径穿越、S-2 审批绕过）+ 1 项 P1（S-5 审批摘要），均带回归；**导入不可信书名不再能写出知识库目录，Agent 也不能再用带引号路径跳过覆盖确认，确认框能看到真实命令 ID 与路径**。S-3 经复核为误报。
- Fix queue 优先：S-9（危险命令覆盖）→ S-6/S-7（转义）→ S-8（dsh workspace/Key）→ S-10/S-11/S-12。
- 下一审计维度：**④ 覆盖率盲区与测试契约**（`nextAudit=coverage`）。
