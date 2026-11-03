import type { ToolGroup, ToolButton } from '@/domains/kernel/tool-catalog-types';

/** 短篇项目专属快捷工具：不出现卷/章/全书规划/章节结算等长篇动作 */
export const SHORT_TOOL_GROUPS: ToolGroup[] = [
    {
        label: '📄 短篇创作',
        buttons: [
            { label: '新建短篇项目', desc: '先完成前期调研，再创建番茄短篇项目', icon: '📄', commandId: 'novel-writer-create-short' },
            { label: '前期调研（当前项目）', desc: '编辑五维分类、故事核、目标字数与分节规格', icon: '📚', commandId: 'novel-writer-short-research' },
            { label: '故事核', desc: '主角、目标、阻力、反转与情绪承诺', icon: '📖', commandId: 'novel-writer-short-story-core' },
            { label: '分节大纲', desc: '规划每节目标、冲突、反转与结尾钩子', icon: '📋', commandId: 'novel-writer-short-outline' },
            { label: '批量建节', desc: '按目标节数创建短篇骨架', icon: '📦', commandId: 'novel-writer-batch-create' },
            { label: '成稿导出', desc: '按「节」导出短篇稿', icon: '📤', commandId: 'novel-writer-export-manuscript' },
        ],
    },
    {
        label: '✍️ 写作辅助',
        buttons: [
            { label: '文笔风格蒸馏', desc: '学习并应用新的文笔风格', icon: '🎨', commandId: 'novel-writer-style-distiller' },
        ],
    },
    {
        label: '🌍 设定与实体',
        defaultCollapsed: true,
        buttons: [
            { label: '实体管理', desc: '统一查看与管理人物/地点/势力/物品', icon: '👥', commandId: 'novel-writer-entity-manager' },
            { label: '生成人物', desc: '创建短篇核心人物', icon: '👤', commandId: 'novel-writer-character' },
            { label: '生成地点', desc: '创建短篇场景地点', icon: '📍', commandId: 'novel-writer-location' },
            { label: '生成物品', desc: '设定关键道具', icon: '⚔️', commandId: 'novel-writer-item' },
            { label: '同人设定库', desc: '检索官方来源并人工审核同人设定', icon: '📚', commandId: 'novel-writer-add-fanfic' },
        ],
    },
    {
        label: '🔧 工具与维护',
        defaultCollapsed: true,
        buttons: [
            { label: '作品标签分析', desc: '分析短篇标签体系', icon: '🏷️', commandId: 'novel-writer-tags' },
            { label: '切换 AI 提供商', desc: '快速切换模型服务商', icon: '🔀', commandId: 'switch-provider' },
        ],
    },
];
