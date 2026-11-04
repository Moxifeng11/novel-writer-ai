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

/**
 * BUILTIN_CHANGELOG 常量。
 */
export const BUILTIN_CHANGELOG: ChangelogEntry[] = [
    {
        version: '4.29.0',
        date: '2026-11-05',
        title: '短篇/剧本闭环：AI 文档、质检、结算与平台包',
        sections: [
            {
                type: 'added',
                label: '🧩 模式上下文',
                items: [
                    'ModeRuntime 统一故事核/场景圣经/大纲/分镜/调研/实体/文笔风格',
                    '故事核、大纲、场景圣经、分镜表支持 AI 生成；短篇开篇三屏约束',
                ],
            },
            {
                type: 'added',
                label: '🧪 质检与结算',
                items: [
                    '短篇六维质检 / 剧本可拍质检，报告与 frontmatter 落盘',
                    '单元轻量结算：实体出场确认 + status=settled + 结算记录',
                ],
            },
            {
                type: 'improved',
                label: '📦 导出',
                items: [
                    '番茄短篇/红果短剧平台包：简介、标签、字数、文件名前缀',
                    '敏感词预检；TXT/Markdown 平台头，EPUB/DOCX 元数据',
                ],
            },
        ],
    },
    {
        version: '4.28.0',
        date: '2026-11-04',
        title: '统一创作主页、任务中心与首启向导',
        sections: [
            {
                type: 'added',
                label: '🏠 入口',
                items: [
                    '创作主页：三模式卡片、最近项目、下一步建议',
                    '主 Ribbon 收敛为 主页/任务中心/Agent/项目速览，其余命令保留深链',
                ],
            },
            {
                type: 'added',
                label: '🧵 任务中心',
                items: [
                    'JobService 统一任务状态、进度、取消、重试',
                    '批量生成、章节一键完成、导出、批量拆解接入',
                ],
            },
            {
                type: 'added',
                label: '🚀 引导与体检',
                items: [
                    '首启向导：提供商 → Key → 连通性 → 示例项目',
                    '项目体检：重复正文/未结算/frontmatter/孤儿文件',
                ],
            },
        ],
    },
    {
        version: '4.27.1',
        date: '2026-11-04',
        title: '可信门禁、Agent 写入确认与密钥迁移',
        sections: [
            {
                type: 'fixed',
                label: '🚦 门禁',
                items: [
                    'ESLint flat config 修复，no-unused-vars / no-explicit-any 等规则真实生效',
                    '新增 check:write-entry：用户可见 Markdown 禁止裸 adapter 写入',
                ],
            },
            {
                type: 'fixed',
                label: '🔐 安全',
                items: [
                    'Agent 覆盖已有文件默认需要确认；设置页可显式放行',
                    'dsh 固定 0.2.1-rc.5；Key 解密后再注入子进程',
                ],
            },
            {
                type: 'fixed',
                label: '💾 数据',
                items: [
                    'v1 密文在有口令时自动升级 v2；设置迁移前写 data.json.bak',
                    '修正短篇/剧本正文根目录与路径识别',
                    '拆解报告/审核记录/模板复制改走 writeVaultText',
                ],
            },
        ],
    },
    {
        version: '4.27.0',
        date: '2026-11-04',
        title: '全流程阻塞修复与数据可靠性加固',
        sections: [
            {
                type: 'fixed',
                label: '🚦 稳定性',
                items: [
                    '步骤双击、保存/切章超时、批量步级看门狗、暂停自动恢复',
                    '导出异常提示与并发读盘；流式槽位感知取消',
                ],
            },
            {
                type: 'fixed',
                label: '🔐 数据',
                items: [
                    'frontmatter 直写收编到自愈入口；协同不再把整章正文写进 data.json',
                    '指纹库项目级单例 + flush；实体/.project 写锁；dispose 契约补齐',
                ],
            },
            {
                type: 'improved',
                label: '🧭 交互',
                items: [
                    '按钮 busy 统一防连点；命令定义/面板集合一致',
                    'MiniSettingsModal 与设置页共用分区，消除双份字段维护',
                    '删除项目卡改为两步确认，不再要求输入项目名',
                ],
            },
        ],
    },

    {
        version: '4.26.4',
        date: '2026-11-04',
        title: '模板流转单一入口与正文路径统一',
        sections: [
            {
                type: 'improved',
                label: '🧵 模板流转',
                items: [
                    '新增 resolveStepPrompt 单一入口：vault > 用户覆盖 > 内置',
                    '单步/批量/继续/合并规划/情绪/Scene 全部接入；未解析变量显式告警',
                    '步骤结果记录实际模板 id/version/hash 与规则版本/hash',
                ],
            },
            {
                type: 'fixed',
                label: '🧭 数据源',
                items: [
                    'BodyWriter 改用 vault 唯一写作规则，修复规则改动不影响落盘格式',
                    '标题化正文（第3章_风起_正文.md）在协同/结算/审查/导出/续写中可被正确解析',
                    'TemplateService 缺模板兜底改用 assets 生成物；清空模板会真正回退内置',
                ],
            },
        ],
    },

    {
        version: '4.26.3',
        date: '2026-11-03',
        title: '项目来源统一与 Agent 全权限',
        sections: [
            {
                type: 'fixed',
                label: '🧭 项目同步',
                items: [
                    '新增 shared/project-catalog 单一来源：Agent 工作台/导出/项目卡/getActiveProject 共用',
                    '只有 03-大纲与章节 的删除残留不再被识别为项目',
                    'BodyWriter 拒绝写入已删除项目，避免自动保存重建目录',
                ],
            },
            {
                type: 'improved',
                label: '🤖 Agent 工作台',
                items: [
                    '监听 vault 增删改，项目列表/chip/文件树/Agent 上下文实时同步',
                    '新增写文件、删文件、移动文件、删除项目工具；危险操作二次确认',
                    '删除项目后立即刷新会话项目快照，不再显示已删项目',
                ],
            },
        ],
    },

    {
        version: '4.26.2',
        date: '2026-11-03',
        title: '类型债预算、大文件切片与跨平台门禁',
        sections: [
            {
                type: 'improved',
                label: '🧹 类型债与门禁',
                items: [
                    '新增 any 预算棘轮：运行时代码 any 463 → 309，单文件与新增文件都不许回涨',
                    '新增 CHANGELOG 版本节点门禁：顶部版本必须唯一，禁止再堆积 Unreleased',
                ],
            },
            {
                type: 'improved',
                label: '📦 大文件切片',
                items: [
                    'ai-api-client 1720 → 882 行，流式调用拆到 ai-api-stream，公开 API 不变',
                    '协同写作人工率与资产状态拆成独立模块，并补 9 个纯函数单测',
                ],
            },
            {
                type: 'improved',
                label: '🗂️ 文档与兼容',
                items: [
                    '49 段历史 Unreleased 归档到 docs/changelog/archive-unreleased.md',
                    'CI 新增 Windows/macOS 矩阵；新增依赖与平台兼容手册、Dependabot 月度分组',
                ],
            },
        ],
    },

    {
        version: '4.26.1',
        date: '2026-11-03',
        title: '润色恢复、步骤看门狗、统计与标题完整性修复',
        sections: [
            {
                type: 'fixed',
                label: '🔧 核心链路',
                items: [
                    '正文完成后在后续步骤保留消痕/精修入口；精修补传章节参数，接受后能真正落盘',
                    '结算后润色编辑器从正文文件回填内容，失败显示错误与重试',
                    '一键流程新增单步 8 分钟看门狗，超时中止并提示重试',
                ],
            },
            {
                type: 'fixed',
                label: '📊 数据与结构',
                items: [
                    '字数统计按正文实算，不再被过期 word_count 拉低',
                    '修复标题解析跨行吞正文首句；标题缺失用旧 frontmatter/章节名兜底',
                    '正文校验新增标题完整性；提示词明确标题格式',
                ],
            },
            {
                type: 'improved',
                label: '🧹 技术债与依赖',
                items: [
                    'Vitest 4 / Vite 7 / esbuild 0.25 / Playwright 1.64 / obsidian 类型 1.14 升级',
                    '依赖漏洞 39 → 23，critical/high 清零',
                    '移除无调用方的 engine/prompt-manager 与旧规则兼容壳',
                ],
            },
            {
                type: 'improved',
                label: '🤝 协同写作',
                items: [
                    '新增剧情冗余检查入口',
                    '底部操作栏统一忙碌态/异常捕获；保存失败不再误报结算成功',
                ],
            },
        ],
    },

    {
        version: '4.26.0',
        date: '2026-11-03',
        title: '引导型写作规则 v4：单一镜头 + 单一来源 + 提示词全量同步',
        sections: [
            {
                type: 'improved',
                label: '✍️ 规则体系',
                items: [
                    '规则唯一来源：vault 元文件/00-系统模板/写作规则.md；项目副本自动删除',
                    '核心锚点「单一镜头」；心法改提问式；删除全部数值禁令',
                    '长篇/短篇/剧本模式附录自动拼入同一份规则文本',
                ],
            },
            {
                type: 'improved',
                label: '🎯 提示词',
                items: [
                    'V1–V4/规划/蒸馏/QC/分析全量去数值禁令；QC 改六块引导复盘',
                    '管理界面自定义步骤模板现在真正覆盖 pipeline',
                    'ai-prompt-builder 与协同路径的内置规则/切片全部下线',
                ],
            },
        ],
    },

    {
        version: '4.25.0',
        date: '2026-11-02',
        title: '生产兼容性与性能优化：Obsidian 1.4+、空闲 CPU、流式分段',
        sections: [
            {
                type: 'fixed',
                label: '🔧 兼容性',
                items: [
                    'Obsidian 1.4.0：Modal.setTitle 改为 titleEl.setText，minAppVersion 下调到 1.4.0',
                    '移除晚于 1.5 的 Vault.getAllFolders，改为 TFolder.children 递归，修复 1.5.x 运行时报错',
                    '以 obsidian 1.4.0 / 1.5.7 类型定义全量 typecheck 通过',
                ],
            },
            {
                type: 'improved',
                label: '⚡ 性能',
                items: [
                    '宠物浮动动画移到 HTML 外层合成层，移除尾巴/眨眼常驻动画',
                    '空闲主线程开销实测 10.22% → 0.21%–0.23%（无插件基线对照）',
                    '新增 perf-smoke 与生命周期 E2E（重复禁用/启用、卸载后重启）',
                ],
            },
            {
                type: 'improved',
                label: '✍️ 设置整理',
                items: [
                    '写作配置按五组重排：篇幅与字数 / 正文形态 / 上下文与模型 / 质量闸门与修订 / 阈值与词表',
                    '写作规则版本、实验分组标签集中到「写作规则」页；页签改名并支持切换后立即重检',
                    '精简设置说明，去掉实验编号与内部事故叙述',
                ],
            },
            {
                type: 'fixed',
                label: '🐛 修复',
                items: [
                    '模拟流按段落切分保留 \\n\\n，正文段落不再粘连',
                    '项目列表不再把 长篇小说/_versions 当成项目（要求项目标志并跳过 _/. 前缀）',
                    '强制揭示解析兼容 bullet/单行建议格式；信息债提示不再误报，伏笔强制揭示真正生效',
                    '修复结算报错 Map keys must be unique：frontmatter 重复键写入收敛 + 读取时自动去重重试',
                    '分析报告的角色状态/时间线检测正文上限 5000→12000 字；字数合格线改为跟随写作配置',
                ],
            },
        ],
    },
    {
        version: '4.24.0',
        date: '2026-11-02',
        title: '完整开发系统：文档、门禁与注释基线',
        sections: [
            {
                type: 'added',
                label: '📚 文档体系',
                items: [
                    'docs/README 总索引 + handbook 11 篇（上手/环境/架构/模块/契约/测试/发布/排障/评审/注释/政策）',
                    'ADR 索引与模板、术语表、发布说明模板；代码索引与门禁表改为生成物',
                    '统一真相源：版本、门禁、测试基线、文件清单不再多处手抄',
                ],
            },
            {
                type: 'added',
                label: '🚦 门禁',
                items: [
                    'check:docs（索引/链接/版本/命令/编码/生成物漂移）与 check:jsdoc（注释棘轮）',
                    'preflight 纳入文档、注释、构建与发布资产校验；新增 preflight:release',
                    '基线缺失不再放行；dsh 隔离门禁修复漏检；CI/Release 对齐同一组门禁',
                ],
            },
            {
                type: 'fixed',
                label: '🔧 修复',
                items: [
                    '桌面系统命令收口到 shared/desktop-shell（不再直接 require child_process）',
                    '台账 NUL 导致文档二进制化；README/CONTRIBUTING/CODE-INDEX/PERFORMANCE 等过期事实',
                ],
            },
        ],
    },
    {
        version: '4.23.4',
        date: '2026-11-02',
        title: '规则版本解析补强与版本显示修正',
        sections: [
            {
                type: 'fixed',
                label: '🔧 修复',
                items: [
                    '内容身份与 frontmatter 分离：正文相同的内置版与文件版不再误判「同版本不同内容」',
                    '模板资产版本号对齐内置 3.6.0，tags 去掉多余的 v3.6.0',
                    '版本解析跳过 BOM、支持空 frontmatter，且只认顶层 version（嵌套 meta.version 不再误判）',
                    '设置页规则版本选项显示具体版本号；漂移提示真正渲染出来',
                    '工作台状态条不再硬编码「内置 3.6.0」，auto 时解析实际生效版本',
                ],
            },
        ],
    },
    {
        version: '4.23.3',
        date: '2026-11-02',
        title: '写作规则版本误报修复',
        sections: [
            {
                type: 'fixed',
                label: '🔧 修复',
                items: [
                    '规则版本号优先读 frontmatter 的 version 字段，tags 里的 v3.6.0 不再抢先命中',
                    '带后缀的自定义变体（3.6.0-引导代禁止）不再被误判为内置版本，启动不再弹假漂移告警',
                    '版本提示只在主干落后时出现；3.7.0-anchor 等实验版不再每次提示',
                ],
            },
        ],
    },
    {
        version: '4.23.2',
        date: '2026-11-02',
        title: 'dsh 边界决策确认',
        sections: [
            {
                type: 'improved',
                label: '✅ 决策',
                items: [
                    'dsh 写入只能整会话放开：默认只读，开启后启动前再确认一次，没有逐文件审批',
                    '接受 dsh 完整依赖树（含 bash/pwsh），由用户手动安装，插件不自动安装/升级',
                    '设置页补充依赖树与写入语义说明；研究档案删除「逐次批准」的过时表述',
                ],
            },
        ],
    },
    {
        version: '4.23.1',
        date: '2026-11-02',
        title: 'dsh 真实环境验证与 Windows 启动修复',
        sections: [
            {
                type: 'fixed',
                label: '🔧 修复',
                items: [
                    'Windows 上 dsh 无法启动：npx 的 .cmd shim 改为经 ComSpec 执行，含空格参数自动加引号',
                    '子进程补齐 SystemRoot/APPDATA/USERPROFILE 等平台必需环境变量，npx 才能找到缓存',
                    '空闲等待改为与 rc.5 的 session/wait 竞速，旧版本无该方法时静默回落',
                    'dsh 健康检查超时从 20 秒放宽到 120 秒（首次 npx 下载）',
                ],
            },
            {
                type: 'improved',
                label: '✅ 已验证',
                items: [
                    '真实模型调用通过：DEEPSEEK_API_KEY 经环境变量生效，不写配置文件',
                    'sandbox --patch 生效：只读拒绝写入，workspace-write 放行',
                    '确认 SDK 协议没有逐次审批通道；只读是默认且唯一安全的写入策略',
                ],
            },
        ],
    },
    {
        version: '4.23.0',
        date: '2026-11-02',
        title: '专项收口、dsh 可选后端与数据一致性加固',
        sections: [
            {
                type: 'added',
                label: '✨ 新功能',
                items: [
                    '内置主题画廊：7 套三层配色，浅色/深色一键切换',
                    '日/周/月字数产出统计、状态栏今日字数与桌面宠物浮窗',
                    '版本历史 UI 入口、首启引导与设置分区补全',
                    'RAG 来源可见化：记录书名/维度/分数/片段，步骤面板与统计页可查',
                ],
            },
            {
                type: 'added',
                label: '🤖 Agent 与 dsh',
                items: [
                    'dsh 可选后端：stdio JSON-RPC、健康检查、启动前一次性写入确认、可强制结束',
                    'Harness 回合内上下文预算、窗口化压缩阈值与事件日志纪律',
                ],
            },
            {
                type: 'improved',
                label: '🧱 数据一致性',
                items: [
                    '实体目录访问统一到 entity-reader / entityDir，目录前缀残留清零',
                    '结算表收敛为唯一生成器，表/快照/总览在结算后统一编排',
                    '文本拆分工具合并 10 份副本，差异行为用测试锁定',
                ],
            },
            {
                type: 'fixed',
                label: '🔧 修复',
                items: [
                    '结算快照与字段写入同进写锁，部分失败回滚不再写回过期值',
                    '写作规则改动后格式契约缓存自动失效（按 mtime+size 指纹）',
                    '正文写后取不到文件时重试并显式告警，不变量字段不再静默丢失',
                    '项目改名改走 vault 索引写入，不会因旧 frontmatter 缓存被覆盖',
                    '豆包向量 Key 被 OpenAI 覆盖、加密态保存清空 API Key 等严重问题',
                ],
            },
            {
                type: 'improved',
                label: '🚦 门禁',
                items: [
                    'preflight 补齐 lint 与 build；发布校验覆盖 package/manifest/versions.json/tag 四方一致',
                    '新增结算真实行为、知识库状态机、Agent 权限边界等回归测试',
                ],
            },
        ],
    },
    {
        version: '4.22.0',
        date: '2026-10-31',
        title: '版本治理、上下文体检、规划链契约与全插件排查',
        sections: [
            {
                type: 'added',
                label: '🧬 版本治理',
                items: [
                    '写作规则 5 版并存（3.6.0/legacy/3.7 锚点/3.8 场景节拍/3.9 真人特征），同一时刻只生效一个',
                    '正文模板 V1–V4 可切换；设置页新增规则版本/模板变体/人味模式/实验分组',
                    '哈希漂移检测：版本号相同但正文被换过会告警；账本与步骤 frontmatter 记录版本归因',
                ],
            },
            {
                type: 'added',
                label: '🧹 上下文体检',
                items: [
                    '注入前检测重复段并保留权威版本，规则与文笔风格冲突只剔冲突行',
                    '步骤结果引用别的章节号时在注入账本告警（疑似串章）',
                ],
            },
            {
                type: 'added',
                label: '🔁 修订闭环',
                items: [
                    '质量控制后自动定向修订：只改报告列出的问题，锁定人物与情节',
                    '接受闸门：字数 ±10%、人物不丢、对话占比不塌、非 JSON；采纳前自动存章节版本',
                    '修订后量化复检（AI 味/对话/短叙述/未消化线索）；结果进入执行登记表',
                ],
            },
            {
                type: 'improved',
                label: '🧩 规划链',
                items: [
                    '信息规划输出对齐程序解析：章纲硬要求块（开头承接/章末钩子/伏笔）不再为空',
                    '场景卡补感官/身体/情绪弧；V1 模板补台词骨架；骨架为空时给兜底文案',
                    '配角灵魂补齐 9 字段；记忆碎片与事实索引改为自动生成',
                ],
            },
            {
                type: 'fixed',
                label: '🩹 数据正确性',
                items: [
                    '结算幂等：重跑同一章不再二次累加关系值/重复追加时间线',
                    '连续性账本写进人物卡（已知信息/伤势/持有物品），快照三列不再为空',
                    '正文同章双文件问题：所有读写点统一「带章名优先」',
                    '覆盖正文前自动备份；归因字段改为写前合成，不再静默丢失',
                ],
            },
            {
                type: 'fixed',
                label: '🛡️ 全插件排查 P0',
                items: [
                    '设置迁移失败不再被标记完成；分卷大纲清理只删插件生成的目录文件',
                    '发布资产与构建产物对齐；协同保存检测外部写入，不再覆盖一键成文的新稿',
                ],
            },
        ],
    },
    {
        version: '4.21.1',
        date: '2026-10-31',
        title: '执行登记表、RAG 评估基准与真实 AI 链路实测',
        sections: [
            {
                type: 'added',
                label: '🔁 Agent 长流程闭环',
                items: [
                    '新增执行登记表：成文/结算/导出/看板完成后记录状态、耗时与结算回写量',
                    '新增 get_execution_status 工具：Agent 跑完长流程后主动核对结果再汇报',
                    'run_command 改为可等待执行，派发即报错不再被吞',
                ],
            },
            {
                type: 'added',
                label: '🔎 RAG 评估',
                items: [
                    '新增 npm run eval:rag：hit@k / MRR / 近重复占比，可对检索结果做回归',
                    '近重复用重叠系数判定，能识别「一段包住另一段」的分块重复',
                ],
            },
            {
                type: 'fixed',
                label: '🧪 真实链路实测修复',
                items: [
                    '中文弯引号对话被判「缺少对话描写」，一键成文每章都会中断在正文步',
                    '质量控制标题带「一、」「【】」时结构校验误判，且缺失项为空看不到原因',
                    '思考型模型返回空正文时整章中断：现同模型关闭思考重试一次',
                    '后台整章异常被吞、跑满 15 分钟无反馈：现记录失败并提示',
                    '一键成文与后台整章重复结算同一章：现磁盘已结算则跳过',
                    '正文按标题重命名后无法再定位章节（提示「请先打开一个章节」）',
                ],
            },
        ],
    },
    {
        version: '4.21.0',
        date: '2026-10-31',
        title: 'RAG 检索管线、Agent 会话运行时与 Obsidian 原生能力',
        sections: [
            {
                type: 'added',
                label: '🔎 RAG 检索管线',
                items: [
                    '9 个知识注入点收敛为统一管线：多查询计划 → 并行检索 → 邻块扩展 → MMR 去重 → 预算打包',
                    '查询向量 LRU 缓存：同一句 query 在多个注入点只嵌入一次',
                    '检索遥测进执行时间线：这次生成检索了什么、丢了什么，不再静默失败',
                ],
            },
            {
                type: 'added',
                label: '🤖 Agent 会话运行时',
                items: [
                    '新增 read_file / search_vault 工具：按行分页读文件、关键词检索定位，路径守卫防越界',
                    '大结果自动落盘 .sessions/spill：会话只留定位符与头尾摘要，需要时无损取回',
                    '输入框支持 @ 引用库内文件（候选弹层、带空格路径加引号）与消息引用（发送时 > 原话 前置）',
                    '会话按项目持久化 .sessions/agent/<项目>.jsonl：重开自动恢复历史，新增「新会话」入口',
                    '每回合注入当前时间上下文；遥测新增上下文 token 与窗口占用显示',
                ],
            },
            {
                type: 'added',
                label: '🧭 Obsidian 原生能力',
                items: [
                    '右侧「项目速览」面板：属性内联编辑、标签 chips、按文件类型的快捷动作',
                    '双标签并存：插件标签追加 nw/ 层级标签，Obsidian 标签面板折叠成组',
                    'Bases 看板：一键生成章节进度/人物状态/物品归属/地点势力四个原生看板',
                    '属性模板与补齐命令：10 类文件属性单一来源，只补空值不覆盖',
                ],
            },
            {
                type: 'improved',
                label: '🧠 记忆与反 AI',
                items: [
                    '长篇记忆去重 + 相关度排序：近重复事实合并，按本章相关度带出',
                    '注入影响溯源账本：31 个注入段标注影响面，指纹预算可配置，截断显式标红',
                    '结算回写加固：人物境界/位置白名单补齐、字段守卫、重复结算幂等、归属字段自动 wiki-link',
                    '数据级反 AI：章纲开头承接/章末钩子字段、伏笔闭环自动核对、角色按章行为摘要',
                ],
            },
        ],
    },
    {
        version: '4.20.0',
        date: '2026-10-27',
        title: '三模式创作流程、单元工作台与多格式成稿导出',
        sections: [
            {
                type: 'added',
                label: '🧭 创作流程与单元工作台',
                items: [
                    '工作台新增「创作流程」页签：按长篇/短篇/剧本展示阶段、进度与唯一下一步',
                    '项目页右侧新增流程摘要；Ribbon 与命令面板可直接打开创作流程',
                    '短篇/剧本创建成功后自动进入该项目的创作流程页',
                    '短篇/剧本新增单元写作工作台：单元列表、编辑器、AI 工具条、大纲与设定',
                    '单元工作台支持 AI 生成本节、续写、改写选区与本地语感质检',
                    '完成本节自动回写 status=written 与 word_count，并跳转下一单元',
                ],
            },
            {
                type: 'added',
                label: '📦 成稿导出',
                items: [
                    '新增 EPUB 3（.epub）：完整 OCF 结构，可在阅读器/微信读书导入',
                    '新增 Word（.docx）：标题层级、首行缩进、1.5 倍行距、每章分页',
                    'TXT 新增 UTF-8 BOM 选项，兼容旧版 Windows 记事本',
                    '桌面下载与移动端写入「导出文件/」共用同一套二进制导出入口',
                ],
            },
            {
                type: 'improved',
                label: '🔧 流程与守卫',
                items: [
                    '命令面板按项目模式隐藏长篇/短篇/剧本专属命令，执行时给出替代入口',
                    'Agent 新增 open_flow；open_wizard/open_chapter/run_command 按模式对齐',
                    'Agent 项目状态改用「章/节/集」汇报进度',
                    'chapterNumber 支持章/节/集/回/幕，短篇/剧本进度不再恒为 0',
                ],
            },
            {
                type: 'fixed',
                label: '🐞 修复',
                items: [
                    '只写一章并结算时，流程错误显示「结算完成」',
                    '短篇/剧本创建后只弹 Notice、不跳转的断头流程',
                    '导出弹窗可能把外部传入的项目替换成列表第一个',
                    '流程摘要的阶段圆点在深色/同色主题下不可见',
                ],
            },
        ],
    },
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
                    '新增对话引导 Agent：最前端先选长篇/短篇/剧本，长篇再分原创/同人两条路径',
                    '短篇/剧本对话引导补齐平台分类、故事核、冲突、钩子、角色、场景、集数与卡点',
                    'Agent 关键节点改为选择卡，展示预期效果/适用场景/风险/预览',
                    '新增引导/自动双模式：自动模式用 CSPRNG 自洽填参并直接创建，可随时切换',
                    '项目与章节页新增固定「🤖 对话引导」工具栏入口',
                    '新增人类写作节奏约束，注入正文/协同/DEAI 改写',
                    '新增五套故事结构（起承转合/三幕式/五幕式/英雄之旅/序破急）与九组创作设定',
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
                    '章节状态栏可自由切换叙事结构，切换后写入项目并影响后续步骤',
                    '整章正文与协同写作接入场景描写硬约束；协同新增「🎬 场景描写」动作',
                    '故事结构面板改为双栏分组 + 阶段比例轨道；通用交互补齐 focus-visible 与 reduced-motion',
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
 * @param version - 版本
 * @returns 结果数组
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
