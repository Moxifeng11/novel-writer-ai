import type { ToolGroup, ToolButton } from '@/domains/kernel/tool-catalog-types';

/** 剧本项目专属快捷工具：不出现卷/章/全书规划/章节结算等长篇动作 */
export const SCRIPT_TOOL_GROUPS: ToolGroup[] = [
    {
        label: '🎬 剧本创作',
        labelKey: 'toolCatalog.script.group.scriptCreation',
        buttons: [
            { label: '新建剧本项目', labelKey: 'toolCatalog.script.tool.createScript', desc: '先完成前期调研，再创建红果短剧项目', descKey: 'toolCatalog.script.tool.createScriptDesc', icon: '🎬', commandId: 'novel-writer-create-script' },
            { label: '前期调研（当前项目）', labelKey: 'toolCatalog.script.tool.scriptResearch', desc: '编辑类型、商业钩子、集数规格与场景圣经', descKey: 'toolCatalog.script.tool.scriptResearchDesc', icon: '📚', commandId: 'novel-writer-script-research' },
            { label: '场景圣经', labelKey: 'toolCatalog.script.tool.scriptSceneBible', desc: '主场景、光线、道具与拍摄限制', descKey: 'toolCatalog.script.tool.scriptSceneBibleDesc', icon: '🎭', commandId: 'novel-writer-script-scene-bible' },
            { label: '分集大纲', labelKey: 'toolCatalog.script.tool.scriptOutline', desc: '规划每集冲突、爽点、钩子与场次', descKey: 'toolCatalog.script.tool.scriptOutlineDesc', icon: '📋', commandId: 'novel-writer-script-outline' },
            { label: '分镜表', labelKey: 'toolCatalog.script.tool.scriptStoryboard', desc: '镜号、景别、运镜、动作与台词', descKey: 'toolCatalog.script.tool.scriptStoryboardDesc', icon: '🎬', commandId: 'novel-writer-script-storyboard' },
            { label: '批量建集', labelKey: 'toolCatalog.script.tool.batchCreate', desc: '按目标集数创建剧本骨架', descKey: 'toolCatalog.script.tool.batchCreateDesc', icon: '📦', commandId: 'novel-writer-batch-create' },
            { label: '成稿导出', labelKey: 'toolCatalog.script.tool.exportManuscript', desc: '按「集」导出剧本稿', descKey: 'toolCatalog.script.tool.exportManuscriptDesc', icon: '📤', commandId: 'novel-writer-export-manuscript' },
        ],
    },
    {
        label: '✍️ 写作辅助',
        labelKey: 'toolCatalog.script.group.writingAssist',
        buttons: [
            { label: '文笔风格蒸馏', labelKey: 'toolCatalog.script.tool.styleDistiller', desc: '学习并应用新的文笔风格', descKey: 'toolCatalog.script.tool.styleDistillerDesc', icon: '🎨', commandId: 'novel-writer-style-distiller' },
        ],
    },
    {
        label: '🌍 设定与实体',
        labelKey: 'toolCatalog.script.group.settingsEntities',
        defaultCollapsed: true,
        buttons: [
            { label: '实体管理', labelKey: 'toolCatalog.script.tool.entityManager', desc: '统一查看与管理人物/地点/势力/物品', descKey: 'toolCatalog.script.tool.entityManagerDesc', icon: '👥', commandId: 'novel-writer-entity-manager' },
            { label: '生成人物', labelKey: 'toolCatalog.script.tool.character', desc: '创建剧本角色小传', descKey: 'toolCatalog.script.tool.characterDesc', icon: '👤', commandId: 'novel-writer-character' },
            { label: '生成地点', labelKey: 'toolCatalog.script.tool.location', desc: '创建剧本场景与地点', descKey: 'toolCatalog.script.tool.locationDesc', icon: '📍', commandId: 'novel-writer-location' },
            { label: '生成物品', labelKey: 'toolCatalog.script.tool.item', desc: '设定关键道具', descKey: 'toolCatalog.script.tool.itemDesc', icon: '⚔️', commandId: 'novel-writer-item' },
            { label: '同人设定库', labelKey: 'toolCatalog.script.tool.addFanfic', desc: '检索官方来源并人工审核同人设定', descKey: 'toolCatalog.script.tool.addFanficDesc', icon: '📚', commandId: 'novel-writer-add-fanfic' },
        ],
    },
    {
        label: '🔧 工具与维护',
        labelKey: 'toolCatalog.script.group.toolsMaintenance',
        defaultCollapsed: true,
        buttons: [
            { label: '作品标签分析', labelKey: 'toolCatalog.script.tool.tags', desc: '分析剧本类型与标签', descKey: 'toolCatalog.script.tool.tagsDesc', icon: '🏷️', commandId: 'novel-writer-tags' },
            { label: '切换 AI 提供商', labelKey: 'toolCatalog.script.tool.switchProvider', desc: '快速切换模型服务商', descKey: 'toolCatalog.script.tool.switchProviderDesc', icon: '🔀', commandId: 'switch-provider' },
        ],
    },
];
