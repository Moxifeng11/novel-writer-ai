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
        version: '4.97.0',
        date: '2026-11-20',
        title: '双语界面 + 文面体检 + 视觉收口',
        sections: [
            { type: 'added', label: '🌐 双语界面', items: ['命令面板、设置页、写作主流程、知识库与全部弹窗支持中/英切换（各 6087 条文案）', '语言切换即时生效，命令名重载插件后生效'] },
            { type: 'added', label: '🔤 发布前文面体检', items: ['7 条规则检查错别字/标点/重复/全半角/空格/引号/单位', '问题列表可定位、一键跳转正文；接入导出前置检查'] },
            { type: 'added', label: '🔊 章节朗读', items: ['逐句朗读 + 当前句高亮 + 语速/音色切换 + 播放条'] },
            { type: 'added', label: '✍️ 写作辅助', items: ['全屏写作体检条实时提示', '大纲扩写结果真正写回正文', '质量统计状态可筛选'] },
            { type: 'improved', label: '🎨 界面', items: ['25 个视觉切片完成语义化，暗色主题下按钮配色恢复', '真实点击验收 14 条缺陷全部修复'] },
            { type: 'fixed', label: '🛡 稳定性', items: ['AI 生成按钮防重复扣费', '8 个弹窗关闭前确认，避免误丢改动', '单元写作台支持撤销/重做'] },
            { type: 'breaking', label: '⚠️ 破坏性变更', items: ['旧正文写入链 4 条命令与 3 个隐藏弹窗移除', '协同写作悬浮面板退役（正文走协同写作工作台）'] },
        ],
    },
    {
        version: '4.96.1',
        date: '2026-11-17',
        title: '解锁口令重复弹框修复',
        sections: [
            { type: 'fixed', label: '🔓 密钥解锁', items: ['已解锁后不再重复弹口令框（旧口令密文不再清掉会话口令）', '解不开的密钥如实提示「与当前口令不匹配，请重新填写」'] },
            { type: 'fixed', label: '📚 知识库', items: ['新导入的书不再从列表消失（索引写入不再失败）'] },
        ],
    },
    {
        version: '4.96.0',
        date: '2026-11-14',
        title: '链路修复 + 设置重构',
        sections: [
            { type: 'added', label: '🧭 设置', items: ['18 tab 收敛为 6 一级分组 + 二级 tab'] },
            { type: 'fixed', label: '🔗 链路', items: ['事实库/人物卡连续性字段进写作 prompt', 'entity_status 过滤、台账关联进生成侧'] },
            { type: 'added', label: '👁 降级可见', items: ['时间线结构化列、截断、模板变量、LLM 降级均可见'] },
        ],
    },
    {
        version: '4.95.0',
        date: '2026-11-13',
        title: '词表治理收尾',
        sections: [
            {
                type: 'added',
                label: '🧩 结构化优先',
                items: ['plot-divergence 设定一致性先读结构化矛盾'],
            },
            {
                type: 'added',
                label: '⚙️ 词表可配置',
                items: ['AI 高频词与情绪词表可在设置里追加'],
            },
        ],
    },
    {
        version: '4.94.0',
        date: '2026-11-13',
        title: '快照结构化 + 词表可配置',
        sections: [
            {
                type: 'added',
                label: '🧬 结构化状态',
                items: [
                    '快照新增 lifeState / injuryLevel，由构建器真实填值',
                    '检测器先读结构化字段，词表只做兜底',
                ],
            },
            {
                type: 'added',
                label: '🧩 词表可配置',
                items: ['设置界面可追加 5 类语义关键词'],
            },
        ],
    },
    {
        version: '4.93.0',
        date: '2026-11-13',
        title: '拆解补维度 + 语义词表注册表',
        sections: [
            {
                type: 'added',
                label: '🧩 拆解补维度',
                items: [
                    '新增 slot 子维度（同一主体不同侧面不可比）',
                    '归属约束：只抽关于本人事实',
                ],
            },
            {
                type: 'fixed',
                label: '🛠️ 修复',
                items: ['边界值不再与精确值比较'],
            },
            {
                type: 'added',
                label: '📚 词表治理',
                items: ['A 类语义词表统一注册表，支持用户扩展词'],
            },
        ],
    },
    {
        version: '4.92.0',
        date: '2026-11-13',
        title: '拆解结构化 + 规则统一匹配',
        sections: [
            {
                type: 'added',
                label: '🧩 拆解结构化',
                items: [
                    '谓词改为规范枚举，新增 isCurrentState 回溯标记与 event 事件锚',
                    '规则层统一谓词匹配器（前缀锚定 + 别名表）',
                ],
            },
            {
                type: 'fixed',
                label: '🛠️ 修复',
                items: [
                    'R5 按事件锚分组，修复同一主体不同事件被判时长矛盾',
                    '引文回溯与 0 值噪声不再参与比对',
                ],
            },
            {
                type: 'added',
                label: '📐 体检',
                items: ['项目标准校验接入体检视图'],
            },
        ],
    },
    {
        version: '4.91.0',
        date: '2026-11-13',
        title: '项目标准约束 + 事实库可编辑 + 长篇评测',
        sections: [
            {
                type: 'added',
                label: '📐 项目标准',
                items: [
                    '12 个必备目录/文件/命名规范与标准版本声明',
                    '7 类结构校验 + check:project-standard 门禁与手册',
                ],
            },
            {
                type: 'added',
                label: '📚 事实库',
                items: [
                    '视图内可改值/改区间/忽略/删除，写前整批校验',
                    '能力按等级序判定：进阶不报、倒退才报',
                ],
            },
            {
                type: 'fixed',
                label: '🛠️ 修复',
                items: [
                    'R1 年龄谓词改前缀锚定：补变体漏报，排除回溯限定谓词假矛盾',
                ],
            },
        ],
    },
    {
        version: '4.90.0',
        date: '2026-11-13',
        title: '事实库自动化：自动维护 + 可视化 + 扩面',
        sections: [
            {
                type: 'added',
                label: '📚 知识库事实库',
                items: [
                    '结算后自动增量拆解入库（已拆章的跳过）',
                    '新增「知识库事实库」命令：按主体浏览事实与引文',
                    '地点冲突接入第二意见（合理换场不再误报）',
                ],
            },
            {
                type: 'fixed',
                label: '🛠️ 可靠性',
                items: [
                    '损坏时拒绝写入；失败不影响结算；不可用时降级',
                ],
            },
        ],
    },
    {
        version: '4.89.0',
        date: '2026-11-13',
        title: '知识库事实层：让正则功能有"第二意见"',
        sections: [
            {
                type: 'added',
                label: '📚 知识库事实层',
                items: [
                    'LLM 拆解正文为结构化事实（主体·谓词·值·有效区间·原文引文），落盘可人工修正',
                    '时间线/实体状态/伏笔三类功能改为「正则找候选 → 查事实库定结论」',
                    '低置信矛盾交 LLM 语义判定，判定失败保留规则结果不丢矛盾',
                ],
            },
            {
                type: 'fixed',
                label: '🛠️ 修复',
                items: [
                    '无章节摘要的项目此前 0 产出，现按正文目录枚举并显式告警',
                    '新增 check:command-handlers 门禁，拦「命令执行但无反应」',
                ],
            },
        ],
    },
    {
        version: '4.88.0',
        date: '2026-11-13',
        title: '一致性审核闭环：19 子类全覆盖 + 结算自动兜底',
        sections: [
            {
                type: 'added',
                label: '🔍 一致性审核',
                items: [
                    '19/19 子类全覆盖：新增记忆矛盾、核心规则违规、视角混乱等 10 类',
                    '结算后自动跑规则层（零 token），有疑似项才启 AI 识别（封顶 3 对）',
                    '发现跨章矛盾主动提示，不必再去点命令',
                ],
            },
            {
                type: 'fixed',
                label: '🛠️ 修复',
                items: [
                    'rename 覆盖类问题全仓排查（4 处），含知识库索引第二次起写不进去',
                    '修正 3 处「测试锁住错误行为」的旧断言',
                ],
            },
        ],
    },
    {
        version: '4.87.0',
        date: '2026-11-13',
        title: '跨章一致性审核：从"写得好不好"到"前后对不对"',
        sections: [
            {
                type: 'added',
                label: '🔍 一致性审核',
                items: [
                    '跨章检测 9 类矛盾（命名混淆/数量不符/外貌不符/绝对时间/时长/同时性/无因之果/因果违规/废弃情节）',
                    '每条问题带双侧原文引文与正文字符位置，可一键跳到正文',
                    '规则层零 token 全量跑，仅疑似项交模型复核（默认上限 10 对）',
                    '风险定位：中段加权 + 字符熵 + 罕见字密度，只挑高风险段',
                    'CED 指标（每万字符错误数）用于跨版本比较',
                ],
            },
            {
                type: 'fixed',
                label: '🛠️ 修复',
                items: [
                    '原子写 rename 覆盖已存在文件抛错，导致第二次起写入全失败',
                    '字数统计台账同款问题，导致统计永不持久化',
                    '命令执行体缺失静默失效；新增门禁 check:command-handlers 防复发',
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
