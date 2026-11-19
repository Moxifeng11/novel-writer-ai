/**
 * domains/long/tool-catalog.ts — 长篇小说专属工具目录
 */
import type { ToolGroup } from '@/domains/kernel/tool-catalog-types';

/**
 * 工具分组表。
 */
export const TOOL_GROUPS: ToolGroup[] = [
    {
        label: '✍️ 核心写作',
        labelKey: 'toolCatalog.long.group.coreWriting',
        buttons: [
            { label: '协同写作工作台', labelKey: 'toolCatalog.long.tool.coWriting', desc: '句级联想、写作控制、设定检查、保存与结算的统一正文入口', descKey: 'toolCatalog.long.tool.coWritingDesc', icon: '✍️', commandId: 'novel-writer-co-writing' },
            { label: '项目与章节', labelKey: 'toolCatalog.long.tool.fullWriter', desc: '流程规划工作台：项目管理、章节规划、上下文采集与步骤结果', descKey: 'toolCatalog.long.tool.fullWriterDesc', icon: '🎯', commandId: 'novel-writer-full-writer' },
        ],
    },
    {
        label: '📋 项目规划',
        labelKey: 'toolCatalog.long.group.projectPlanning',
        buttons: [
            { label: '新建项目', labelKey: 'toolCatalog.long.tool.createProject', desc: '新建长篇小说或同人项目', descKey: 'toolCatalog.long.tool.createProjectDesc', icon: '📁', commandId: 'novel-writer-create-project' },
            { label: '脑洞构思工坊', labelKey: 'toolCatalog.long.tool.ideation', desc: '题材发散、创意评估、核心概念提炼', descKey: 'toolCatalog.long.tool.ideationDesc', icon: '💡', commandId: 'novel-writer-ideation' },
            { label: '黄金开篇工坊', labelKey: 'toolCatalog.long.tool.goldenOpening', desc: '黄金三章设计、钩子生成、节奏分析', descKey: 'toolCatalog.long.tool.goldenOpeningDesc', icon: '🌟', commandId: 'novel-writer-golden-opening' },
            { label: 'AI 全书规划', labelKey: 'toolCatalog.long.tool.planBook', desc: 'AI 辅助规划整本书的分卷大纲', descKey: 'toolCatalog.long.tool.planBookDesc', icon: '📋', commandId: 'novel-writer-plan-book' },
            { label: '续写规划', labelKey: 'toolCatalog.long.tool.continueChapters', desc: '规划下一章/下一卷的内容方向', descKey: 'toolCatalog.long.tool.continueChaptersDesc', icon: '🔄', commandId: 'novel-writer-continue-chapters' },
            { label: '全书简介', labelKey: 'toolCatalog.long.tool.volumeIntro', desc: '生成多版全书简介，挑一版设为采用', descKey: 'toolCatalog.long.tool.volumeIntroDesc', icon: '📖', commandId: 'novel-writer-volume-intro' },
        ],
    },
    {
        label: '📝 章节生成',
        labelKey: 'toolCatalog.long.group.chapterGeneration',
        buttons: [
            { label: '批量建章', labelKey: 'toolCatalog.long.tool.batchCreate', desc: '批量创建新章节骨架', descKey: 'toolCatalog.long.tool.batchCreateDesc', icon: '📦', commandId: 'novel-writer-batch-create' },
        ],
    },
    {
        label: '🌍 设定与实体',
        labelKey: 'toolCatalog.long.group.settingsEntities',
        defaultCollapsed: true,
        buttons: [
            { label: '实体管理', labelKey: 'toolCatalog.long.tool.entityManager', desc: '统一查看与管理人物/地点/势力/物品', descKey: 'toolCatalog.long.tool.entityManagerDesc', icon: '👥', commandId: 'novel-writer-entity-manager' },
            { label: '统一生成实体', labelKey: 'toolCatalog.long.tool.entityGenerate', desc: '一次生成人物/地点/势力/物品并做完整性校验', descKey: 'toolCatalog.long.tool.entityGenerateDesc', icon: '✨', commandId: 'novel-writer-entity-generate' },
            { label: '生成世界观', labelKey: 'toolCatalog.long.tool.worldview', desc: '用 AI 生成世界观设定', descKey: 'toolCatalog.long.tool.worldviewDesc', icon: '🌍', commandId: 'novel-writer-worldview' },
            { label: '生成人物', labelKey: 'toolCatalog.long.tool.character', desc: '创建新角色及其档案', descKey: 'toolCatalog.long.tool.characterDesc', icon: '👤', commandId: 'novel-writer-character' },
            { label: '生成势力', labelKey: 'toolCatalog.long.tool.faction', desc: '定义势力/组织关系', descKey: 'toolCatalog.long.tool.factionDesc', icon: '🏰', commandId: 'novel-writer-faction' },
            { label: '生成地点', labelKey: 'toolCatalog.long.tool.location', desc: '创建故事场景地点', descKey: 'toolCatalog.long.tool.locationDesc', icon: '📍', commandId: 'novel-writer-location' },
            { label: '生成物品功法', labelKey: 'toolCatalog.long.tool.item', desc: '设定特殊物品或功法', descKey: 'toolCatalog.long.tool.itemDesc', icon: '⚔️', commandId: 'novel-writer-item' },
            { label: 'AI 世界元素', labelKey: 'toolCatalog.long.tool.aiBuilder', desc: 'AI 自动发现并添加世界元素', descKey: 'toolCatalog.long.tool.aiBuilderDesc', icon: '🪄', commandId: 'novel-writer-ai-builder' },
            { label: '同人设定库', labelKey: 'toolCatalog.long.tool.addFanfic', desc: '检索官方来源、生成待审核草稿、补全与人工审核', descKey: 'toolCatalog.long.tool.addFanficDesc', icon: '📚', commandId: 'novel-writer-add-fanfic' },
        ],
    },
    {
        label: '🔍 审查与优化',
        labelKey: 'toolCatalog.long.group.reviewOptimize',
        defaultCollapsed: true,
        buttons: [
            { label: '连贯性审查', labelKey: 'toolCatalog.long.tool.reviewChapter', desc: '检查本章与前文的连贯性', descKey: 'toolCatalog.long.tool.reviewChapterDesc', icon: '🔍', commandId: 'novel-writer-review-chapter' },
            { label: '质量仪表盘', labelKey: 'toolCatalog.long.tool.qualityDashboard', desc: '查看全书质量指标与问题分布', descKey: 'toolCatalog.long.tool.qualityDashboardDesc', icon: '📊', commandId: 'novel-writer-quality-dashboard' },
            { label: '章节结算', labelKey: 'toolCatalog.long.tool.chapterSettlement', desc: '完成本章结算（分析报告+状态更新）', descKey: 'toolCatalog.long.tool.chapterSettlementDesc', icon: '✅', commandId: 'novel-writer-chapter-settlement' },
            { label: '步骤结果查看', labelKey: 'toolCatalog.long.tool.stepResultViewer', desc: '按章节查看所有步骤结果文件', descKey: 'toolCatalog.long.tool.stepResultViewerDesc', icon: '📋', commandId: 'novel-writer-step-result-viewer' },
            { label: '关联索引看板', labelKey: 'toolCatalog.long.tool.storyLinkage', desc: '时间线/伏笔 ↔ 设定库/全书规划 的关联视图与回写', descKey: 'toolCatalog.long.tool.storyLinkageDesc', icon: '🔗', commandId: 'novel-writer-story-linkage' },
            { label: '文笔风格蒸馏', labelKey: 'toolCatalog.long.tool.styleDistiller', desc: '学习并应用新的文笔风格', descKey: 'toolCatalog.long.tool.styleDistillerDesc', icon: '🎨', commandId: 'novel-writer-style-distiller' },
            { label: '上下文注入', labelKey: 'toolCatalog.long.tool.contextInjector', desc: '手动注入上下文信息到当前章节', descKey: 'toolCatalog.long.tool.contextInjectorDesc', icon: '💉', commandId: 'novel-writer-context-injector' },
        ],
    },
    {
        label: '🔧 工具与维护',
        labelKey: 'toolCatalog.long.group.toolsMaintenance',
        defaultCollapsed: true,
        buttons: [
            { label: '成稿导出', labelKey: 'toolCatalog.long.tool.exportManuscript', desc: '编译全书为 Markdown / TXT / HTML 稿件', descKey: 'toolCatalog.long.tool.exportManuscriptDesc', icon: '📦', commandId: 'novel-writer-export-manuscript' },
            { label: '作品标签分析', labelKey: 'toolCatalog.long.tool.tags', desc: '分析当前作品的标签体系', descKey: 'toolCatalog.long.tool.tagsDesc', icon: '🏷️', commandId: 'novel-writer-tags' },
            { label: '番茄榜单分析', labelKey: 'toolCatalog.long.tool.tomatoRank', desc: '分析番茄小说榜单趋势', descKey: 'toolCatalog.long.tool.tomatoRankDesc', icon: '📈', commandId: 'novel-writer-tomato-rank' },
            { label: '叙事总览', labelKey: 'toolCatalog.long.tool.narrativeOverview', desc: '查看全书叙事结构总览', descKey: 'toolCatalog.long.tool.narrativeOverviewDesc', icon: '🗺️', commandId: 'novel-writer-narrative-overview' },
            { label: '跨卷状态继承', labelKey: 'toolCatalog.long.tool.crossVolumeState', desc: '管理跨卷的实体状态继承', descKey: 'toolCatalog.long.tool.crossVolumeStateDesc', icon: '🔗', commandId: 'novel-writer-cross-volume-state' },
            { label: '流程诊断', labelKey: 'toolCatalog.long.tool.diagnose', desc: '诊断当前写作流程状态', descKey: 'toolCatalog.long.tool.diagnoseDesc', icon: '🩺', commandId: 'novel-writer-diagnose' },
            { label: '重建章节', labelKey: 'toolCatalog.long.tool.rebuild', desc: '重建章节结构（小心使用）', descKey: 'toolCatalog.long.tool.rebuildDesc', icon: '🔨', commandId: 'novel-writer-rebuild' },
            { label: '备份元文件', labelKey: 'toolCatalog.long.tool.backup', desc: '备份所有元数据文件', descKey: 'toolCatalog.long.tool.backupDesc', icon: '💾', commandId: 'novel-writer-backup' },
            { label: '保护元文件', labelKey: 'toolCatalog.long.tool.protect', desc: '对元文件进行写保护', descKey: 'toolCatalog.long.tool.protectDesc', icon: '🔒', commandId: 'novel-writer-protect' },
            { label: '切换 AI 提供商', labelKey: 'toolCatalog.long.tool.switchProvider', desc: '快速切换模型服务商', descKey: 'toolCatalog.long.tool.switchProviderDesc', icon: '🔀', commandId: 'switch-provider' },
        ],
    },
];

/**
 * 长篇模式的工具分组。
 */
export const LONG_TOOL_GROUPS = TOOL_GROUPS;

/** 长篇章节页高频工具；仅允许长篇目录内的命令 */
export const CHAPTER_QUICK_TOOL_IDS: string[] = [
    'novel-writer-review-chapter',
    'novel-writer-chapter-settlement',
    'novel-writer-step-result-viewer',
    'novel-writer-story-linkage',
    'novel-writer-batch-create',
    'novel-writer-character',
    'novel-writer-entity-manager',
    'novel-writer-style-distiller',
    'novel-writer-context-injector',
    'novel-writer-export-manuscript',
];

/**
 * 按命令 ID 查找长篇工具定义。
 *
 * @param commandId - 命令 ID
 * @returns 工具定义；未找到时为 undefined
 */
export function findLongToolByCommandId(commandId: string) {
    for (const group of TOOL_GROUPS) {
        const found = group.buttons.find(b => b.commandId === commandId);
        if (found) return found;
    }
    return undefined;
}
