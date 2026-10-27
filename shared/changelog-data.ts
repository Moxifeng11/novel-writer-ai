/**
 * changelog-data.ts — 内置更新日志数据
 *
 * 包含最近几个版本的更新日志，用于在模态框中显示。
 * 格式：版本号 + 日期 + 分类（新增/优化/修复/破坏性变更）
 */

export interface ChangelogEntry {
    version: string;
    date: string;
    title: string;
    sections: {
        type: 'added' | 'improved' | 'fixed' | 'breaking';
        label: string;
        items: string[];
    }[];
}

export const BUILTIN_CHANGELOG: ChangelogEntry[] = [
    {
        version: '4.19.0',
        date: '2026-10-26',
        title: '长篇 / 短篇 / 剧本三模式创作体系',
        sections: [
            {
                type: 'added',
                label: '🚀 新增功能',
                items: [
                    '新建项目可选长篇小说 / 番茄短篇小说 / 红果短剧剧本',
                    '番茄短篇 24 个分类与性别频道；目标字数 5–10 万',
                    '红果短剧 12 类题材与分集规格；40–120 集、单集 60–120 秒',
                    '项目内自动生成创作模式指南；流水线与协同写作均追加模式硬约束',
                    '短篇按「节」、剧本按「集」建章与导出',
                ],
            },
            {
                type: 'improved',
                label: '✅ 优化改进',
                items: [
                    '项目卡片/概览显示创作模式与分类徽章',
                    '左侧新增长篇小说/短篇小说/剧本三个分类入口，列表与工具互不混入',
                    '短篇写入 短篇创作/、剧本写入 剧本创作/，新项目不再创建长篇 03-大纲与章节',
                    '短篇/剧本批量建节/集只写模式正文目录，并默认当前项目',
                    '短篇/剧本卡片使用前期调研、写作、全部节/集等专属操作',
                    '新增故事核、分节大纲、场景圣经、分集大纲、分镜表专属编辑入口',
                    '右侧快捷工具按项目类型自动切换',
                    'API 设置新增连通性测试，按端点/鉴权/模型/延迟分级告警',
                    '思考模式升级为极速/标准/深度/极限四级与 0–100% 拖拽强度',
                    '新增三类流程细化、短篇三步快速流程、剧本分镜场全流程设计文档',
                    '新增 domains/ 三域命名空间与 长篇小说/短篇小说/剧本 模式库',
                    '长篇工具与创建弹窗移除短篇/剧本逻辑；短篇剧本创建独立成域',
                    '新增 legacy 项目迁移服务与设置页项目库迁移入口',
                    '新增 Harness MVP：规则引擎、上下文聚合、结构化输出、单次调用 Runner、调用账本',
                    '长篇消痕/精修/定向修订改为一次逻辑调用完成',
                    '短篇/剧本前期调研新增 AI 热点调研与 3 个差异化候选方向',
                    '随机灵感升级为统一种子卡片，支持查看/复制/重置随机种子',
                    '固化番茄短篇/红果短剧创作框架，阶段与校验节点程序化',
                    '新增 CSPRNG 真随机四层因子，避免同质化并写入调研产物',
                    'Harness M1：PromptArtifact/ContextPack/RAG 引用/MemoryStore/ToolRegistry/三域 profile',
                    'AI 记忆默认 pending，确认后才进入 confirmed 与检索',
                    '长篇模式的模板、提示词、导出与章节命名保持原样',
                ],
            },
        ],
    },
    {
        version: '4.18.0',
        date: '2026-10-26',
        title: '同人考据 · 人工审核 · 快捷工具收口',
        sections: [
            {
                type: 'added',
                label: '🚀 新增功能',
                items: [
                    '同人考据：官方/官方 Wiki/参考资料/衍生来源分级；同人、改编、外传等默认排除',
                    '同人设定人工审核：生成草稿进入 _待审核，逐字段来源核对，通过后才可绑定项目',
                    '项目重命名：同步 .project、世界观 frontmatter、写作配置与插件偏好文件',
                    '全书简介多版本：悬念/爽点/人物/世界观四版，草稿自动保存，永不覆盖旧稿',
                    '同人模板持久化：项目内保留模板，丢失时自动恢复，可从模板新建待审核草稿',
                ],
            },
            {
                type: 'improved',
                label: '✅ 优化改进',
                items: [
                    '脑洞/黄金开篇改为真实项目创建，支持保存到当前项目',
                    '文笔蒸馏支持样本/项目章节/当前文件/书名四种来源，样本模式要求原文证据',
                    '设置页任务参数改为卡片网格，修复横向溢出与“多出全局思考模式”的视觉问题',
                ],
            },
            {
                type: 'fixed',
                label: '🐛 问题修复',
                items: [
                    '修复全书简介 delete 后 create 导致旧稿丢失',
                    '修复顶层项目重命名生成“旧名/新名”子目录',
                    'GitHub 仓库参数统一为 Moxifeng11/novel-writer-ai（master），新增私有仓库 Token 设置',
                    '修复更新缓存仍显示旧版本号；旧仓库名自动迁移并清理旧 404 缓存',
                    '世界观生成/AI 世界元素生成的自动重命名统一走 ProjectRenameService',
                    '覆盖写保护：世界观/跨卷快照/信息债/诊断报告改为 modify 优先，写盘失败不先删旧文件',
                    'AI 全书规划重新生成前备份旧分卷大纲；同人考据拒绝 file://、本机与内网 URL',
                    '指纹 embedding 显式设置优先，避免共享旧 provider 写入不一致的 modelId/维度',
                ],
            },
        ],
    },
    {
        version: '4.17.0',
        date: '2026-10-26',
        title: '单章一键编排 · 规划合并 · 协同批量化',
        sections: [
            {
                type: 'added',
                label: '🚀 新增功能',
                items: [
                    '一键完成本章：一次点击跑完剩余步骤，支持暂停/继续/取消/断点续跑',
                    '推荐模式：5 个规划步骤合并为 1 次 AI 调用，整章 8 → 4 次',
                    '本地协同候选/改写批量：3 个方向一次返回，失败自动回退',
                    '本地 AI 串行队列：建议/幽灵/守卫/验证不再抢 Ollama 单槽',
                ],
            },
            {
                type: 'improved',
                label: '✅ 优化改进',
                items: [
                    '情节蒸馏进入 V1/sceneExpand；质量控制问题进入分析报告',
                    '分析报告已有结构化指令时 0 次 AI，无指令时回退 AI',
                    '幽灵联想 1 个 hint、句末触发、8 秒间隔；插入/保存守卫节流',
                ],
            },
        ],
    },
    {
        version: '4.16.0',
        date: '2026-10-26',
        title: '场景卡 · 样章 · 世界快照 · 定向修订',
        sections: [
            {
                type: 'added',
                label: '🚀 新增功能',
                items: [
                    '场景卡新增 POV/时间/地点/入离场状态/转折/工艺备注等字段',
                    '正文样章 few-shot 与弱强写作对照库，按场景类型注入',
                    '每章世界状态快照；下一章 V1/V2 以硬约束注入',
                    '按质量维度定向修订，异常自动回滚',
                    '承诺账本与角色弧线表；分析报告支持 PROMISE_*/ARC 指令',
                ],
            },
            {
                type: 'improved',
                label: '✅ 优化改进',
                items: [
                    '正文 V1/V2、场景展开、逐场景正文注入工艺约束与负面清单',
                    '新增 npm run eval:quality 基准样章评估，无 fixture 自动跳过',
                ],
            },
        ],
    },
    {
        version: '4.15.0',
        date: '2026-10-26',
        title: '任务级参数 · 截断状态机 · 本地 Ollama 链路',
        sections: [
            {
                type: 'added',
                label: '🚀 新增功能',
                items: [
                    '任务级模型/输入/输出/思考参数，正文与规划不再共用全局上限',
                    'finishReason=length 截断状态机：半成品不标记完成，正文保留完整旧稿',
                    'URL 自动识别供应商，保留自定义供应商 sourceType/apiStyle',
                    '协同/知识库/指纹接入共享 embedding；本地 Ollama 参与协同与拆解',
                ],
            },
            {
                type: 'fixed',
                label: '🐛 问题修复',
                items: [
                    '修复“继续生成剩余”空 prompt 早退却计入成功',
                    '修复批量续跑读不到 v4 正文、分析报告模型名/预算错误',
                    '修复本地协同找不到 provider 时静默回退云端',
                ],
            },
        ],
    },
    {
        version: '4.14.0',
        date: '2026-10-26',
        title: '协同写作 Markdown 编辑器',
        sections: [
            {
                type: 'added',
                label: '🚀 新增功能',
                items: [
                    '协同写作中间编辑区改为 Markdown 文档编辑器',
                    '新增段落工具与一键小说排版',
                ],
            },
            {
                type: 'improved',
                label: '✅ 优化改进',
                items: [
                    '排版遵循小说格式要求，保留 frontmatter 与段落结构',
                ],
            },
        ],
    },
    {
        version: '4.13.0',
        date: '2026-10-26',
        title: 'CSS 治理与死代码清理',
        sections: [
            {
                type: 'improved',
                label: '✅ 优化改进',
                items: [
                    '全局内联样式 2,617 → 1,068，styles.css 体积与 !important 数量下降',
                    '清理死 CSS 与重复样式，建立 CSS 预算门禁',
                ],
            },
        ],
    },
    {
        version: '4.12.0',
        date: '2026-10-26',
        title: '章节流程与 UI 专项 · 缺陷审计收口',
        sections: [
            {
                type: 'added',
                label: '🚀 新增功能',
                items: [
                    '章节流程与快捷工具三层对齐，实体前端重设计',
                    '全章节选择、时间线/伏笔关联索引与关联看板',
                ],
            },
            {
                type: 'fixed',
                label: '🐛 问题修复',
                items: [
                    '修复步骤完成度误判、章节选择器失效、关联索引弹窗布局问题',
                    '完成缺陷审计 Phase 1–4 与 §5 五项收口',
                ],
            },
        ],
    },
    {
        version: '4.11.0',
        date: '2026-10-26',
        title: '插件技术审计与基础加固',
        sections: [
            {
                type: 'fixed',
                label: '🐛 问题修复',
                items: [
                    '安全/内存/UX/CSS 四批审计问题修复',
                    'F4 口令派生与导出/修订闭环基础加固',
                ],
            },
        ],
    },
    {
        version: '4.10.7',
        date: '2026-10-17',
        title: '长篇 E2E 测试 · 3 个 P0 核心流程修复',
        sections: [
            {
                type: 'fixed',
                label: '🐛 问题修复',
                items: [
                    '修复正文写错位：多章项目正文生成稳定写入错误章节文件（step-result-saver 在卷目录下按 frontmatter 模糊匹配）',
                    '修复后台窗口死锁：5 处 await requestAnimationFrame 在窗口后台永久挂起（改用 setTimeout 让出执行权）',
                    '修复世界观生成后静默重命名项目：现需用户确认，且同步更新 .project 内容',
                ],
            },
        ],
    },
    {
        version: '4.10.6',
        date: '2026-07-19',
        title: '死代码清理 · 算法最优解 · 渲染路径修复',
        sections: [
            {
                type: 'improved',
                label: '✅ 优化改进',
                items: [
                    '维度拆解并行化：引入信号量并发池（并发数 3），多维度分析同时进行，显著缩短拆解耗时',
                    '拆解结果缓存：基于 SHA-256 内容哈希缓存中间结果，相同内容免重复计算',
                    '相似度检索加速：findSimilarPairs 引入 LSH（16-bit 随机投影）预过滤，大规模实体去重更快',
                    'Prompt 模板三层缓存 + 知识检索合并多目标查询，减少重复开销',
                    '文件缓存改用最小堆淘汰（O(log n)），文件写入批量合并',
                    '失败实体批量补救机制，提升拆解成功率',
                    '全量替换 console 为统一 Logger（约 1170 处），日志可控可追踪',
                ],
            },
            {
                type: 'fixed',
                label: '🐛 问题修复',
                items: [
                    '修复节奏拆解字段映射错误：爽点分布、剧情阶段、结构匹配、主线切换等图表数据现可正确渲染',
                    '新增章节节奏按章聚合数据（chapterRhythm），多维评分图表恢复显示',
                    '移除知识详情弹窗 27 处硬编码假数据与 2 个 mock 生成方法，改为真实数据/空状态占位',
                    '清理无效的死渲染代码（keyEmotionPoints / rhythmSegments）',
                    '节奏标签页补充质量评分卡，结构/伏笔/商业/可读性标签页统一"基于全书 N 字"标注',
                    '修复 62 处类型错误，35 处 :any 收窄为具体类型，删除 6 个死文件与 13 个未引用导出',
                ],
            },
        ],
    },
    {
        version: '4.10.0',
        date: '2026-07-14',
        title: '全流程进度可视化系统',
        sections: [
            {
                type: 'added',
                label: '🚀 新增功能',
                items: [
                    'ProgressEmitter：统一进度状态管理与事件发射器，支持步骤管理、时间统计、取消操作',
                    'TimeEstimator：基于历史数据、文本字数和模型类型的精准时间估算引擎',
                    'ProgressBarComponent：响应式进度条组件，支持自定义高度和颜色',
                    'StepListComponent：分步进度展示，当前步骤高亮，支持状态图标',
                    'LoadingOverlayComponent：全屏加载遮罩，包含进度条、步骤列表和取消按钮',
                    'TaskCardComponent：任务卡片，显示名称、状态、进度、步骤和预估时间',
                    'OperationConfirmModal：通用操作确认弹窗，支持"不再提示"记忆功能',
                    'FloatingProgressBall：右下角悬浮进度球，环形进度+百分比，点击展开完整面板',
                    'StatusBarProgressIndicator：Obsidian 状态栏进度指示器，显示任务数或百分比',
                    'WorkerManager：Web Worker 池管理框架，支持任务队列、自动降级、取消操作',
                    'DeconstructionWorkerManager：拆解专属 Worker 管理器，6 个拆解器全部后台执行',
                    '多任务批量管理：复选框多选、批量取消、批量删除、状态筛选、全选/反选',
                    '知识库拆解进度增强：确认弹窗、分步进度、向量化心跳、实时进度条、预估时间',
                    '文笔风格蒸馏进度增强：确认弹窗、3步进度、取消支持、错误重试、按钮状态管理',
                    '协同写作进度增强：取消按钮、3步提示（检索知识库→分析上下文→生成建议）、失败重试、预估时间',
                ],
            },
            {
                type: 'improved',
                label: '✅ 优化改进',
                items: [
                    'UI 阻塞问题解决：拆解计算移至 Web Worker，主线程保持响应',
                    '消除黑盒操作：所有生成/分析操作均有进度展示和确认弹窗',
                    '进度更新节流：内置 100ms 节流，不超过 10 次/秒',
                    '自动降级机制：Worker 不可用时自动回退到主线程',
                    '时间估算区间：提供最快/最慢预估，动态修正',
                    '错误提示差异化：网络错误、API密钥错误、频率限制、超时等不同提示',
                ],
            },
            {
                type: 'breaking',
                label: '🏗️ 架构特性',
                items: [
                    '三层架构：核心层（ProgressEmitter/TimeEstimator）→ UI层（7个组件）→ Worker层（WorkerManager）',
                    '统一进度协议：ProgressState/ProgressStep/ProgressStatus 标准接口',
                    '完整文档体系：7份开发文档，包含接入指南、迁移指南、最佳实践',
                ],
            },
        ],
    },
    {
        version: '4.9.0',
        date: '2026-07-14',
        title: '知识库题材管理完善',
        sections: [
            {
                type: 'added',
                label: '🚀 新增功能',
                items: [
                    '新增题材功能：支持创建自定义题材，含基本信息、标签、技巧、子题材、权重配置',
                    '题材编辑功能：自定义题材可完整编辑，预设题材支持"另存为自定义"',
                    '题材删除功能：自定义题材可删除，删除时清理关联配置',
                    '题材导入导出：JSON格式导入导出，ID冲突时提供覆盖/跳过/重命名选项',
                    '新增10个预设题材：奇幻西方、体育竞技、二次元、灵异鬼怪、现代耽美、古代耽美、萌宝甜宠、职场婚恋、轻小说、恐怖惊悚',
                ],
            },
            {
                type: 'improved',
                label: '✅ 优化改进',
                items: [
                    'WebnovelKnowledgeBase 增强：新增自定义题材内存管理，查询方法自动合并',
                    'KnowledgeBaseConfigManager 增强：支持完整GenreConfig结构持久化，旧版格式向后兼容',
                ],
            },
        ],
    },
    {
        version: '4.8.0',
        date: '2026-07-13',
        title: 'UI 选项卡架构重构与设计优化',
        sections: [
            {
                type: 'added',
                label: '🚀 新增功能',
                items: [
                    '新建项目模态框 UI 重设计：语义化 HTML + 270 行新 CSS',
                    '项目类型切换器：并排按钮设计，选中态强调色背景',
                    '题材标签：胶囊形状，选中态强调色填充，hover 上浮效果',
                ],
            },
            {
                type: 'improved',
                label: '✅ 优化改进',
                items: [
                    '工作台选项卡：移除内联样式，CSS 类名统一，修复类名不匹配',
                    '选项卡四种视觉状态：normal/hover/active/selector，0.15s 平滑过渡',
                    '设置页面选项卡：统一原生设置页与迷你设置模态框样式',
                    '项目选择器：移除多余的新建项目大卡片',
                ],
            },
            {
                type: 'fixed',
                label: '🐛 Bug 修复',
                items: [
                    '选项卡点击无反应：内联样式覆盖 CSS 类导致 active 状态失效',
                    'activateTab 重复点击不刷新：相同 tabId 直接 return 未重新渲染',
                    '向导按钮无响应：由 activateTab 问题导致',
                ],
            },
        ],
    },
    {
        version: '4.7.1',
        date: '2026-07-13',
        title: '偏离检测引擎',
        sections: [
            {
                type: 'added',
                label: '🚀 新增功能',
                items: [
                    '偏离检测引擎：5 类检测（剧情偏离/人物 OOC/前后矛盾/伏笔遗忘/节奏偏离）',
                    '3 级预警系统：info/warning/critical，阈值可配置',
                    '增量检测 + AbortSignal 取消 + 结果缓存',
                    '伏笔追踪：支持上下文提供或 frontmatter 自动解析',
                ],
            },
            {
                type: 'improved',
                label: '📊 测试覆盖',
                items: [
                    '新增 67 个单元测试，V1 引擎零回归',
                ],
            },
        ],
    },
    {
        version: '4.7.0',
        date: '2026-07-13',
        title: '六维质量评分引擎 + 上下文增量更新',
        sections: [
            {
                type: 'added',
                label: '🚀 新增功能',
                items: [
                    '六维质量评分引擎：可读性/节奏/情绪/人物一致性/情节连贯/语言质感',
                    '上下文增量更新：变更检测 + 增量更新器，50% 阈值回退全量',
                    '写作指纹 V2 Task 1：12 维数据结构 + V1→V2 迁移工具',
                    '写作指纹 V2 Task 2：StyleDeconstructor 升级到 12 维',
                ],
            },
            {
                type: 'improved',
                label: '📊 测试覆盖',
                items: [
                    '新增 216 个单元测试（质量评分 51 + 上下文增量 62 + 指纹迁移 50 + 拆解器 53）',
                ],
            },
        ],
    },
    {
        version: '4.6.0',
        date: '2026-07-12',
        title: '版本管理与更新提示',
        sections: [
            {
                type: 'added',
                label: '🚀 新增功能',
                items: [
                    '版本管理服务：支持从 GitHub Releases 或自定义服务器检查更新',
                    '更新提示 UI：设置页新增「关于」标签页，显示版本信息',
                    '更新提示条：有新版本时在设置页顶部显示，支持查看详情和稍后提醒',
                    '内置更新日志：最近 5 个版本的详细记录，支持模态框查看',
                    '首次安装欢迎引导：插件介绍、快速开始指南、基础设置引导',
                    '版本升级引导：大版本更新时自动显示更新内容',
                    '数据迁移备份：版本升级时自动备份旧版本设置',
                ],
            },
            {
                type: 'improved',
                label: '✅ 质量保证',
                items: [
                    'TypeScript 编译：0 新增错误',
                    'esbuild 构建：成功',
                    '外科手术式改动，不影响现有功能',
                    '所有新功能均可通过设置开关控制',
                ],
            },
        ],
    },
    {
        version: '4.5.1',
        date: '2026-06-29',
        title: '全流程测试 Bug 修复',
        sections: [
            {
                type: 'fixed',
                label: '🐛 Bug 修复',
                items: [
                    '修复 FullWriterView 多实例共存导致 tabContent undefined 崩溃',
                    '修复协同写作正文路径错误，章节结算/上下文采集失效问题',
                    '修复 saveBody 丢失 frontmatter 导致实体状态无法写回',
                    '修复 WizardStepExecutors 构造函数时 tabContent 未初始化',
                    '修复前置规划检查误报，改用第N章前缀规范',
                    '修复 updateProgress null 检查缺失导致崩溃',
                ],
            },
            {
                type: 'improved',
                label: '✅ 验证',
                items: [
                    'TypeScript 编译：0 错误',
                    'esbuild 构建：0 错误',
                    '全流程 UI 测试通过（项目创建→世界观→设定库→实体→大纲→建章→协同写作→章节结算）',
                ],
            },
        ],
    },
];

/**
 * 获取版本摘要（用于更新提示条）
 * 返回该版本前 2-3 条主要更新内容
 */
export function getVersionSummary(version: string): string[] {
    const entry = BUILTIN_CHANGELOG.find(e => e.version === version);
    if (!entry) return [];
    const items: string[] = [];
    for (const section of entry.sections) {
        for (const item of section.items) {
            if (items.length >= 3) return items;
            items.push(item);
        }
    }
    return items;
}
