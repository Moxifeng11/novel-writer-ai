/**
 * tools-modal.ts - ToolsModal extracted from full-writer-view.ts (v6.0)
 */

import { App, Modal } from 'obsidian';
import type { NovelWriterPluginAPI } from '../../shared/plugin-api';

export class ToolsModal extends Modal {
    private plugin: NovelWriterPluginAPI;
    private toolGroups: Array<{
        label: string;
        buttons: Array<{ label: string; desc: string; icon: string; commandId: string }>;
    }>;

    constructor(app: App, plugin: NovelWriterPluginAPI) {
        super(app);
        this.plugin = plugin;
        this.toolGroups = [
            {
                label: '✍️ 核心写作',
                buttons: [
                    { label: '协同写作工作台', desc: '句级联想、写作控制、设定检查、保存与结算的统一正文入口', icon: '✍️', commandId: 'novel-writer-co-writing' },
                    { label: '流程规划工作台', desc: '章节规划、上下文采集与步骤结果管理', icon: '🎯', commandId: 'novel-writer-full-writer' },
                ]
            },
            {
                label: '📋 项目规划',
                buttons: [
                    { label: '脑洞构思工坊', desc: '题材发散、创意评估、核心概念提炼的创作前期工具', icon: '💡', commandId: 'novel-writer-ideation' },
                    { label: '黄金开篇工坊', desc: '黄金三章设计、钩子生成、节奏分析、开篇吸引力评分', icon: '🌟', commandId: 'novel-writer-golden-opening' },
                    { label: '新建项目', desc: '创建一个新的小说项目', icon: '📁', commandId: 'novel-writer-create-project' },
                    { label: 'AI 全书规划', desc: 'AI 辅助规划整本书的分卷大纲', icon: '📋', commandId: 'novel-writer-plan-book' },
                    { label: '续写规划', desc: '规划下一章/下一卷的内容方向', icon: '🔄', commandId: 'novel-writer-continue-chapters' },
                ]
            },
            {
                label: '📝 辅助生成',
                buttons: [
                    { label: '整章生成（旧）', desc: '辅助生成整章草稿；正式正文入口请使用协同写作工作台', icon: '✍️', commandId: 'novel-writer-write-chapter' },
                    { label: '自动写作器（旧）', desc: '辅助连续生成草稿；不替代协同写作工作台', icon: '🤖', commandId: 'novel-writer-auto-writer' },
                    { label: '批量写正文（旧）', desc: '批量生成草稿；后续需进入协同写作检查与结算', icon: '📝', commandId: 'novel-writer-batch-chapters' },
                    { label: '批量建章', desc: '批量创建新章节骨架', icon: '📦', commandId: 'novel-writer-batch-create' },
                ]
            },
            {
                label: '🌍 设定生成',
                buttons: [
                    { label: '生成世界观', desc: '用 AI 生成世界观设定', icon: '🌍', commandId: 'novel-writer-worldview' },
                    { label: '生成人物', desc: '创建新角色及其档案', icon: '👤', commandId: 'novel-writer-character' },
                    { label: '生成势力', desc: '定义势力/组织关系', icon: '🏰', commandId: 'novel-writer-faction' },
                    { label: '生成地点', desc: '创建故事场景地点', icon: '📍', commandId: 'novel-writer-location' },
                    { label: '生成物品功法', desc: '设定特殊物品或功法', icon: '⚔️', commandId: 'novel-writer-item' },
                    { label: 'AI 世界元素', desc: 'AI 自动发现并添加世界元素', icon: '✨', commandId: 'novel-writer-ai-builder' },
                    { label: '添加同人设定', desc: '添加同人创作特有设定', icon: '📚', commandId: 'novel-writer-add-fanfic' },
                ]
            },
            {
                label: '🔍 审查与优化',
                buttons: [
                    { label: '连贯性审查', desc: '检查本章与前文的连贯性', icon: '🔍', commandId: 'novel-writer-review-chapter' },
                    { label: '步骤结果查看', desc: '按章节查看所有步骤结果文件（信息规划/大纲/分析报告等）', icon: '📋', commandId: 'novel-writer-step-result-viewer' },
                    { label: '章节结算', desc: '完成本章的结算（分析报告+状态更新）', icon: '✅', commandId: 'novel-writer-chapter-settlement' },
                    { label: '文笔风格蒸馏', desc: '学习并应用新的文笔风格', icon: '🎨', commandId: 'novel-writer-style-distiller' },
                    { label: '上下文注入', desc: '手动注入上下文信息到当前章节', icon: '💉', commandId: 'novel-writer-context-injector' },
                ]
            },
            {
                label: '🔧 工具与维护',
                buttons: [
                    { label: '全书简介', desc: '编辑或查看全书简介信息', icon: '📖', commandId: 'novel-writer-volume-intro' },
                    { label: '作品标签分析', desc: '分析当前作品的标签体系', icon: '🏷️', commandId: 'novel-writer-tags' },
                    { label: '番茄榜单分析', desc: '分析番茄小说榜单趋势', icon: '📊', commandId: 'novel-writer-tomato-rank' },
                    { label: '跨卷状态继承', desc: '管理跨卷的实体状态继承', icon: '🔗', commandId: 'novel-writer-cross-volume-state' },
                    { label: '流程诊断', desc: '诊断当前写作流程状态', icon: '🔧', commandId: 'novel-writer-diagnose' },
                    { label: '重建章节', desc: '重建章节结构（小心使用）', icon: '🔨', commandId: 'novel-writer-rebuild' },
                    { label: '备份元文件', desc: '备份所有元数据文件', icon: '💾', commandId: 'novel-writer-backup' },
                    { label: '保护元文件', desc: '对元文件进行写保护', icon: '🔒', commandId: 'novel-writer-protect' },
                ]
            }
        ];
    }

    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('novel-writer-tools-modal-shell');
        this.modalEl.style.setProperty('margin', 'auto', 'important');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('novel-writer-tools-modal');

        const container = contentEl.createDiv({ cls: 'nw-tools-container' });
        const header = container.createDiv({ cls: 'nw-tools-header' });
        header.createEl('h2', { text: '⚡ 快捷工具', cls: 'nw-tools-title' });
        header.createEl('p', { text: '选择一项功能开始操作', cls: 'nw-tools-subtitle' });

        const grid = container.createDiv({ cls: 'nw-tools-grid' });
        for (const group of this.toolGroups) {
            const groupDiv = grid.createDiv({ cls: 'nw-tools-group' });
            groupDiv.createDiv({ text: group.label, cls: 'nw-tools-group-title' });
            for (const btn of group.buttons) {
                const card = groupDiv.createEl('button', { cls: 'nw-tools-card' });
                card.setAttr('title', `${btn.label}\n${btn.desc}`);
                card.createSpan({ text: btn.icon, cls: 'nw-tools-card-icon' });
                const textWrap = card.createDiv({ cls: 'nw-tools-card-text' });
                textWrap.createDiv({ text: btn.label, cls: 'nw-tools-card-label' });
                textWrap.createDiv({ text: btn.desc, cls: 'nw-tools-card-desc' });
                card.onclick = () => {
                    this.close();
                    this.plugin.executeCommand(btn.commandId);
                };
            }
        }

        const footer = container.createDiv({ cls: 'nw-tools-footer' });
        const closeBtn = footer.createEl('button', { text: '✕ 关闭', cls: 'nw-tools-close-btn' });
        closeBtn.onclick = () => this.close();
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
