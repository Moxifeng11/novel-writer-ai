# 自动交叉审计 · 维度③ 安全（增量复核）

- 日期：2026-11-09
- 触发：无 Trae 消息（分支 B2）；上一轮为 D-2 代码批次，本轮复核维度③（前次报告 `auto-cross-audit-2026-11-09-security.md` 的 fix queue）
- 审计方式：**两个独立只读视角交叉取证**——A 视角密钥/网络/外部输入/权限（155 次工具调用）；B 视角注入/路径/文件操作/渲染（286 次工具调用）。ZCode 对 P1 复核并修复 1 项。
- 结论：**P1 1 项（本轮修 1 项）**、P2 10 项、P3 4 项；已排除 12 类。**无 P0。**
- **交叉核对**：两方都确认 S-1/S-2/S-5 已修、S-4 按用户拍板 B 落地；S-6/S-8/S-10/S-11/S-12 两方同报，成立。S-7 存在冲突：A 报「实体名双引号可 XSS」，B 复核认为实体名先经 `escapeHtml` 再参与 `match`，含引号实体无法匹配，当前无可利用路径——采纳 B，降为 P3 防御性加固。S-9 的 `run_command` 仍每次审批，正则漏网只缺「额外危险提示」，不构成审批绕过，降为 P2。

## 一、已修（本轮，P1，带测试）

| ID | 位置 | 问题 | 触发条件 | 影响 | 修法 |
|---|---|---|---|---|---|
| SEC-1（新） | `services/chapter-version-service.ts:160/197/284-308/396/527`；`services/backup-center-service.ts:55-60`；`ui/backup-center-modal.ts:168-232` | 版本索引 `versions.json` 的 `versionPath`/`sourcePath` 直接采信 | 同步/共享项目里的 `_versions/<type>/<key>/versions.json` 被伪造，用户打开版本历史并回滚 | 任意文件读（diff）+ 任意写/删；可覆盖插件 `main.js`/`data.json`，形成持久化代码执行/密钥破坏 | 新增 `isSafeVersionMeta()`：版本路径必须落在本内容 `_versions` 目录，源路径必须是本项目内相对路径且无 `..`/盘符；索引读取过滤非法条目，`getVersionContent`/`rollbackToVersion`/`partialRollback`/`deleteVersion` 再校验；新增伪造索引单测 |

测试：`tests/unit/services/chapter-version-service.test.ts` +1（越界条目被丢弃、回滚抛「版本索引路径非法」），21/21 通过。

## 二、Fix queue（未修）

| ID | 严重度 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| SEC-2（S-6，已修） | P2 | `ui/svg-charts.ts:471/552-603/677/699/1082/1225/1455/1565/1740`；入口 `knowledge-base-view.ts:1686-1696`、`knowledge-detail-modal.ts:245` | SVG `data-*`/`<text>` 直接拼未经校验的 frontmatter 数值；存储型 DOM XSS | 已加 `safeNum()`/`safeColor()`：所有 data-value/data-x/data-y/data-weight/data-percent/坐标/总量走数值校验，轴文本 `escapeHtml`，颜色只允许 hex/rgb/hsl/var；新增伪造数值/颜色单测 |
| SEC-3（新，已修） | P2 | `services/knowledge-base-manager.ts:302-305/547-577`；`engine/knowledge-vector-store.ts:147/425-453` | 知识库索引 `book.id` 未校验，向量/删除路径可 `../` 穿越 | 已加 `isSafeBookId()`：加载索引时丢弃含 `/`、`\`、`..`、隐藏前缀、控制字符的 id；`deleteBook`/`removeVectorArtifacts`/`renameVectorArtifacts` 入口再拒绝；新增越界索引单测 |
| SEC-4（S-8） | P2 | `ui/agent-workbench-view.ts:1138-1193`；`engine/agent/dsh/dsh-launch.ts:55-89`；`ui/settings/agent-section.ts:118-126` | dsh workspace=整个 vault，未排除 `.obsidian`；Key 常驻子进程 env 且可能注入非 DeepSeek 提供的 Key | workspace 收窄到当前项目；排除 `.obsidian`/`.trash`/`_versions`；Key 仅 deepseek 且请求时注入（约 10 行） |
| SEC-5（S-9） | P2 | `engine/agent/harness/host-tools.ts:952` | 危险命令正则漏 `targeted-revision`/`generate-bases`/`complete-properties`/`migrate-*`；虽仍逐次审批，但缺少额外危险提示 | 改只读白名单，其余 run_command 一律确认/强提示（约 15 行） |
| SEC-6（S-10） | P2 | `services/canon-research-service.ts:349-407`；`shared/http-request.ts:105-123` | SSRF 只校验初始 URL，3xx 可跳内网；`isPrivateHost` 未覆盖 IPv6 ULA/link-local/mapped | 补 IPv6 私网段；手动跟随最多 3 跳，每跳校验 scheme+host（约 20 行） |
| SEC-7（S-11） | P2 | `ui/batch-import-modal.ts:1426-1452`；`ui/views/knowledge-base-modals.ts:163-169`；`services/knowledge-base-manager.ts:480-491` | 导入前无 `file.size` 限制，超 10MB 只 `log.warn` 且已全量读入 | 六入口共用 `assertFileSize()`，知识库改为拒绝（约 6 行） |
| SEC-8（S-12） | P2 | `ui/services/agent-port.ts:465-468/541-543/574-576/589-591` | Agent 对 `.sessions/` 全目录可读写删移，含跨项目会话 JSONL；非索引删除 fallback 忽略 `permanent` | 白名单收窄到 `.sessions/spill/agent/<当前项目>/`，拒绝 `.sessions/agent/**`；fallback 仅 permanent（约 15 行） |
| SEC-9（新） | P2 | `engine/agent/harness/host-tools.ts:750-797`；`ui/services/agent-port.ts:589-618`；`shared/project-catalog.ts:151-182` | `delete_project` 可删模式库根下任意子目录；`move_file` 可移动目录 | delete_project 仅 `listProjectIds()` 命中且恰好两段；move_file 拒绝非 TFile 源（约 8 行） |
| SEC-10（S-12 附带） | P2 | `ui/services/agent-port.ts:583-585` | 非索引文件删除无条件 `adapter.remove`，与「默认回收站」描述不符 | 仅 `permanent===true` 时 remove，否则拒绝并提示（约 5 行） |
| SEC-11（S-4 残余） | P3 | `engine/engine-registry.ts:1187-1195`；`services/backup-center-service.ts:39/106` | `data.json.bak` 直接复制含明文 Key 的 data.json；GitHub Token 行无内联明文提示 | 备份加密或至少告警；Token 行复用全局加密状态文案（约 10 行） |
| SEC-12（S-7） | P3 | `ui/polish-editor.ts:40-44/67-71` | 本地 escapeHtml 不转义双引号（当前实体名先转义再 match，暂不可利用） | 改用 `@/utils/helpers.escapeHtml`（防御性，约 3 行） |
| SEC-13（新） | P3 | `shared/file-path-guard.ts:43-70`；`shared/paths.ts:194-201` | 词法路径守卫未拒绝 NTFS ADS `:`、Windows 设备名、符号链接目录 | 段级拒绝 `:`/设备名；桌面端最终读写前 realpath 校验（约 15 行） |
| SEC-14（上轮遗留） | P3 | `ui/co-writing-view.ts:2096`、`ui/agent-workbench-view.ts:973`、`ui/rendering/context-panel.ts:730/803` | AI/导入 Markdown 中远程图片在预览时自动外连（IP/UA 泄露） | 渲染前过滤非 vault `img[src^=http]` 或降级为链接（约 15 行） |

## 三、已修复 / 已排除

| 项 | 证据 |
|---|---|
| S-1/S-2/S-5 | 两方复核确认修复：`kbBookSourceFile` 双段净化；`shouldAutoApproveNewFile` 先净化再 exists；审批摘要显示真实参数 |
| S-4（用户拍板 B） | 明文兜底 + `shared/secret-display` 统一风险文案 + 设置页无条件渲染；单测在位 |
| Agent 审批 fail-closed | 危险操作无确认端口/超时均拒绝；`approvalGranted` 由宿主注入；`run_command` 双重校验 |
| 动态代码执行 | `eval`/`new Function`/`document.write`/`insertAdjacentHTML`/`outerHTML=` 生产源码 0 命中 |
| 路径守卫核心 | 绝对路径/盘符/UNC/`..`/控制字符/隐藏目录拒绝；大小写变体仍被 `.` 隐藏检查拦截 |
| 名称/项目/导出路径 | `validateProjectName`、`newProjectPath`、`export-file`、EPUB `escapeXml` 均校验；封面扩展名白名单 |
| 主题预设注入 | `isHexColor` 白名单 + 体积上限，不能注入 `url()`/CSS |
| 回收站/确认 | 索引内 Agent 删除走 `vault.trash`；知识库/项目/封面/模板变更均有显式确认 |
| 剪贴板 | 仅 writeText；粘贴只取 text/plain 并插文本节点，无 clipboard.read/html |
| v4.80.0 后新代码 | 8 个提交未新增网络/密钥/权限入口；worker/模板/结算锁/回滚可见性不涉及新输入面 |
| 日志/诊断 | 无 Key/密文输出；诊断只输出 apiKeyConfigured 与 endpoint host |
| 十进制 IP SSRF 子项 | WHATWG URL 会归一化为 127.0.0.1，已被 `isPrivateHost` 拦截，不成立 |

## 四、待用户拍板

- 无。SEC-1 属明确越界读写，修复不需要产品取舍。

## 五、下一步

1. SEC-2/SEC-3/SEC-4 优先（XSS、知识库路径、dsh 写入面）。
2. SEC-5/SEC-8/SEC-9/SEC-10 可合并为「Agent 权限收口」批次。
3. SEC-6/SEC-7 独立小批次；SEC-11..SEC-14 进 P3 队列。
4. 下一审计维度：**④ 覆盖率与测试契约**（增量复核）。
