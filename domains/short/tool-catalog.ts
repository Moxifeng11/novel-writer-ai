import type { ToolGroup, ToolButton } from '@/domains/kernel/tool-catalog-types';

/** 短篇项目专属快捷工具：不出现卷/章/全书规划/章节结算等长篇动作 */
export const SHORT_TOOL_GROUPS: ToolGroup[] = [
    {
        label: '📄 短篇创作',
        labelKey: 'toolCatalog.short.group.shortCreation',
        buttons: [
            { label: '新建短篇项目', labelKey: 'toolCatalog.short.tool.createShort', desc: '先完成前期调研，再创建番茄短篇项目', descKey: 'toolCatalog.short.tool.createShortDesc', icon: '📄', commandId: 'novel-writer-create-short' },
            { label: '前期调研（当前项目）', labelKey: 'toolCatalog.short.tool.shortResearch', desc: '编辑五维分类、故事核、目标字数与分节规格', descKey: 'toolCatalog.short.tool.shortResearchDesc', icon: '📚', commandId: 'novel-writer-short-research' },
            { label: '故事核', labelKey: 'toolCatalog.short.tool.shortStoryCore', desc: '主角、目标、阻力、反转与情绪承诺', descKey: 'toolCatalog.short.tool.shortStoryCoreDesc', icon: '📖', commandId: 'novel-writer-short-story-core' },
            { label: '分节大纲', labelKey: 'toolCatalog.short.tool.shortOutline', desc: '规划每节目标、冲突、反转与结尾钩子', descKey: 'toolCatalog.short.tool.shortOutlineDesc', icon: '📋', commandId: 'novel-writer-short-outline' },
            { label: '批量建节', labelKey: 'toolCatalog.short.tool.batchCreate', desc: '按目标节数创建短篇骨架', descKey: 'toolCatalog.short.tool.batchCreateDesc', icon: '📦', commandId: 'novel-writer-batch-create' },
            { label: '成稿导出', labelKey: 'toolCatalog.short.tool.exportManuscript', desc: '按「节」导出短篇稿', descKey: 'toolCatalog.short.tool.exportManuscriptDesc', icon: '📤', commandId: 'novel-writer-export-manuscript' },
        ],
    },
    {
        label: '✍️ 写作辅助',
        labelKey: 'toolCatalog.short.group.writingAssist',
        buttons: [
            { label: '文笔风格蒸馏', labelKey: 'toolCatalog.short.tool.styleDistiller', desc: '学习并应用新的文笔风格', descKey: 'toolCatalog.short.tool.styleDistillerDesc', icon: '🎨', commandId: 'novel-writer-style-distiller' },
        ],
    },
    {
        label: '🌍 设定与实体',
        labelKey: 'toolCatalog.short.group.settingsEntities',
        defaultCollapsed: true,
        buttons: [
            { label: '实体管理', labelKey: 'toolCatalog.short.tool.entityManager', desc: '统一查看与管理人物/地点/势力/物品', descKey: 'toolCatalog.short.tool.entityManagerDesc', icon: '👥', commandId: 'novel-writer-entity-manager' },
            { label: '生成人物', labelKey: 'toolCatalog.short.tool.character', desc: '创建短篇核心人物', descKey: 'toolCatalog.short.tool.characterDesc', icon: '👤', commandId: 'novel-writer-character' },
            { label: '生成地点', labelKey: 'toolCatalog.short.tool.location', desc: '创建短篇场景地点', descKey: 'toolCatalog.short.tool.locationDesc', icon: '📍', commandId: 'novel-writer-location' },
            { label: '生成物品', labelKey: 'toolCatalog.short.tool.item', desc: '设定关键道具', descKey: 'toolCatalog.short.tool.itemDesc', icon: '⚔️', commandId: 'novel-writer-item' },
            { label: '同人设定库', labelKey: 'toolCatalog.short.tool.addFanfic', desc: '检索官方来源并人工审核同人设定', descKey: 'toolCatalog.short.tool.addFanficDesc', icon: '📚', commandId: 'novel-writer-add-fanfic' },
        ],
    },
    {
        label: '🔧 工具与维护',
        labelKey: 'toolCatalog.short.group.toolsMaintenance',
        defaultCollapsed: true,
        buttons: [
            { label: '作品标签分析', labelKey: 'toolCatalog.short.tool.tags', desc: '分析短篇标签体系', descKey: 'toolCatalog.short.tool.tagsDesc', icon: '🏷️', commandId: 'novel-writer-tags' },
            { label: '切换 AI 提供商', labelKey: 'toolCatalog.short.tool.switchProvider', desc: '快速切换模型服务商', descKey: 'toolCatalog.short.tool.switchProviderDesc', icon: '🔀', commandId: 'switch-provider' },
        ],
    },
];
