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
        version: '4.97.4',
        date: '2026-11-21',
        title: '按 vault 隔离存储与回收站删除',
        sections: [
            { type: 'breaking', label: '⚠ 兼容性', items: ['最低 Obsidian 版本从 1.4.4 提到 1.8.7（App 级存储 API 自 1.8.7 提供）', 'Obsidian 1.8.7 以下的客户端将无法启用本插件'] },
            { type: 'improved', label: '🔧 存储', items: ['向导结果、灵感收藏、侧栏折叠、时长估算历史、操作确认偏好改存 vault 命名空间，不再跨 vault 串数据', '首次读取会自动把旧全局键的值迁进新存储，旧草稿不丢，回滚旧版仍可读'] },
            { type: 'improved', label: '🗑 删除', items: ['模板、封面、实体卡、版本快照等删除改走回收站，按你的删除偏好处理，误删可恢复', '事务日志等内部临时文件仍直接删除，不会把回收站刷满'] },
        ],
    },
    {
        version: '4.97.3',
        date: '2026-11-20',
        title: '构建可复现',
        sections: [
            { type: 'fixed', label: '🛡 上架', items: ['内联 worker 的 gzip 头改为固定 mtime=0，并改用纯 JS 压缩（fflate）——同一份源码在不同 Node 版本/不同机器上构建出字节一致的 main.js，满足社区审核的构建校验', '此前每次构建的 main.js 哈希都不同，发布资产与审核方重建结果无法比对'] },
        ],
    },
    {
        version: '4.97.2',
        date: '2026-11-20',
        title: '通过社区审核',
        sections: [
            { type: 'fixed', label: '🛡 上架', items: ['两条 eslint 指令补说明——审核扫描器把 eslint-comments/require-description 保持为 error，缺说明会导致整版判 Failed', '新增本地审核扫描门禁 check:obsidian-review 并接入 preflight，退出码等价于「会不会被打回」'] },
        ],
    },
    {
        version: '4.97.1',
        date: '2026-11-20',
        title: '社区目录上架准备',
        sections: [
            { type: 'improved', label: '📦 上架合规', items: ['manifest 声明为桌面端专用（使用 Node/Electron API），描述按目录要求改写为 219 字符动作句', 'README 平台/语言说明与 FAQ 同步修正'] },
        ],
    },
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
