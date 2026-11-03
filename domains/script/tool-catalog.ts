import type { ToolGroup, ToolButton } from '@/domains/kernel/tool-catalog-types';

/** 剧本项目专属快捷工具：不出现卷/章/全书规划/章节结算等长篇动作 */
export const SCRIPT_TOOL_GROUPS: ToolGroup[] = [
    {
        label: '🎬 剧本创作',
        buttons: [
            { label: '新建剧本项目', desc: '先完成前期调研，再创建红果短剧项目', icon: '🎬', commandId: 'novel-writer-create-script' },
            { label: '前期调研（当前项目）', desc: '编辑类型、商业钩子、集数规格与场景圣经', icon: '📚', commandId: 'novel-writer-script-research' },
            { label: '场景圣经', desc: '主场景、光线、道具与拍摄限制', icon: '🎭', commandId: 'novel-writer-script-scene-bible' },
            { label: '分集大纲', desc: '规划每集冲突、爽点、钩子与场次', icon: '📋', commandId: 'novel-writer-script-outline' },
            { label: '分镜表', desc: '镜号、景别、运镜、动作与台词', icon: '🎬', commandId: 'novel-writer-script-storyboard' },
            { label: '批量建集', desc: '按目标集数创建剧本骨架', icon: '📦', commandId: 'novel-writer-batch-create' },
            { label: '成稿导出', desc: '按「集」导出剧本稿', icon: '📤', commandId: 'novel-writer-export-manuscript' },
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
            { label: '生成人物', desc: '创建剧本角色小传', icon: '👤', commandId: 'novel-writer-character' },
            { label: '生成地点', desc: '创建剧本场景与地点', icon: '📍', commandId: 'novel-writer-location' },
            { label: '生成物品', desc: '设定关键道具', icon: '⚔️', commandId: 'novel-writer-item' },
            { label: '同人设定库', desc: '检索官方来源并人工审核同人设定', icon: '📚', commandId: 'novel-writer-add-fanfic' },
        ],
    },
    {
        label: '🔧 工具与维护',
        defaultCollapsed: true,
        buttons: [
            { label: '作品标签分析', desc: '分析剧本类型与标签', icon: '🏷️', commandId: 'novel-writer-tags' },
            { label: '切换 AI 提供商', desc: '快速切换模型服务商', icon: '🔀', commandId: 'switch-provider' },
        ],
    },
];
