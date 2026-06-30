/**
 * 向导步骤渲染器（v3.4.x 向导 UI 外迁）
 *
 * 从 FullWriterView 外迁的纯 UI 渲染方法。控制器持有共享的
 * wizardStepResults / wizardStepExecuting 引用（与 view 同一对象），
 * 以及 app / plugin 与 view 回调（showFileContentInline /
 * executeWizardStep / renderTab）。
 */
import { App, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../../main';
import { WizardTab, WizardStep } from './wizard-types';
import { getWorldviewPath, getSettingLibPath, getWritingStylePath, SUBDIR_CHARS, SUBDIR_LOCS, SUBDIR_FACTIONS, SUBDIR_ITEMS, SUBDIR_BODY_ROOT } from '../../shared/paths';
import { findWritingStyleFile } from '../writing-style-paths';
import { ChapterOutlineTreeModal } from '../chapter-outline-tree-modal';
import { EntityOverviewModal } from './entity-overview-modal';
import { ExistingEntityManagerModal } from '../existing-entity-manager';
import { readMergedVolumeOutline } from '../../utils/helpers';
import { WV_SECTIONS } from '../../shared/format-constants';
import { buildFanficSettingsContent, getFanficSettingsPath, missingFanficValueLabels, type FanficSettingsValues } from './fanfic-settings-utils';

export class WizardStepRenderers {
    private wizardStepResults: Record<string, string>;
    private wizardStepExecuting: Set<string>;
    private app: App;
    private plugin: NovelWriterPlugin;
    private showFileContentInline: (container: HTMLElement, filePath: string, title: string) => Promise<void>;
    private executeWizardStep: (tab: WizardTab, step: WizardStep) => Promise<void>;
    private renderTab: (tab: WizardTab, skipAutoAdvance?: boolean) => void;
    private registerOutlineTreeModal: (modal: ChapterOutlineTreeModal) => void;

    constructor(
        wizardStepResults: Record<string, string>,
        wizardStepExecuting: Set<string>,
        app: App,
        plugin: NovelWriterPlugin,
        showFileContentInline: (container: HTMLElement, filePath: string, title: string) => Promise<void>,
        executeWizardStep: (tab: WizardTab, step: WizardStep) => Promise<void>,
        renderTab: (tab: WizardTab, skipAutoAdvance?: boolean) => void,
        registerOutlineTreeModal: (modal: ChapterOutlineTreeModal) => void,
    ) {
        this.wizardStepResults = wizardStepResults;
        this.wizardStepExecuting = wizardStepExecuting;
        this.app = app;
        this.plugin = plugin;
        this.showFileContentInline = showFileContentInline;
        this.executeWizardStep = executeWizardStep;
        this.renderTab = renderTab;
        this.registerOutlineTreeModal = registerOutlineTreeModal;
    }

    async renderWizardFanficStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        container.empty();
        
        // 如果已执行过，恢复表单数据
        const fanficResultKey = `fanfic:${tab.project}`;
        const saved = this.wizardStepResults[fanficResultKey] || '';
        const getSaved = (key: string): string => {
            const m = saved.match(new RegExp(`${key}:\\s*(.+)`));
            return m ? m[1].trim() : '';
        };
        const getRuleSaved = (key: string): string => {
            const m = saved.match(new RegExp(`\\*\\*${key}\\*\\*[：:]\\s*(.+)`));
            return m ? m[1].trim() : '';
        };
        
        container.createEl('p', { text: '⚠️ 同人创作必须设定原作信息，否则后续章节全部 OOC！', cls: 'nw-wizard-warn-box' });

        const form = container.createDiv({ cls: 'nw-wizard-form-grid' });
        
        const collectFanficValues = (): FanficSettingsValues => {
            const inputs = form.querySelectorAll('input, textarea');
            return {
                workName: (inputs[0] as HTMLInputElement).value.trim(),
                workType: (inputs[1] as HTMLInputElement).value.trim(),
                author: (inputs[2] as HTMLInputElement).value.trim(),
                worldviewType: (inputs[3] as HTMLInputElement).value.trim(),
                powerSystem: (inputs[4] as HTMLInputElement).value.trim(),
                coreRules: (inputs[5] as HTMLInputElement).value.trim(),
                mustFollow: (inputs[6] as HTMLTextAreaElement).value.trim(),
                adaptScope: (inputs[7] as HTMLTextAreaElement).value.trim(),
                redlines: (inputs[8] as HTMLTextAreaElement).value.trim(),
            };
        };
        const collectFanficContent = (): string => buildFanficSettingsContent(collectFanficValues());
        
        const addField = (label: string, key: string, type: 'text' | 'textarea' = 'text') => {
            const group = form.createDiv({ attr: { style: type === 'textarea' ? 'grid-column:1/-1;' : '' } });
            group.createEl('label', { text: label, attr: { style: 'display:block; font-size:0.8em; color:var(--text-muted); margin-bottom:4px;' } });
            const input = type === 'textarea'
                ? group.createEl('textarea', { cls: 'nw-wizard-textarea' })
                : group.createEl('input', { attr: { style: 'width:100%; padding:6px 8px; border-radius:6px; border:1px solid var(--background-modifier-border); font-size:0.85em;' } });
            
            if (type === 'textarea') {
                (input as HTMLTextAreaElement).value = getSaved(key);
            } else {
                (input as HTMLInputElement).value = getSaved(key);
            }
            // 任何输入变动自动暂存，确保"执行"按钮能拿到最新数据
            input.addEventListener('input', () => { this.wizardStepResults[fanficResultKey] = collectFanficContent(); });
            return input;
        };
        
        addField('作品名称 *', '作品名称');
        addField('作品类型 *', '作品类型');
        addField('作者 *', '作者');
        addField('世界观类型 *', '世界观类型');
        addField('力量体系 *', '力量体系');
        addField('核心规则 *', '核心规则');
        addField('必须遵守的原作规则 *', '必须遵守的原作规则', 'textarea');
        addField('允许改编的范围 *', '允许改编的范围', 'textarea');
        addField('禁止触及的红线 *', '禁止触及的红线', 'textarea');
        
        // Save button
        const saveBtn = container.createEl('button', { 
            text: '💾 保存同人设定', 
            attr: { style: 'margin-top:12px; padding:6px 16px; background:var(--background-secondary); border:1px solid var(--background-modifier-border); border-radius:6px; cursor:pointer;' } 
        });
        saveBtn.addEventListener('click', async () => {
            const values = collectFanficValues();
            const missing = missingFanficValueLabels(values);
            if (missing.length > 0) {
                new Notice(`⚠️ 请补全同人设定字段: ${missing.slice(0, 5).join(', ')}`, 6000);
                return;
            }
            const content = buildFanficSettingsContent(values);
            const path = getFanficSettingsPath(tab.project, content, tab.project);
            const dir = path.substring(0, path.lastIndexOf('/'));
            const adapter = this.app.vault.adapter;
            if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
            await adapter.write(path, content);
            this.wizardStepResults[fanficResultKey] = content;
            new Notice(`✅ 同人设定已保存: ${path}`, 3000);
            this.renderTab(tab, true);
        });
        
        if (saved) {
            container.createEl('p', { text: '📝 已有暂存设定，修改后请重新保存。', attr: { style: 'color:var(--text-accent); font-size:0.8em; margin-top:8px;' } });
        }
    }

    async renderWizardSettingLibStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        const step = tab.steps[tab.currentStepIdx];
        const isDone = step.status === 'done';
        
        // 检查世界观是否已生成
        const wvFile = this.app.vault.getAbstractFileByPath(getWorldviewPath(tab.project));
        const hasWorldview = !!wvFile;
        
        container.createEl('p', { text: '从已生成的世界观中提炼结构化的设定库，供后续写作快速查阅。', attr: { style: 'color:var(--text-muted);' } });
        container.createEl('p', { text: '📚 包含模块：世界规则、力量体系、地理格局、势力格局、历史背景、特殊规则', attr: { style: 'color:var(--text-muted); font-size:0.85em;' } });
        
        if (!hasWorldview) {
            container.createEl('p', { text: '⚠️ 未检测到世界观总览，请先生成世界观再生成设定库。', attr: { style: 'color:var(--text-warning); font-weight:600; margin-top:12px;' } });
            return;
        }
        
        if (isDone) {
            const slFile = this.app.vault.getAbstractFileByPath(getSettingLibPath(tab.project));
            if (slFile) {
                container.createEl('p', { text: '✅ 设定库已生成。', attr: { style: 'color:var(--text-success); font-weight:600; margin-top:12px;' } });
                // v3.4.2: 内联查看 + 重新生成按钮
                const viewBtn = container.createEl('button', { 
                    text: '📖 查看设定库', 
                    attr: { style: 'margin:8px 12px 8px 0; padding:6px 14px; border-radius:6px; cursor:pointer; background:var(--background-modifier-border); border:1px solid var(--background-modifier-border);' } 
                });
                viewBtn.addEventListener('click', () => {
                    this.showFileContentInline(container, getSettingLibPath(tab.project), '设定库');
                });
                const regenBtn = container.createEl('button', { 
                    text: '🔄 重新生成', 
                    attr: { style: 'margin:8px 0; padding:6px 14px; background:#f59e0b; color:white; border:none; border-radius:6px; cursor:pointer;' } 
                });
                regenBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
            }
        }
        else {
            // v4.1: 未判定完成时，若设定库文件已存在也提供查看入口（此前仅 isDone 才渲染按钮）。
            const slFile = this.app.vault.getAbstractFileByPath(getSettingLibPath(tab.project));
            if (slFile) {
                container.createEl('p', { text: '📄 检测到设定库文件，内容可能尚未填写完整。', attr: { style: 'color:var(--text-accent); font-weight:600; margin-top:12px;' } });
                const viewBtn = container.createEl('button', {
                    text: '📖 查看设定库',
                    attr: { style: 'margin:8px 12px 8px 0; padding:6px 14px; border-radius:6px; cursor:pointer; background:var(--background-modifier-border); border:1px solid var(--background-modifier-border);' }
                });
                viewBtn.addEventListener('click', () => {
                    this.showFileContentInline(container, getSettingLibPath(tab.project), '设定库');
                });
                const regenBtn = container.createEl('button', {
                    text: '🔄 重新生成',
                    attr: { style: 'margin:8px 0; padding:6px 14px; background:#f59e0b; color:white; border:none; border-radius:6px; cursor:pointer;' }
                });
                regenBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
            }
        }
        
        container.createEl('p', { text: `目标项目: ${tab.project}`, attr: { style: 'margin-top:8px; color:var(--text-muted); font-size:0.85em;' } });
    }

    async renderWizardWritingStyleStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        const step = tab.steps[tab.currentStepIdx];
        const isDone = step.status === 'done';

        // v4.0: 文笔风格落盘于 04-世界观/文笔风格.md，兼容旧根目录路径
        const wsFile = await findWritingStyleFile(this.app, tab.project, { allowPlaceholder: true });
        const hasContent = !!wsFile;
        const wsPath = wsFile?.path ?? getWritingStylePath(tab.project);

        container.createEl('p', { text: '定义本项目的文笔风格、叙事特征和语言习惯。此步骤为手动设定，点击按钮后请在弹窗中保存。', attr: { style: 'color:var(--text-muted);' } });
        container.createEl('p', { text: '✍️ 包含 9 个模块：叙事视角、文笔特征、对话风格、描写风格、叙事节奏、情感表达、禁用/慎用、参考作品、格式要求', attr: { style: 'color:var(--text-muted); font-size:0.85em;' } });
        container.createEl('p', { text: '⚠️ 此步骤不可跳过，文笔风格是 AI 写作质量的核心保障。', attr: { style: 'color:var(--text-accent); font-size:0.85em;' } });
        
        if (hasContent && isDone) {
            container.createEl('p', { text: '✅ 文笔风格已设定。', attr: { style: 'color:var(--text-success); font-weight:600; margin-top:12px;' } });
            // v3.4.2: 内联查看 + 重新生成按钮
            const viewBtn = container.createEl('button', { 
                text: '📖 查看文笔风格', 
                attr: { style: 'margin:8px 12px 8px 0; padding:6px 14px; border-radius:6px; cursor:pointer; background:var(--background-modifier-border); border:1px solid var(--background-modifier-border);' } 
            });
            viewBtn.addEventListener('click', () => {
                this.showFileContentInline(container, wsPath, '文笔风格');
            });
            const regenBtn = container.createEl('button', { 
                text: '🔄 重新设定', 
                attr: { style: 'margin:8px 0; padding:6px 14px; background:#f59e0b; color:white; border:none; border-radius:6px; cursor:pointer;' } 
            });
            regenBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
        }
        else if (hasContent) {
            // v4.1: 文件已存在但内容未填写完整（仍是模板）。此前按钮被 isDone 门控导致完全不显示，
            // 这里补出「查看 / 编辑」入口，让用户可直接查看现有文件并打开设定窗口填写。
            container.createEl('p', { text: '📄 检测到文笔风格文件，但内容尚未填写完整。可查看现有内容或点击下方设定。', attr: { style: 'color:var(--text-accent); font-weight:600; margin-top:12px;' } });
            const viewBtn = container.createEl('button', {
                text: '📖 查看文笔风格',
                attr: { style: 'margin:8px 12px 8px 0; padding:6px 14px; border-radius:6px; cursor:pointer; background:var(--background-modifier-border); border:1px solid var(--background-modifier-border);' }
            });
            viewBtn.addEventListener('click', () => {
                this.showFileContentInline(container, wsPath, '文笔风格');
            });
            const editBtn = container.createEl('button', {
                text: '✍️ 设定文笔风格',
                attr: { style: 'margin:8px 0; padding:6px 14px; background:var(--text-accent); color:white; border:none; border-radius:6px; cursor:pointer;' }
            });
            editBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
        }
        
        container.createEl('p', { text: `目标项目: ${tab.project}`, attr: { style: 'margin-top:8px; color:var(--text-muted); font-size:0.85em;' } });
    }

    async renderWizardOutlineStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        container.empty();
        
        const step = tab.steps[tab.currentStepIdx];
        const isDone = step.status === 'done';
        
        container.createEl('p', { text: '基于已生成的世界观和实体设定，AI 将生成完整的分卷大纲，包括每卷的核心冲突和章节分配表。', attr: { style: 'color:var(--text-muted);' } });
        container.createEl('p', { text: '严格按照分卷大纲模板字段格式输出，确保批量建章能正确解析。', attr: { style: 'color:var(--text-muted); font-size:0.85em;' } });
        
        if (isDone) {
            container.createEl('p', { text: '✅ 全书规划已完成。', attr: { style: 'color:var(--text-success); font-weight:600; margin-top:12px;' } });
            // v3.4.2: 内联重新生成按钮
            const regenBtn = container.createEl('button', { 
                text: '🔄 重新规划', 
                attr: { style: 'margin:8px 12px 8px 0; padding:6px 14px; background:#f59e0b; color:white; border:none; border-radius:6px; cursor:pointer;' } 
            });
            regenBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
            // v4.1.0: 统一入口 — 大纲树状预览（含全文查看，替代旧的双按钮）
            const treeBtn = container.createEl('button', { 
                text: '📋 大纲树状预览', 
                attr: { style: 'margin:8px 0; padding:6px 14px; border-radius:6px; cursor:pointer; background:var(--text-accent); color:white; border:none; font-weight:600;' } 
            });
            treeBtn.addEventListener('click', () => {
                const modal = new ChapterOutlineTreeModal(this.app, this.plugin, tab.project);
                this.registerOutlineTreeModal(modal);
                modal.open();
            });
            // v3.4.6: 内联"下一步"按钮已下线 — 保留右下角 nav bar 唯一下一步入口
        } else {
            // v4.2: 未判定完成时，若分卷大纲文件已存在也提供树状预览入口。
            const existingOutline = await readMergedVolumeOutline(this.app, tab.project);
            if (existingOutline.trim().length > 0) {
                container.createEl('p', { text: '📄 检测到分卷大纲文件，内容可能尚未填写完整。', attr: { style: 'color:var(--text-accent); font-weight:600; margin-top:12px;' } });
                const treeBtn = container.createEl('button', {
                    text: '📋 大纲树状预览',
                    attr: { style: 'margin:8px 0; padding:6px 14px; border-radius:6px; cursor:pointer; background:var(--text-accent); color:white; border:none; font-weight:600;' }
                });
                treeBtn.addEventListener('click', () => {
                    const modal = new ChapterOutlineTreeModal(this.app, this.plugin, tab.project);
                    this.registerOutlineTreeModal(modal);
                    modal.open();
                });
            } else {
                container.createEl('p', { text: '点击下方"▶ 执行"按钮打开全书规划窗口。', attr: { style: 'margin-top:12px;' } });
            }
        }
    }

    async renderWizardChaptersStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        container.empty();
        
        const step = tab.steps[tab.currentStepIdx];
        const isDone = step.status === 'done';
        
        container.createEl('p', { text: '根据分卷大纲自动批量创建所有章节目录和文件（大纲摘要、正文、信息规划）。', attr: { style: 'color:var(--text-muted);' } });
        container.createEl('p', { text: '⚠️ 请确保已先完成"全书规划"步骤，否则无法解析卷结构。', attr: { style: 'color:var(--text-accent); font-size:0.85em;' } });
        
        if (isDone) {
            const bodyRoot = `${tab.project}/${SUBDIR_BODY_ROOT}`;
            const chapterFiles = this.app.vault.getFiles().filter(f =>
                f.path.startsWith(bodyRoot + '/')
                && /\/第\d+卷\/第\d+章[^/]*_正文\.md$/.test(f.path)
            );
            container.createEl('p', { text: `✅ 已创建 ${chapterFiles.length} 个章节文件。`, attr: { style: 'color:var(--text-success); font-weight:600; margin-top:12px;' } });
            // v3.4.2: 内联重新生成按钮
            const regenBtn = container.createEl('button', { 
                text: '🔄 重新建章', 
                attr: { style: 'margin:8px 12px 8px 0; padding:6px 14px; background:#f59e0b; color:white; border:none; border-radius:6px; cursor:pointer;' } 
            });
            regenBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
            // v3.4.6: 内联"下一步"按钮已下线 — 保留右下角 nav bar 唯一下一步入口
        } else {
            container.createEl('p', { text: '点击下方"▶ 执行"按钮打开批量建章窗口。', attr: { style: 'margin-top:12px;' } });
        }
    }

    async renderWizardCompleteStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        container.empty();
        
        container.createEl('h3', { text: '🎉 项目初始化完成！' });
        container.createEl('p', { text: `项目名称: ${tab.project}`, attr: { style: 'color:var(--text-muted); font-size:1.1em;' } });
        
        const summary = container.createDiv({ attr: { style: 'margin-top:20px; padding:16px; background:var(--background-primary-alt); border-radius:8px;' } });
        summary.createEl('h4', { text: '📊 项目统计', attr: { style: 'margin:0 0 12px 0;' } });
        
        const adapter = this.app.vault.adapter;
        const stats: Array<{ label: string; status: string; detail: string }> = [];
        
        // 世界观
        const worldviewExists = await adapter.exists(getWorldviewPath(tab.project));
        stats.push({ label: '世界观', status: worldviewExists ? '✅' : '❌', detail: worldviewExists ? '已生成' : '未生成' });
        
        // 实体统计
        const countFiles = async (subDir: string): Promise<number> => {
            const path = `${tab.project}/${subDir}`;
            if (!(await adapter.exists(path))) return 0;
            const list = await adapter.list(path);
            return list.files.filter(f => f.endsWith('.md')).length;
        };
        
        const charCount = await countFiles(SUBDIR_CHARS);
        const locCount = await countFiles(SUBDIR_LOCS);
        const factionCount = await countFiles(SUBDIR_FACTIONS);
        const itemCount = await countFiles(SUBDIR_ITEMS);
        
        stats.push({ label: '人物', status: charCount > 0 ? '✅' : '⚠️', detail: `${charCount} 个` });
        stats.push({ label: '地点', status: locCount > 0 ? '✅' : '⚠️', detail: `${locCount} 个` });
        stats.push({ label: '势力', status: factionCount > 0 ? '✅' : '⚠️', detail: `${factionCount} 个` });
        stats.push({ label: '物品功法', status: itemCount > 0 ? '✅' : '⚠️', detail: `${itemCount} 个` });
        
        // 分卷大纲（v4.0：按卷归档，合并读取后统计卷数）
        const outlineContent = await readMergedVolumeOutline(this.app, tab.project);
        const outlineExists = outlineContent.trim().length > 0;
        let volumeCount = 0;
        if (outlineExists) {
            const volMatches = outlineContent.match(/###\s+第\d+卷/g);
            volumeCount = volMatches ? volMatches.length : 0;
        }
        stats.push({ label: '分卷大纲', status: outlineExists ? '✅' : '❌', detail: outlineExists ? `${volumeCount} 卷` : '未生成' });
        
        const baseDir = `${tab.project}/${SUBDIR_BODY_ROOT}`;
        let chapterCount = 0;
        if (await adapter.exists(baseDir)) {
            const baseList = await adapter.list(baseDir);
            const volumeDirs = baseList.folders.filter(f => /\/第\d+卷$/.test(f));
            for (const volDir of volumeDirs) {
                const volList = await adapter.list(volDir);
                chapterCount += volList.files.filter(f => /\/第\d+章[^/]*_正文\.md$/.test(f)).length;
            }
        }
        stats.push({ label: '章节', status: chapterCount > 0 ? '✅' : '❌', detail: `${chapterCount} 章` });
        
        const table = summary.createEl('table', { attr: { style: 'width:100%; border-collapse:collapse;' } });
        for (const s of stats) {
            const row = table.createEl('tr');
            row.createEl('td', { text: s.label, attr: { style: 'padding:6px 8px; border-bottom:1px solid var(--background-modifier-border); font-weight:600;' } });
            row.createEl('td', { text: `${s.status} ${s.detail}`, attr: { style: 'padding:6px 8px; border-bottom:1px solid var(--background-modifier-border);' } });
        }
        
        container.createEl('p', { text: '点击下方"🎯 进入写作界面"开始写作。', attr: { style: 'margin-top:16px; color:var(--text-accent); font-weight:600;' } });
    }

    async renderWizardEntitiesStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        container.empty();

        // 实体生成弹窗关闭后刷新子步骤状态
        if (this.plugin._entityModalJustClosed) {
            this.plugin._entityModalJustClosed = false;
            this.renderTab(tab, true);
            return;
        }

        const step = tab.steps[tab.currentStepIdx];
        container.createEl('p', { text: '此步骤可选。点击下方按钮打开对应的实体生成窗口。', attr: { style: 'color:var(--text-muted);' } });

        const toolBar = container.createDiv({ cls: 'nw-wizard-toolbar' });

        const overviewBtn = toolBar.createEl('button', {
            text: '📖 查看实体概览',
            attr: { style: 'padding:6px 16px; background:var(--background-modifier-border); border:1px solid var(--background-modifier-border); border-radius:6px; cursor:pointer; font-size:0.9em;' }
        });
        overviewBtn.addEventListener('click', () => {
            new EntityOverviewModal(this.app, this.plugin, tab.project).open();
        });

        const mkMgrBtn = (label: string, folder: string, displayLabel: string) => {
            const b = toolBar.createEl('button', {
                text: label,
                attr: { style: 'padding:6px 12px; background:var(--background-secondary); border:1px solid var(--background-modifier-border); border-radius:6px; cursor:pointer; font-size:0.85em;' }
            });
            b.addEventListener('click', () => {
                new ExistingEntityManagerModal(this.app, this.plugin, tab.project, folder, displayLabel).open();
            });
        };
        mkMgrBtn('📂 管理人物', SUBDIR_CHARS, '👤 人物');
        mkMgrBtn('📂 管理地点', SUBDIR_LOCS, '📍 地点');
        mkMgrBtn('📂 管理势力', SUBDIR_FACTIONS, '🏰 势力');
        mkMgrBtn('📂 管理物品', SUBDIR_ITEMS, '⚔️ 物品功法');
        
        const entityConfig = [
            { id: 'characters', label: '人物', desc: '生成主要角色卡（含 frontmatter 字段和设定章节）', icon: '👤', commandId: 'novel-writer-character' },
            { id: 'locations', label: '地点', desc: '生成故事场景地点设定', icon: '📍', commandId: 'novel-writer-location' },
            { id: 'factions', label: '势力', desc: '生成各方势力组织设定', icon: '🏰', commandId: 'novel-writer-faction' },
            { id: 'items', label: '物品功法', desc: '生成关键物品和功法设定', icon: '⚔️', commandId: 'novel-writer-item' },
        ];
        
        for (const cfg of entityConfig) {
            const subStep = step.subSteps?.find(s => s.id === cfg.id);
            const isDone = subStep?.status === 'done' || subStep?.status === 'skipped';
            
            const row = container.createDiv({ cls: 'nw-wizard-entity-row', attr: { style: isDone ? 'opacity:0.6;' : '' } });
            const info = row.createDiv();
            info.createSpan({ text: `${cfg.icon} ${cfg.label}`, attr: { style: 'font-weight:600;' } });
            info.createEl('span', { text: ` — ${cfg.desc}`, attr: { style: 'color:var(--text-muted); font-size:0.8em;' } });
            
            const actions = row.createDiv({ attr: { style: 'display:flex; gap:6px;' } });
            
            if (isDone) {
                actions.createSpan({ text: subStep?.status === 'done' ? '✅ 已生成' : '⏭ 已跳过', attr: { style: 'color:var(--text-muted); font-size:0.8em; margin-right:6px;' } });
                // v3.4.1: done 后仍可继续生成，不锁按钮
                const regenBtn = actions.createEl('button', { 
                    text: '继续生成', 
                    attr: { style: 'padding:4px 10px; background:var(--text-accent); color:white; border:none; border-radius:4px; cursor:pointer; font-size:0.8em; opacity:0.8;' } 
                });
                regenBtn.addEventListener('click', () => {
                    this.plugin._pendingEntityProject = tab.project;
                    this.plugin._pendingEntityContext = { project: tab.project, isEarlyStage: true };
                    this.plugin.executeCommand(cfg.commandId);
                    new Notice(`${cfg.label}生成窗口已打开`, 2000);
                    // 重置子步骤状态，这样下次渲染会显示生成按钮
                    if (subStep && subStep.status === 'done') subStep.status = 'pending';
                    // v3.4.3: 跳过 auto-advance — 实体子步骤可重复生成
                    this.renderTab(tab, true);
                });
            } else {
                const genBtn = actions.createEl('button', { 
                    text: '生成', 
                    attr: { style: 'padding:4px 14px; background:var(--text-accent); color:white; border:none; border-radius:4px; cursor:pointer; font-size:0.85em;' } 
                });
                genBtn.addEventListener('click', () => {
                    // 传递当前项目名给 Modal，让它自动预选
                    this.plugin._pendingEntityProject = tab.project;
                    this.plugin._pendingEntityContext = { project: tab.project, isEarlyStage: true };
                    this.plugin.executeCommand(cfg.commandId);
                    new Notice(`${cfg.label}生成窗口已打开`, 2000);
                    // 不提前标记完成，用户关闭 Modal 后重新进入此页面即可看到结果
                    // v3.4.3: 跳过 auto-advance — 实体子步骤可重复生成
                    this.renderTab(tab, true);
                });
                
                const skipBtn = actions.createEl('button', { 
                    text: '跳过', 
                    attr: { style: 'padding:4px 10px; background:var(--background-secondary); border:1px solid var(--background-modifier-border); border-radius:4px; cursor:pointer; font-size:0.85em;' } 
                });
                skipBtn.addEventListener('click', () => {
                    if (subStep) subStep.status = 'skipped';
                    const allDone = (step.subSteps || []).every(s => s.status === 'done' || s.status === 'skipped');
                    if (allDone) step.status = 'done';
                    // v3.4.3: 跳过 auto-advance — 用户显式跳过实体子步骤
                    this.renderTab(tab, true);
                });
            }
        }
        
        container.createEl('p', { text: '💡 跳过将影响后续全书规划的质量，建议至少生成人物。', attr: { style: 'color:var(--text-muted); font-size:0.8em; margin-top:12px;' } });

        const tip = container.createEl('p', { 
            text: '💡 「管理已生成」可批量改名磁盘上的"未命名_N"文件（联动 YAML名称 + H1标题 + 文件名三处）',
            attr: { style: 'color:var(--text-muted); font-size:0.78em; margin-top:8px;' }
        });
    }

    async renderWizardWorldviewStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        container.empty();
        
        const step = tab.steps[tab.currentStepIdx];
        const isDone = step.status === 'done';
        const isExecuting = this.wizardStepExecuting.has(step.id);
        const progress = this.wizardStepResults['_worldviewProgress'] || '';
        
        container.createEl('p', { text: `AI 将严格按照模板字段格式生成世界观。包含 ${WV_SECTIONS.length} 个模块：${WV_SECTIONS.join('、')}。`, attr: { style: 'color:var(--text-muted);' } });
        container.createEl('p', { text: '⚠️ 此步骤不可跳过，完整的世界观设定是后续所有步骤的基础。', attr: { style: 'color:var(--text-accent); font-size:0.85em;' } });
        
        container.createEl('p', { text: `目标项目: ${tab.project}`, attr: { style: 'margin-top:8px; color:var(--text-muted); font-size:0.85em;' } });
        
        if (isExecuting && progress) {
            const progressEl = container.createDiv({ attr: { style: 'margin-top:16px; padding:12px; background:var(--background-primary-alt); border-radius:8px;' } });
            progressEl.createEl('span', { text: `⏳ ${progress}`, attr: { style: 'font-weight:600;', 'data-wv-progress': '' } });
            const progBar = progressEl.createDiv({ attr: { style: 'margin-top:8px; height:6px; background:var(--background-modifier-border); border-radius:3px; overflow:hidden;' } });
            progBar.createDiv({ attr: { style: 'height:100%; width:60%; background:var(--text-accent); animation: nw-progress-anim 2s ease-in-out infinite;' } });
        }
        
        if (isDone) {
            // v3.4.2: isDone 即显示完成态，不依赖 wizardStepResults（文件可能是预先存在的）
            let worldviewContent = this.wizardStepResults['worldview'] || '';
            if (!worldviewContent) {
                // 从文件恢复（文件在开向导前已存在）
                try {
                    const wvFile = this.app.vault.getAbstractFileByPath(getWorldviewPath(tab.project));
                    if (wvFile instanceof TFile) { worldviewContent = await this.app.vault.read(wvFile); this.wizardStepResults['worldview'] = worldviewContent; }
                } catch (e) { /* 忽略 */ }
            }
            
            container.createEl('p', { text: '✅ 世界观已生成。', attr: { style: 'color:var(--text-success); font-weight:600; margin-top:12px;' } });
            
            // v3.4.2: 内联重新生成按钮（不依赖导航栏）
            const regenBtn = container.createEl('button', { 
                text: '🔄 重新生成世界观', 
                attr: { style: 'margin:8px 12px 8px 0; padding:6px 14px; background:#f59e0b; color:white; border:none; border-radius:6px; cursor:pointer; font-size:0.9em;' } 
            });
            regenBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
            
            const viewBtn = container.createEl('button', { 
                text: '📖 打开世界观文件', 
                attr: { style: 'margin:8px 0; padding:6px 14px; border-radius:6px; cursor:pointer; background:var(--background-modifier-border); border:1px solid var(--background-modifier-border);' } 
            });
            viewBtn.addEventListener('click', () => {
                this.showFileContentInline(container, getWorldviewPath(tab.project), '世界观设定');
            });
            
            // Show module summary (only if we have content)
            if (worldviewContent) {
                const sections = ['世界层级体系', '力量体系', '货币体系', '势力分类', '地理格局', '历史大事记', '特殊规则'];
                const summaryDiv = container.createDiv({ attr: { style: 'margin-top:8px; font-size:0.8em; color:var(--text-muted);' } });
                summaryDiv.createEl('p', { text: '已生成模块：' });
                for (const s of sections) {
                    const found = worldviewContent.includes(`## ${s}`);
                    summaryDiv.createSpan({ text: `${found ? '✅' : '❌'} ${s}  ` });
                }
            }
        }
        else {
            // v4.1: 未判定完成时，若世界观文件已存在也提供查看 / 重新生成入口。
            const wvFile = this.app.vault.getAbstractFileByPath(getWorldviewPath(tab.project));
            if (wvFile) {
                container.createEl('p', { text: '📄 检测到世界观文件，内容可能尚未填写完整。', attr: { style: 'color:var(--text-accent); font-weight:600; margin-top:12px;' } });
                const viewBtn = container.createEl('button', {
                    text: '📖 打开世界观文件',
                    attr: { style: 'margin:8px 12px 8px 0; padding:6px 14px; border-radius:6px; cursor:pointer; background:var(--background-modifier-border); border:1px solid var(--background-modifier-border);' }
                });
                viewBtn.addEventListener('click', () => {
                    this.showFileContentInline(container, getWorldviewPath(tab.project), '世界观设定');
                });
                const regenBtn = container.createEl('button', {
                    text: '🔄 重新生成世界观',
                    attr: { style: 'margin:8px 0; padding:6px 14px; background:#f59e0b; color:white; border:none; border-radius:6px; cursor:pointer;' }
                });
                regenBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
            }
        }
    }
}
