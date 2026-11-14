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
    {
        version: '4.86.0',
        date: '2026-11-13',
        title: '静默失败门禁 + 生产环境测试闭环',
        sections: [
            {
                type: 'fixed',
                label: '🔴 AI 调用',
                items: [
                    'AI 调用全线失败修复（high）：密钥在 providerKeys 而 apiKey 为空时，所有调用返回「API密钥未配置」；统一回退取值（非流式/流式/迭代器）',
                    '项目创建关键写入失败不再谎报成功：.project 写入 / 覆盖删除 / 同人设定复制失败改为中止创建',
                ],
            },
            {
                type: 'added',
                label: '🛡️ 门禁与测试',
                items: [
                    '新增门禁 check:silent-failures：识别「读失败当没有 / 写失败当成功」，基线 191 处只降不升（检测先剥注释与字符串，消除 121 处假阳性）',
                    '新增 npm run check:prod：真实 Obsidian + 真实 AI 一键冒烟（6 步，含版本一致性与流式调用）',
                ],
            },
        ],
    },
    {
        version: '4.85.0',
        date: '2026-11-13',
        title: '静默失效大扫除：27 处真 bug + 测试标准',
        sections: [
            {
                type: 'fixed',
                label: '🎯 同人约束',
                items: [
                    '修 5 处「用 vault 索引 API 读 .project」——点文件不入索引，同人约束此前全线静默失效且不报警',
                    '向导的「故事结构」「同人」步骤不再永远判为未完成',
                ],
            },
            {
                type: 'fixed',
                label: '💾 数据安全',
                items: [
                    '修 5 处「读失败→空→覆盖写」：自定义题材/标签、质量历史、简介版本、风格偏好、整章正文不再被静默抹掉',
                    '损坏文件先留档为 .corrupt-<时间戳>，可人工抢救',
                ],
            },
            {
                type: 'fixed',
                label: '🌊 流式 / 拆解 / 指纹 / 导出结算',
                items: [
                    '流被截断不再当成功、重试不再导致正文两轮拼接、协议错误帧不再被当成正常结束',
                    '拆解维度失败不再算完成、不再弹「拆解完成 100%」',
                    '指纹保存/删除/启停/强度/迁移不再「提示成功但重启回滚」',
                    'EPUB 投稿简介与平台标签不再丢失；结算静默漏写路径全部可见化',
                    '向量落盘失败不再谎报「向量化完成」',
                ],
            },
            {
                type: 'improved',
                label: '🧪 工程',
                items: [
                    '新增测试标准：7 条硬规则 + 生产环境测试三层矩阵 + 发版前 10 条手工验收清单',
                    '新增门禁 check:test-standard（禁止 .only / 无理由 .skip / 空断言 / 替身不忠实）',
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
