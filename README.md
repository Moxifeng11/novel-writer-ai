# 小说工坊 AI（Novel Writer AI）

> 全流程 AI 长篇小说创作系统 —— 在 Obsidian 内完成从构思、大纲、设定管理到正文生成与质量复盘的全链路。

**当前版本**：4.43.0 · **最低 Obsidian**：1.4.0 · **平台**：桌面端 / 移动端（界面仅中文；系统级文件保护仅桌面端）

---

## 目录

- [核心能力](#核心能力)
- [安装](#安装)
- [快速开始](#快速开始)
- [AI 模型配置](#ai-模型配置)
- [命令一览](#命令一览)
- [数据与安全](#数据与安全)
- [常见问题（FAQ）](#常见问题faq)
- [开发](#开发)
- [文档索引](#文档索引)
- [兼容性与版本](#兼容性与版本)

---

## 核心能力

### 📖 完整写作工作台
以「项目 → 卷 → 章」组织长篇结构，每章按固定步骤推进（梗概、细纲、场景、情绪规划、角色灵魂、质量控制等），步骤结果落盘为可编辑的 Markdown 文件，正文单独成文件。断点可续、过程可追溯。

### ✍️ 句级协同写作
在段落/句子粒度与 AI 协作：生成候选、局部改写、状态变化确认。中间编辑区是 Markdown 文档编辑器，提供加粗/标题/引用等工具、段落缩进/合并/拆分，以及按项目写作规则统一分段与首行缩进的「一键小说排版」。支持本地模型优先，降低远程调用成本。

### 📚 知识库与拆解
- 导入参考书籍，按多维度拆解（结构、节奏、风格、人物、商业性、可读性等）。
- 文笔风格蒸馏与写作指纹库：从样本中提取可复用的风格特征。
- 实体管理：人物 / 地点 / 势力 / 物品 / 世界观统一维护，支持 AI 批量生成与一致性校验。

### 📊 质量控制
章节质量仪表盘提供六维评分、问题定位与事实确认；问题清单可直接跳转到正文行号，选中文本可生成改写建议并一键替换；协同写作视图可开启实时质量提示。另有一致性检查、伏笔管理、节奏与情感曲线等辅助视图。

### 📦 成稿导出
将整本书按卷/章顺序编译为 Markdown、纯文本或 HTML 稿件；HTML 带打印样式，可在浏览器中直接打印为 PDF。

### 🔌 多模型接入
内置多家云端提供商预设，支持任意 OpenAI 兼容端点与本地 Ollama；可为不同任务分别指定模型。

### 🔐 数据安全
API 密钥支持口令派生加密（PBKDF2-SHA256 + AES-GCM），密文与业务数据全部留在本地 vault。

---

## 安装

### 方式一：从 Release 安装（推荐）

1. 打开 [Releases](https://github.com/Moxifeng11/novel-writer-ai/releases) 页面，下载最新版本的 `novel-writer-ai-<版本>.zip`。
2. 在 vault 中创建目录：`<你的 vault>/.obsidian/plugins/novel-writer-ai/`。
3. 将 zip 解压到该目录，确保 `main.js`、`manifest.json`、`styles.css` 与 `workers/` 位于同一层。
4. 重启 Obsidian，在「设置 → 第三方插件」中启用 **小说工坊 AI**。

> Release 同时提供三个核心文件与 `workers/*.js`。若手动逐个下载，请把 Worker 文件放入 `workers/` 子目录，否则拆解等任务会降级到主线程并提示原因。
> 首次启用时，插件会自动在 vault 根目录初始化「元文件」模板目录（含空白模板与提示词填写说明），无需手动准备模板。

### 方式二：从源码构建

```bash
git clone https://github.com/Moxifeng11/novel-writer-ai.git
cd novel-writer-ai
npm install
npm run build          # 产出 main.js（版本号自动同步到 manifest.json）
```

将仓库目录整体放入 `<vault>/.obsidian/plugins/novel-writer-ai/` 后启用插件。

> 升级覆盖前建议备份 `data.json`。

---

## 快速开始

1. **配置模型**：设置 → 小说工坊 AI → 选择提供商并填写 API Key / Endpoint / 模型名。
2. **新建项目**：命令面板执行「新建项目」，填写书名、题材与基本信息。
3. **生成规划**：使用「AI全书规划」产出卷纲与章纲，或手动导入大纲。
4. **开始写作**：打开「完整写作工作台」，按章节逐步执行写作步骤；需要逐句打磨时切到「句级协同写作」。
5. **质量复盘**：写作过程中随时打开「质量仪表盘」查看六维评分与问题清单。

> 想先看流程而不想配置模型？执行命令「导入示例项目」，会生成含 1 卷 3 章、1 个人物、1 条伏笔的示例项目并打开工作台。示例内容完全静态，可自由修改或删除。

---

## AI 模型配置

### 内置提供商预设

| 提供商 | 类型 | 默认端点 |
|---|---|---|
| 火山引擎豆包 | 云端 | `ark.cn-beijing.volces.com/api/v3` |
| DeepSeek 官网 | 云端 | `api.deepseek.com/v1` |
| 日日新 / SenseNova | 云端 | `token.sensenova.cn/v1` |
| CatCat Gemini | 云端 | `api.catcat.top/v1` |
| 本地 Ollama | 本地 | `localhost:11434` |

### 自定义提供商

任何兼容 OpenAI Chat Completions 协议的服务都可接入：在设置中新增自定义提供商，填写 `endpoint`、`apiKey` 与模型列表即可，支持为单个端点覆盖默认模型。

### 本地模型

选择「本地 Ollama」时无需 API Key；插件会自动识别本地端点并跳过密钥校验。推荐模型：`qwen2.5:7b`、`deepseek-r1:7b`；向量检索默认使用 `bge-m3`。

### 令牌安全

- 首次保存密钥时会提示设置**口令**（≥6 位）。
- 密钥以 `aes256v2:` 格式加密：口令 + PBKDF2-SHA256（210,000 次迭代）+ 每条密文独立随机 salt。
- 口令仅存于当前会话内存，**不写入任何文件**。请自行妥善保管；口令丢失需重新设置并重新填写全部密钥。
- 旧版 `aes256v1` 密文永久兼容读取。

---

## 命令一览

命令面板中搜索「小说工坊」或按分组查找：

| 分组 | 命令 |
|---|---|
| 项目管理 | 新建项目 / 导入示例项目 / 重命名项目 / AI全书规划 / 全书简介 / 批量建章 / 重建章节 / 备份元文件 / 保护元文件 / 叙事总览 |
| 写作辅助 | 质量仪表盘 / 章节结算 / 连贯性审查 / 续写规划 / 段落扩写 / 智能大纲扩写 / AI 改写建议 / 跨卷状态继承 |
| 知识库 | 打开知识库管理界面 / 实体管理 / 统一生成实体 / 世界观 / 人物 / 势力 / 地点 / 物品 / 元素提取 / 角色识别审核 / 写作指纹库 / 文笔风格蒸馏 / 上下文注入 |
| 工具 | 流程诊断 / 番茄榜单分析 / 批量拆解 / 步骤结果查看 / 脑洞构思工坊 / 黄金开篇工坊 / 成稿导出 |
| 视图 | 完整写作工作台 / 句级协同写作工作台 |
| 版本管理 | 版本历史与回滚 / 保存当前版本 |

---

## 数据与安全

### 数据存放位置

| 数据 | 位置 |
|---|---|
| 插件设置、加密密钥、模型配置 | `<vault>/.obsidian/plugins/novel-writer-ai/data.json` |
| 项目内容（大纲、正文、设定、步骤结果） | `<vault>/<项目名>/` 下的 Markdown 文件 |
| 模板骨架 | `<vault>/元文件/`（首次启用或新建项目时自动生成） |
| 分析会话快照 | `<vault>/.obsidian/plugins/novel-writer-ai/.sessions/` |
| 章节版本历史 | 项目目录下的版本子目录（由版本管理命令维护） |

项目内容全部是普通 Markdown，可直接用任意编辑器查看、用 Git 或第三方同步工具备份。

### 上传边界

除调用你自己配置的 AI 接口外，插件不上传任何数据到第三方服务器。路径安全：AI 生成的实体名会经过统一净化，无法写出 vault 目录。

实体保存走统一落盘层：四类实体（人物/势力/地点/物品）都会补齐 frontmatter；保存时遇到同名但内容不同的实体不会覆盖，而是另存为「名称（2）」，便于区分同名分身等设定。

### 卸载与数据保留

- 停用或删除插件**不会**删除项目目录与 `元文件`，正文与设定仍在 vault 中。
- 删除 `data.json` 会丢失插件设置与已保存的加密密钥（密钥本身无法在无口令时解密）。
- 如需彻底清除插件痕迹：先备份项目目录，再删除 `.obsidian/plugins/novel-writer-ai/`。

### 文笔风格预设

- **内置位置**：`<vault>/元文件/00-系统模板/文笔风格预设/`，内置 10 套细分风格（强者语、传统网文、细腻言情、冷峻悬疑、轻松幽默、宏大堂皇、古风武侠、沙雕轻小说、末世废土、克苏鲁悬疑）。
- **使用方式**：工作台「文笔风格」步骤 → 顶部「文笔风格预设」下拉选择 → 点「应用预设」，各分节文本框与参考样本会自动填充，可继续修改后保存。
- **新增预设（不限于内置 10 套）**：点「➕ 新增预设」→ 填预设名称（可选描述）→ 点「🪄 AI 生成内容」，AI 会按 9 个一级分节 + 3 个子节 + 参考样本生成并填入下方表单；可继续修改，再点「💾 保存为新预设」写入预设目录，或直接保存应用到当前项目。同名预设不会覆盖，新预设有独立序号。
- **自定义扩展**：在该目录新增 `.md` 文件即可，frontmatter 写 `name` / `order` / `description`，正文按 `## 零、参考样本` 与 `## 一` ~ `## 九` 组织；重新打开模态后自动出现在下拉列表。
- 应用预设只填充表单，需点击保存才会写入 `项目/01-世界架构/文笔风格.md`。

### 快捷工具

- **项目与章节页常驻**：左侧项目卡片，右侧为项目概览 + 项目快捷操作 + 全部分类工具（6 组 37 项），无需打开弹窗。进入项目页默认选中第一个项目，右侧立即可用。
- **章节页**：标题栏下方常驻高频工具条（连贯性审查 / 章节结算 / 步骤结果 / 批量建章 / 生成人物 / 实体管理 / 文笔蒸馏 / 上下文注入 / 成稿导出）。
- **新建项目**：支持「🎲 AI 随机构思」一次生成书名、题材与简介。
- **同人设定**：项目面板「同人设定」会把设定直接写入 `项目/05-同人设定库/` 并绑定到 `.project`，向导的同人步骤即可识别。

---

## 常见问题（FAQ）

### 1. 模型连接失败 / 一直转圈

- 检查设置中的 Endpoint 是否包含完整协议与路径（云端通常以 `/v1` 或 `/api/v3` 结尾）。
- 确认 API Key 已保存且口令输入正确；口令仅存于当前会话，重启后需要重新输入。
- 本地 Ollama 需先启动服务，并确认模型名与 `ollama list` 一致。
- 使用「流程诊断」查看最近的请求错误分类（配置 / 网络 / HTTP / 解析）与降级记录；需要反馈时点击「导出诊断包」，文件会写入 vault 根目录 `导出文件/`。

### 2. 提示模板缺失

首次启用或新建项目时，插件会自动在 vault 根目录生成 `元文件/00-系统模板/`。若提示缺失：

1. 确认 vault 根目录存在 `元文件` 文件夹，且当前账号有写入权限。
2. 重新执行一次「新建项目」，或手动从 Release 压缩包中的模板资源恢复。
3. 模板缺失时插件会回落到内置默认模板，并在控制台只提示一次，不影响继续写作。

### 3. 提示 Worker 降级 / 拆解变慢

插件把拆解、质量、风格等重任务放入 `workers/` 子目录的后台线程。若该目录缺失，任务会降级到主线程并给出提示。请确认安装目录同时包含 `main.js`、`manifest.json`、`styles.css` 与 `workers/`，或重新解压 Release 压缩包。

### 4. 忘记了密钥口令

口令不写入任何文件，无法找回。请在设置中重置密钥并重新填写各提供商的 API Key；旧版 `aes256v1` 密文仍可兼容读取，但也需要对应口令。

### 5. 移动端能用吗？

可以打开项目、编辑 Markdown 与执行大部分 AI 流程。但「保护元文件」依赖 Windows 文件属性或 macOS/Linux 权限位，移动端会明确提示不支持；移动端也没有本地 Worker 文件系统能力，重任务可能降级到主线程。

### 6. 旧版写作命令为什么看不到了？

旧版正文生成命令（AI写正文〔旧〕、后台AI写正文〔旧〕、批量写正文〔旧〕、自动写作器〔旧〕）已从公开命令面板收敛，正文统一走「完整写作工作台」与「句级协同写作」。这些命令保留至 **v5.0.0**，仍可通过内部命令路由调用，并会显示弃用提示。

---

## 开发

```bash
npm ci                  # 严格按 lockfile 安装
npm run dev             # watch 构建（含前置生成）
npm run build           # 生产构建（版本同步 + 模板 + CSS + esbuild）
npm run preflight       # 本地总门禁（含 build 与 check:release）
npm run preflight:release # 发布前：preflight + 覆盖率
npm run gen:docs        # 生成 docs/generated/*
npm run check:docs      # 文档索引/链接/版本/编码
npm run check:jsdoc     # 注释覆盖率（棘轮）
npm run lint            # eslint（官方 obsidianmd 规则集）
npm run typecheck       # tsc --noEmit
npm test                # vitest 全量
npm run test:cov        # 覆盖率门禁
npm run test:e2e        # Playwright（Electron 真实链路，需 OBSIDIAN_PATH）
npm run check:deps -- --baseline .arch-baseline.json  # 分层/循环依赖
npm run audit:deps      # 生产依赖安全审计
```

E2E 需要本机安装 Obsidian，并设置 `OBSIDIAN_PATH` 指向可执行文件；未设置时用例会明确跳过。详见 [tests/e2e/README.md](tests/e2e/README.md)。

提交前只需一条命令：

```bash
npm run preflight
```

它串联类型、Lint、全量测试、模板/样式/CSS/内联/分层/引擎/台账/权威源/静默失败/热路径/联动/隔离、JSDoc、文档与生成物漂移、构建与发布资产校验。完整门禁表见 [docs/generated/gates.md](docs/generated/gates.md)，流程见 [docs/handbook/06-gates-and-release.md](docs/handbook/06-gates-and-release.md)。

CI 与发布流水线见 `.github/workflows/`：PR 执行全量门禁；推送 `v*` tag 自动创建 GitHub Release。

### 目录结构

```
core/           插件入口依赖：命令注册、设置、主题、密钥服务
engine/         引擎层：生成、拆解、质量、风格、仓储
ui/             视图与弹窗（含 full-writer / cowrite 控制器）
services/       调度、Worker、知识库、版本等基础设施
shared/         跨层工具：路径、导出、设置迁移、类型
assets/         内置模板资源（构建时嵌入 main.js）
workers/        Web Worker 产物（拆解 / 质量 / 风格）
tests/          单元、集成与 E2E 测试
docs/           架构、API、开发、性能文档与版本发布说明
styles.css      插件样式（nw- 命名空间 + token 变量）
```

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [docs/README.md](docs/README.md) | **开发文档总索引**（手册、ADR、术语、真相源） |
| [docs/handbook/00-onboarding.md](docs/handbook/00-onboarding.md) | 新人上手指南 |
| [docs/handbook/01-environment.md](docs/handbook/01-environment.md) | 环境搭建与开发循环 |
| [docs/handbook/03-module-development.md](docs/handbook/03-module-development.md) | 新增模块检查表 |
| [docs/handbook/06-gates-and-release.md](docs/handbook/06-gates-and-release.md) | 门禁、发布与回滚 |
| [docs/handbook/07-runbook.md](docs/handbook/07-runbook.md) | 故障排查手册 |
| [docs/handbook/09-comment-standard.md](docs/handbook/09-comment-standard.md) | 注释/JSDoc 规范 |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | 分层架构、引擎注册表、数据流 |
| [API.md](docs/API.md) | 内部接口与模块契约 |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | 开发规范与调试流程 |
| [CODE-INDEX.md](docs/CODE-INDEX.md) | 文件与模块索引（清单见生成物） |
| [PERFORMANCE.md](docs/PERFORMANCE.md) | 性能基线与优化记录 |
| [CHANGELOG.md](CHANGELOG.md) | 完整变更历史 |
| [v4.43.0 发布说明](docs/releases/v4.43.0.md) | 当前版本发布说明（历史版本见 CHANGELOG） |
| [v4.17.0 效率审计](docs/analysis/v4.17-pipeline-efficiency.html) | 11 步调用流、点击账单、协同写作调用审计（交互式 HTML） |
| [v4.18 快捷工具健康度](docs/audits/v4.18-quick-tools-health.md) | 工具可用性、假项目/丢稿修复与待审计清单 |
| [v4.18.0 验证报告](docs/audits/v4.18.0-verification-report.md) | 版本一致性、功能验证、高危问题与修改清单 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献流程与自检命令 |
| [SECURITY.md](SECURITY.md) | 安全问题的非公开报告渠道 |

---

## 兼容性与版本

- Obsidian **1.4.0+**（桌面端与移动端）。
- **界面语言**：目前仅提供简体中文界面，未接入 i18n 层；如需其他语言需先抽离文案 key，暂不在当前版本计划内。
- **平台差异**：
  - 桌面端：完整功能，包括 Worker 后台线程与「保护元文件」系统级保护。
  - 移动端：可读写项目与执行大部分 AI 流程；Worker 缺失时自动降级到主线程，「保护元文件」明确不支持。
  - 系统级文件保护按平台分支实现：Windows 使用文件属性，macOS / Linux 使用权限位。
- 旧项目数据、旧版报告与既有设置键名保持向后兼容。
- 旧版正文生成命令保留至 **v5.0.0**，之后移除；当前仅从公开命令面板收敛并给出弃用提示。
- 版本号遵循语义化版本：`manifest.json` 与 `package.json` 由 `scripts/sync-version.js` 保持同步。
- 变更记录见 [CHANGELOG.md](CHANGELOG.md)，最新发布说明见 [v4.23.4](docs/releases/v4.23.4.md)。

---

## 作者与许可

**南柯一梦** · 反馈与问题请提交 [Issues](https://github.com/Moxifeng11/novel-writer-ai/issues)。

本项目采用 [MIT License](LICENSE)。安全类问题请勿提交公开 Issue，按 [SECURITY.md](SECURITY.md) 的非公开渠道报告。
