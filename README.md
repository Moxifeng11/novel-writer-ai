# 小说工坊 AI（Novel Writer AI）

> 全流程 AI 长篇小说创作系统 —— 在 Obsidian 内完成从构思、大纲、设定管理到正文生成与质量复盘的全链路。

**当前版本**：4.11.0 · **最低 Obsidian**：1.5.0 · **平台**：桌面端 / 移动端

---

## 目录

- [核心能力](#核心能力)
- [安装](#安装)
- [快速开始](#快速开始)
- [AI 模型配置](#ai-模型配置)
- [命令一览](#命令一览)
- [数据与安全](#数据与安全)
- [开发](#开发)
- [文档索引](#文档索引)
- [兼容性与版本](#兼容性与版本)

---

## 核心能力

### 📖 完整写作工作台
以「项目 → 卷 → 章」组织长篇结构，每章按固定步骤推进（梗概、细纲、场景、情绪规划、角色灵魂、质量控制等），步骤结果落盘为可编辑的 Markdown 文件，正文单独成文件。断点可续、过程可追溯。

### ✍️ 句级协同写作
在段落/句子粒度与 AI 协作：生成候选、局部改写、并行建议、状态变化确认。支持本地模型优先，降低远程调用成本。

### 📚 知识库与拆解
- 导入参考书籍，按多维度拆解（结构、节奏、风格、人物、商业性、可读性等）。
- 文笔风格蒸馏与写作指纹库：从样本中提取可复用的风格特征。
- 实体管理：人物 / 地点 / 势力 / 物品 / 世界观统一维护，支持 AI 批量生成与一致性校验。

### 📊 质量控制
章节质量仪表盘提供六维评分、问题定位与事实确认；另有一致性检查、伏笔管理、节奏与情感曲线等辅助视图。

### 🔌 多模型接入
内置多家云端提供商预设，支持任意 OpenAI 兼容端点与本地 Ollama；可为不同任务分别指定模型。

### 🔐 数据安全
API 密钥支持口令派生加密（PBKDF2-SHA256 + AES-GCM），密文与业务数据全部留在本地 vault。

---

## 安装

### 方式一：从 Release 安装（推荐）

1. 打开 [Releases](https://github.com/Moxifeng11/novel-writer-ai/releases) 页面，下载最新版本的三个文件：
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. 在 vault 中创建目录：`<你的 vault>/.obsidian/plugins/novel-writer-ai/`
3. 将三个文件放入该目录。
4. 重启 Obsidian，在「设置 → 第三方插件」中启用 **小说工坊 AI**。

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
| 项目管理 | 新建项目 / 重命名项目 / AI全书规划 / 全书简介 / 批量建章 / 重建章节 / 备份元文件 / 保护元文件 / 叙事总览 |
| 写作辅助 | 质量仪表盘 / 章节结算 / 连贯性审查 / 续写规划 / 段落扩写 / 智能大纲扩写 / 跨卷状态继承 |
| 知识库 | 打开知识库管理界面 / 实体管理 / 统一生成实体 / 世界观 / 人物 / 势力 / 地点 / 物品 / 元素提取 / 写作指纹库 / 文笔风格蒸馏 / 上下文注入 |
| 工具 | 流程诊断 / 番茄榜单分析 / 批量拆解 / 步骤结果查看 / 脑洞构思工坊 / 黄金开篇工坊 |
| 视图 | 完整写作工作台 / 句级协同写作工作台 |
| 版本管理 | 版本历史与回滚 / 保存当前版本 |

---

## 数据与安全

- **设置与密钥**：存于 `<vault>/.obsidian/plugins/novel-writer-ai/data.json`。
- **项目数据**：以 Markdown 文件形式写入 vault 内对应项目目录，可用任意编辑器查看与版本管理。
- **上传边界**：除调用你自己配置的 AI 接口外，插件不上传任何数据到第三方服务器。
- **路径安全**：AI 生成的实体名会经过统一净化，无法写出 vault 目录。

---

## 开发

```bash
npm install

npm run dev         # watch 构建
npm run build       # 生产构建（同步版本号）
npm run lint        # eslint（官方 obsidianmd 规则集）
npm run typecheck   # tsc --noEmit
npm test            # vitest 全量
npm run test:cov    # 覆盖率
npm run test:e2e    # Playwright
```

提交前请确保以下 Gate 全绿：

```
lint 0 error / 0 warning → typecheck 0 error → vitest 全绿 → build 成功
```

### 目录结构

```
core/           插件入口依赖：命令注册、设置、主题、密钥服务
engine/         引擎层：生成、拆解、质量、风格、仓储
ui/             视图与弹窗（含 full-writer / cowrite 控制器）
services/       调度、Worker、知识库、版本等基础设施
shared/         跨层工具：路径、导出、设置迁移、类型
workers/        Web Worker 产物（拆解 / 质量 / 风格）
tests/          单元、集成与 E2E 测试
docs/           架构、API、开发、性能文档与版本发布说明
styles.css      插件样式（nw- 命名空间 + token 变量）
```

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | 分层架构、引擎注册表、数据流 |
| [API.md](docs/API.md) | 内部接口与模块契约 |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | 开发规范与调试流程 |
| [CODE-INDEX.md](docs/CODE-INDEX.md) | 文件与模块索引 |
| [PERFORMANCE.md](docs/PERFORMANCE.md) | 性能基线与优化记录 |
| [CHANGELOG.md](CHANGELOG.md) | 完整变更历史 |
| [Releases](docs/releases/) | 各版本发布说明 |

---

## 兼容性与版本

- Obsidian **1.5.0+**（桌面端与移动端）。
- 旧项目数据、旧版报告与既有设置键名保持向后兼容。
- 版本号遵循语义化版本：`manifest.json` 与 `package.json` 由 `scripts/sync-version.js` 保持同步。
- 变更记录见 [CHANGELOG.md](CHANGELOG.md)，最新发布说明见 [v4.11.0](docs/releases/v4.11.0.md)。

---

## 作者

**南柯一梦** · 反馈与问题请提交 [Issues](https://github.com/Moxifeng11/novel-writer-ai/issues)。

> 本仓库为私有项目，未附带开源许可证文件；如需引用或分发请先联系作者。
