import { App, Modal, Notice } from 'obsidian';
import NovelWriterPlugin from '../main';
import { ContextManager } from '../engine/context-manager';
import { createLogger } from '../shared/logger';


const log = createLogger('MainModal');
export class NovelWriterModal extends Modal {
    private plugin: NovelWriterPlugin;
    private contextManager: ContextManager;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.contextManager = plugin.ctxManager;
    }

    async onOpen(): Promise<void> {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        // ═══ v3.4.8: 两层CSS规则 — 见 docs/CSS变量注入与两层规则_全插件避坑指南.md ═══
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');

        contentEl.empty();
        contentEl.addClass('novel-writer-modal');

        contentEl.createEl('h2', { text: '📖 小说工坊 AI' });
        contentEl.createEl('p', { text: '全流程AI长篇小说创作系统' });

        try {
            log.info('开始渲染按钮组...');
            this.renderButtonGroups(contentEl);
            log.info('按钮组渲染完成');
        } catch (e) {
            log.error('渲染按钮组失败:', e);
        }
    }

    private renderButtonGroups(contentEl: HTMLElement): void {
        const groups = [
            {
                label: '核心写作',
                buttons: [
                    { label: '协同写作工作台', icon: '✍️', commandId: 'novel-writer-co-writing', description: '句级联想、写作控制、保存与结算的统一正文入口' },
                    { label: '流程规划工作台', icon: '🎯', commandId: 'novel-writer-full-writer', description: '章节规划、上下文采集与步骤结果管理' },
                ]
            },
            {
                label: '项目管理',
                buttons: [
                    { label: '新建项目', icon: '📁', commandId: 'novel-writer-create-project', description: '创建新的小说项目' },
                    { label: 'AI全书规划', icon: '📋', commandId: 'novel-writer-plan-book', description: '一键生成全书大纲和设定' },
                    { label: '续写规划', icon: '🔄', commandId: 'novel-writer-continue-chapters', description: '检测续写起点并创建章节' },
                ]
            },
            {
                label: '辅助生成',
                buttons: [
                    { label: '整章生成（旧）', icon: '✍️', commandId: 'novel-writer-write-chapter', description: '辅助生成整章草稿；正式正文入口请使用协同写作工作台' },
                    { label: '自动写作器（旧）', icon: '🤖', commandId: 'novel-writer-auto-writer', description: '辅助连续生成草稿；不替代协同写作工作台' },
                    { label: '批量写正文（旧）', icon: '📝', commandId: 'novel-writer-batch-chapters', description: '批量生成草稿；后续需进入协同写作检查与结算' },
                    { label: '批量建章', icon: '📦', commandId: 'novel-writer-batch-create', description: '批量创建章节文件' },
                ]
            },
            {
                label: '设定生成',
                buttons: [
                    { label: '生成世界观', icon: '🌍', commandId: 'novel-writer-worldview', description: 'AI生成世界观设定' },
                    { label: '生成人物', icon: '👤', commandId: 'novel-writer-character', description: 'AI生成人物设定' },
                    { label: '生成势力', icon: '🏰', commandId: 'novel-writer-faction', description: 'AI生成势力设定' },
                    { label: '生成地点', icon: '📍', commandId: 'novel-writer-location', description: 'AI生成地点设定' },  // 新增
                    { label: '生成物品功法', icon: '⚔️', commandId: 'novel-writer-item', description: 'AI生成物品功法设定' },  // 新增
                    { label: 'AI世界元素', icon: '✨', commandId: 'novel-writer-ai-builder', description: '生成人物/地点/物品/功法' },
                    { label: '添加同人设定', icon: '📚', commandId: 'novel-writer-add-fanfic', description: '生成同人作品设定' },
                ]
            },
            {
                label: '审查与优化',
                buttons: [
                    { label: '连贯性审查', icon: '🔍', commandId: 'novel-writer-review-chapter', description: '检查设定一致性和人物OOC' },
                    { label: '步骤结果查看', icon: '📋', commandId: 'novel-writer-step-result-viewer', description: '按章节查看所有步骤结果文件（信息规划/大纲/分析报告等）' },
                    { label: '章节结算', icon: '✅', commandId: 'novel-writer-chapter-settlement', description: '更新人物状态和伏笔' },
                    { label: '文笔风格蒸馏', icon: '🎨', commandId: 'novel-writer-style-distiller', description: '分析并提取写作风格' },
                    { label: '上下文注入', icon: '💉', commandId: 'novel-writer-context-injector', description: '注入相关设定到章节' },
                ]
            },
            {
                label: '工具与维护',
                buttons: [
                    { label: '全书简介', icon: '📖', commandId: 'novel-writer-volume-intro', description: '生成番茄风格全书简介' },
                    { label: '作品标签分析', icon: '🏷️', commandId: 'novel-writer-tags', description: '分析对标标签体系' },
                    { label: '番茄榜单分析', icon: '📊', commandId: 'novel-writer-tomato-rank', description: '分析热门题材趋势' },
                    { label: '跨卷状态继承', icon: '🔗', commandId: 'novel-writer-cross-volume-state', description: '继承上一卷状态' },
                    { label: '流程诊断', icon: '🔧', commandId: 'novel-writer-diagnose', description: '排查写作流程中断问题' },
                    { label: '刷新信息债', icon: '📈', commandId: 'novel-writer-refresh-info-debt', description: '更新信息债看板' },
                    { label: '重建章节', icon: '🔨', commandId: 'novel-writer-rebuild', description: '重建章节结构' },
                    { label: '备份元文件', icon: '💾', commandId: 'novel-writer-backup', description: '备份项目元数据' },
                    { label: '保护元文件', icon: '🔒', commandId: 'novel-writer-protect', description: '保护元文件不被误删' },
                ]
            }
        ];

        groups.forEach(group => {
            const groupContainer = contentEl.createEl('div', { cls: 'novel-writer-button-group' });
            groupContainer.createEl('div', { cls: 'novel-writer-button-group-label', text: group.label });
            
            const buttonContainer = groupContainer.createEl('div', { cls: 'novel-writer-button-container' });
            
            group.buttons.forEach(btn => {
                const button = buttonContainer.createEl('button', {
                    cls: 'nw-btn nw-btn-secondary novel-writer-button'
                });
                
                button.innerHTML = `
                    <span class="novel-writer-button-icon">${btn.icon}</span>
                    <span class="novel-writer-button-text">${btn.label}</span>
                    <span class="novel-writer-button-desc">${btn.description}</span>
                `;
                
                button.setAttribute('data-command', btn.commandId);
                button.setAttribute('title', btn.description);
                
                button.addEventListener('click', () => {
                    try {
                        log.info(`[小说工坊] 点击按钮: ${btn.label}, 命令ID: ${btn.commandId}`);
                        new Notice(`⏳ 正在执行: ${btn.label}...`);
                        
                        const result = this.plugin.executeCommand(btn.commandId);
                        log.info(`[小说工坊] 命令执行结果:`, result);
                        
                        if (result === false) {
                            log.error(`[小说工坊] 命令执行返回 false: ${btn.commandId}`);
                            new Notice(`❌ 命令执行失败: ${btn.label}`);
                        } else {
                            new Notice(`✅ ${btn.label} 执行完成`);
                            this.close();
                        }
                    } catch (error: any) {
                        log.error(`[小说工坊] 命令执行失败: ${btn.commandId}`, error);
                        new Notice(`❌ ${btn.label} 执行失败: ${error.message || '未知错误'}`);
                    }
                });
            });
        });
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
