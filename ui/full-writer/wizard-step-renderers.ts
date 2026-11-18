/**
 * 向导步骤渲染器（v3.4.x 向导 UI 外迁）
 *
 * 从 FullWriterView 外迁的纯 UI 渲染方法。控制器持有共享的
 * wizardStepResults / wizardStepExecuting 引用（与 view 同一对象），
 * 以及 app / plugin 与 view 回调（showFileContentInline /
 * executeWizardStep / renderTab）。
 */
import { App, Notice, TFile } from 'obsidian';
import { t } from '@/i18n';
import NovelWriterPlugin from '@/main';
import { WizardTab, WizardStep } from './wizard-types';
import {
    countVolumeHeadings,
    resolveCountStatus,
    resolveExistsStatus,
    resolveSetupStatusIcon,
} from './wizard-step-logic';
import { getWorldviewPath, getSettingLibPath, getWritingStylePath, pjProjectMeta, pjFanficDir, readProjectMeta, SUBDIR_CHARS, SUBDIR_LOCS, SUBDIR_FACTIONS, SUBDIR_ITEMS, SUBDIR_BODY_ROOT } from '@/shared/paths';
import { findWritingStyleFile } from '@/ui/writing-style-paths';
import { ChapterOutlineTreeModal } from '@/ui/chapter-outline-tree-modal';
import { openPlotCanvas } from '@/ui/plot-canvas-modal';
import { UnifiedEntityManagerModal } from '@/ui/unified-entity-manager-modal';
import { readMergedVolumeOutline } from '@/utils/helpers';
import { WV_SECTIONS, SL_SECTIONS } from '@/shared/format-constants';
import { attachFanficPathToProject, buildFanficSettingsContent, getFanficSettingsPath, isFanficSettingsContentValidEnough, missingFanficValueLabels, type FanficSettingsValues } from './fanfic-settings-utils';
import { extractFanficRuleValue, parseProjectMeta } from '@/shared/fanfic-rules';
import { listFanficSettingCandidates } from '@/shared/fanfic-binding';
import { getStoryStructure, getStructureStageSummary, getStoryOptionLabel, parseStorySettingsFromProjectMeta } from '@/shared/story-structure';
import { StorySettingsModal } from '@/ui/story-settings-modal';

import { writeVaultText } from '@/shared/file-system-port';
import { showErrorNotice, showSuccessNotice, showWarningNotice } from '@/ui/components/notice-helpers';
/**
 * 创作向导各步骤渲染器。
 */
export class WizardStepRenderers {
    private wizardStepResults: Record<string, string>;
    private wizardStepExecuting: Set<string>;
    private app: App;
    private plugin: NovelWriterPlugin;
    private showFileContentInline: (container: HTMLElement, filePath: string, title: string) => Promise<void>;
    private executeWizardStep: (tab: WizardTab, step: WizardStep) => Promise<void>;
    private renderTab: (tab: WizardTab, skipAutoAdvance?: boolean) => void;
    private registerOutlineTreeModal: (modal: ChapterOutlineTreeModal) => void;
    // 实体子步骤执行中标记（按分类隔离，避免打开一个人物窗口就禁用全部按钮）
    private entitiesExecuting: Set<string> = new Set();

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

    /**
     * 渲染故事结构步骤。
     *
     * @param container - 容器元素
     * @param tab - 页签
     */
    async renderWizardStoryStructureStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        container.empty();
        let settings = null;
        try {
            // `.project` 是点文件，getAbstractFileByPath 恒为 null（见 shared/paths.ts v31），
            // 原实现导致「故事结构」卡片永远显示「先确定故事结构」，已保存的结构不显示。
            const meta = await readProjectMeta(this.app, tab.project);
            if (meta !== null) {
                settings = parseStorySettingsFromProjectMeta(meta);
            }
        } catch { /* silent-ok: 渲染路径只读展示，解析异常按未配置展示；写盘与校验路径另有错误提示，且校验侧会拦下未配置 */ }

        const card = container.createDiv({ cls: 'nw-wizard-story-structure' });
        if (!settings) {
            card.createEl('h4', { text: t('cowrite.wiz.structureTitle') });
            card.createEl('p', {
                text: t('cowrite.wiz.structureDesc'),
                cls: 'nw-text-12-muted',
            });
        } else {
            const structure = getStoryStructure(settings.structureId);
            const head = card.createDiv({ cls: 'nw-wizard-story-head' });
            head.createEl('h4', { text: `${structure.icon} ${structure.name}` });
            head.createEl('span', { text: getStructureStageSummary(structure.id), cls: 'nw-wizard-story-stages' });
            card.createEl('p', { text: structure.description, cls: 'nw-text-12-muted' });
            const grid = card.createDiv({ cls: 'nw-wizard-story-settings' });
            const fields: Array<[string, string]> = [
                [t('cowrite.wiz.optProtagonistStart'), getStoryOptionLabel('protagonistStart', settings.protagonistStart)],
                [t('cowrite.wiz.optCoreConflict'), getStoryOptionLabel('coreConflict', settings.coreConflict)],
                [t('cowrite.wiz.optPowerSystem'), getStoryOptionLabel('powerSystem', settings.powerSystem)],
                [t('cowrite.wiz.optGoldenFinger'), getStoryOptionLabel('goldenFinger', settings.goldenFinger)],
                [t('cowrite.wiz.optArchetype'), getStoryOptionLabel('archetype', settings.archetype)],
                [t('cowrite.wiz.optTemperament'), getStoryOptionLabel('temperament', settings.temperament)],
                [t('cowrite.wiz.optTone'), getStoryOptionLabel('tone', settings.tone)],
                [t('cowrite.wiz.optPacing'), getStoryOptionLabel('pacing', settings.pacing)],
            ];
            for (const [label, value] of fields) {
                const item = grid.createDiv({ cls: 'nw-wizard-story-setting' });
                item.createSpan({ text: label, cls: 'nw-wizard-story-setting-label' });
                item.createSpan({ text: value, cls: 'nw-wizard-story-setting-value' });
            }
            if (settings.oneLineStory) {
                card.createDiv({ text: settings.oneLineStory, cls: 'nw-wizard-story-oneline' });
            }
        }

        const editBtn = card.createEl('button', {
            text: settings ? t('cowrite.wiz.editStructureBtn') : t('cowrite.wiz.configStructureBtn'),
            cls: 'nw-btn nw-btn-primary',
            attr: { type: 'button' },
        });
        editBtn.onclick = () => {
            const modal = new StorySettingsModal(this.app, this.plugin, tab.project, () => {
                const step = tab.steps.find(s => s.id === 'story_structure');
                if (step) step.status = 'done';
                this.renderTab(tab, true);
            });
            modal.open();
        };
    }

    /**
     * 渲染同人设定步骤。
     *
     * @param container - 容器元素
     * @param tab - 页签
     */
    async renderWizardFanficStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        container.empty();
        
        // 如果已执行过，恢复表单数据
        const fanficResultKey = `fanfic:${tab.project}`;
        let saved = this.wizardStepResults[fanficResultKey] || '';
        // 通过「同人设定库」工具生成后，内存里没有暂存，改从 .project 记录路径回读
        if (!saved.trim()) {
            // `.project` 是点文件，必须走 adapter（getAbstractFileByPath 恒为 null）
            const meta = await readProjectMeta(this.app, tab.project);
            if (meta !== null) {
                try {
                    const path = parseProjectMeta(meta).fanficPath;
                    const fanficFile = path ? this.app.vault.getAbstractFileByPath(path) : null;
                    if (fanficFile instanceof TFile) {
                        saved = await this.app.vault.read(fanficFile);
                        this.wizardStepResults[fanficResultKey] = saved;
                    }
                } catch { /* 读取失败时保持空表单 */ }
            }
        }
        const getSaved = (key: string): string => {
            const m = saved.match(new RegExp(`${key}:\\s*(.+)`));
            return m ? m[1].trim() : '';
        };
        
        container.createEl('p', { text: t('cowrite.wiz.fanficWarn'), cls: 'nw-wizard-warn-box' });

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
            const group = form.createDiv({ cls: type === 'textarea' ? 'nw-wizard-field-group nw-wizard-field-group--full' : 'nw-wizard-field-group' });
            group.createEl('label', { text: label, cls: 'nw-wizard-field-label' });
            const input = type === 'textarea'
                ? group.createEl('textarea', { cls: 'nw-wizard-textarea' })
                : group.createEl('input', { cls: 'nw-wizard-field' });
            
            // 三条创作规则只写在正文（`- **字段**：…`），frontmatter 里没有，
            // 必须走正文解析，否则绑定/生成后再进向导时规则框永远为空，保存会覆盖成空。
            (input as HTMLTextAreaElement).value = type === 'textarea'
                ? extractFanficRuleValue(saved, key) || getSaved(key)
                : getSaved(key);
            // 任何输入变动自动暂存，确保"执行"按钮能拿到最新数据
            input.addEventListener('input', () => { this.wizardStepResults[fanficResultKey] = collectFanficContent(); });
            return input;
        };
        
        addField(t('cowrite.wiz.fWorkName'), '作品名称');
        addField(t('cowrite.wiz.fWorkType'), '作品类型');
        addField(t('cowrite.wiz.fAuthor'), '作者');
        addField(t('cowrite.wiz.fWorldviewType'), '世界观类型');
        addField(t('cowrite.wiz.fPowerSystem'), '力量体系');
        addField(t('cowrite.wiz.fCoreRules'), '核心规则');
        addField(t('cowrite.wiz.fMustFollow'), '必须遵守的原作规则', 'textarea');
        addField(t('cowrite.wiz.fAllowedAdapt'), '允许改编的范围', 'textarea');
        addField(t('cowrite.wiz.fForbidden'), '禁止触及的红线', 'textarea');
        
        // Save button
        const saveBtn = container.createEl('button', { 
            text: t('cowrite.wiz.saveFanficBtn'), 
            cls: 'nw-wizard-secondary-btn nw-wizard-secondary-btn--mt12' 
        });
        saveBtn.addEventListener('click', async () => {
            const values = collectFanficValues();
            const missing = missingFanficValueLabels(values);
            if (missing.length > 0) {
                new Notice(t('cowrite.wiz.fanficMissing', { fields: missing.slice(0, 5).join(', ') }), 6000);
                return;
            }
            const content = buildFanficSettingsContent(values);
            const path = getFanficSettingsPath(tab.project, content, tab.project);
            await writeVaultText(this.app, path, content);
            await attachFanficPathToProject(this.app, tab.project, path);
            this.wizardStepResults[fanficResultKey] = content;
            showSuccessNotice(t('cowrite.wiz.fanficSaved', { path }), { timeout: 3000 });
            this.renderTab(tab, true);
        });
        
        if (saved) {
            container.createEl('p', { text: t('cowrite.wiz.draftExists'), cls: 'nw-wizard-hint nw-wizard-hint--accent' });
        }

        // 已存在设定文件（手写/拷入/旧项目遗留）时提供绑定入口：此前只能逐字段重填或手改 .project
        const candidates = await this.listFanficCandidates(tab.project);
        if (candidates.length > 0) {
            const bindBox = container.createDiv({ cls: 'nw-wizard-bind-box' });
            bindBox.createEl('p', {
                text: t('cowrite.wiz.bindHint'),
                cls: 'nw-wizard-bind-note'
            });
            const select = bindBox.createEl('select', { cls: 'nw-wizard-field' });
            for (const candidate of candidates) {
                select.createEl('option', { text: `${candidate.name}（${candidate.path}）`, value: candidate.path });
            }
            const bindBtn = bindBox.createEl('button', {
                text: t('cowrite.wiz.bindBtn'),
                cls: 'nw-wizard-secondary-btn nw-wizard-secondary-btn--mt8'
            });
            bindBtn.addEventListener('click', async () => {
                const path = select.value;
                const file = this.app.vault.getAbstractFileByPath(path);
                if (!(file instanceof TFile)) {
                    showErrorNotice(t('cowrite.wiz.fileMissing'), { timeout: 6000 });
                    return;
                }
                let content = '';
                try {
                    content = await this.app.vault.read(file);
                } catch {
                    showErrorNotice(t('cowrite.wiz.readFailed'), { timeout: 6000 });
                    return;
                }
                if (!content.trim()) {
                    new Notice(t('cowrite.wiz.emptyFile'), 6000);
                    return;
                }
                await attachFanficPathToProject(this.app, tab.project, path);
                this.wizardStepResults[fanficResultKey] = content;
                const check = isFanficSettingsContentValidEnough(content);
                if (check.valid) {
                    showSuccessNotice(t('cowrite.wiz.bound', { path }), { timeout: 8000 });
                } else {
                    showWarningNotice(t('cowrite.wiz.boundMissing', { path, fields: check.missingFields.slice(0, 5).join('、') }), { timeout: 8000 });
                }
                this.renderTab(tab, true);
            });
        }
    }

    /** 本项目同人设定库 + 全局同人设定库下的 Markdown 候选（排除当前已绑定文件） */
    private async listFanficCandidates(project: string): Promise<{ path: string; name: string }[]> {
        let currentPath = '';
        // `.project` 是点文件，必须走 adapter；否则 currentPath 恒为空，
        // 已绑定的同人设定会再次出现在候选列表里。
        const meta = await readProjectMeta(this.app, project);
        if (meta !== null) {
            try {
                currentPath = parseProjectMeta(meta).fanficPath;
            } catch { /* 元信息读取失败时按「未绑定」处理 */ }
        }
        return listFanficSettingCandidates(
            this.app.vault.getMarkdownFiles().map(file => file.path),
            [pjFanficDir(project), '元文件/05-同人设定库'],
            currentPath,
        );
    }

    /**
     * 渲染设定库步骤。
     *
     * @param container - 容器元素
     * @param tab - 页签
     */
    async renderWizardSettingLibStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        const step = tab.steps[tab.currentStepIdx];
        const isDone = step.status === 'done';
        const isRetry = step.status === 'retry';
        const isExecuting = this.wizardStepExecuting.has(step.id);
        
        // 检查世界观是否已生成
        const wvFile = this.app.vault.getAbstractFileByPath(getWorldviewPath(tab.project));
        const hasWorldview = !!wvFile;

        // 从文件恢复设定库缓存（文件在开向导前已存在）
        if (!this.wizardStepResults['setting_lib']) {
            const slFile = this.app.vault.getAbstractFileByPath(getSettingLibPath(tab.project));
            if (slFile instanceof TFile) {
                try {
                    const slContent = await this.app.vault.read(slFile);
                    if (slContent.trim().length > 0) {
                        this.wizardStepResults['setting_lib'] = slContent;
                    }
                } catch (e) { /* 忽略 */ }
            }
        }

        // 从文件恢复世界观缓存
        if (!this.wizardStepResults['worldview'] && wvFile instanceof TFile) {
            try {
                const wvContent = await this.app.vault.read(wvFile);
                if (wvContent.trim().length > 0) {
                    this.wizardStepResults['worldview'] = wvContent;
                }
            } catch (e) { /* 忽略 */ }
        }
        
        container.createEl('p', { text: '从已生成的世界观中提炼结构化的设定库，供后续写作快速查阅。', cls: 'nw-wizard-note' });
        
        // 动态检测设定库文件中的模块：扫描 ## 一、xxx 格式的标题行
        const slFile = this.app.vault.getAbstractFileByPath(getSettingLibPath(tab.project));
        let detectedModules: string[] = [];
        if (slFile instanceof TFile) {
            try {
                const slContent = await this.app.vault.read(slFile);
                // 匹配 ## 一、模块名 到 ## 八、模块名
                const moduleRegex = /^##\s+[一二三四五六七八]、(.+)$/gm;
                let match;
                while ((match = moduleRegex.exec(slContent)) !== null) {
                    detectedModules.push(match[1].trim());
                }
                // 兼容无数字前缀的格式（## 模块名）
                if (detectedModules.length === 0) {
                    for (const section of SL_SECTIONS) {
                        const secRegex = new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm');
                        if (secRegex.test(slContent)) {
                            detectedModules.push(section);
                        }
                    }
                }
            } catch { /* ignore */ }
        }
        
        // 显示模块信息
        if (detectedModules.length > 0) {
            container.createEl('p', { 
                text: t('cowrite.wiz.slGenerated', { count: detectedModules.length, modules: detectedModules.join('、') }), 
                cls: 'nw-wizard-note nw-wizard-note--sm' 
            });
        } else {
            container.createEl('p', { 
                text: t('cowrite.wiz.slContains', { count: SL_SECTIONS.length, modules: SL_SECTIONS.join('、') }), 
                cls: 'nw-wizard-note nw-wizard-note--sm' 
            });
        }
        
        if (!hasWorldview) {
            container.createEl('p', { text: t('cowrite.wiz.noWorldview'), cls: 'nw-wizard-status nw-wizard-status--warning' });
            return;
        }
        
        // v4.5: 通用按钮工厂，复用 isExecuting 处理
        const makeViewBtn = () => {
            const viewBtn = container.createEl('button', {
                text: t('cowrite.wiz.viewSettingLib'),
                cls: 'nw-wizard-file-btn'
            });
            viewBtn.addEventListener('click', () => {
                this.showFileContentInline(container, getSettingLibPath(tab.project), '设定库');
            });
            return viewBtn;
        };
        
        const makeRegenBtn = () => {
            const regenBtn = container.createEl('button', {
                text: isExecuting ? t('cowrite.generating') : t('cowrite.wiz.regenerate'),
                cls: 'nw-wizard-warn-btn'
            });
            if (isExecuting) {
                regenBtn.addClass('nw-disabled-look');
            } else {
                regenBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
            }
            return regenBtn;
        };
        
        // 执行中状态统一处理
        if (isExecuting) {
            container.createEl('p', { text: t('cowrite.wiz.slGenerating'), cls: 'nw-wizard-status nw-wizard-status--accent' });
            // 执行中显示禁用按钮 + 动画进度条
            makeViewBtn();
            const disabledBtn = makeRegenBtn();
            disabledBtn.textContent = t('cowrite.generating');
            // 添加脉冲动画进度条
            const barTrack = container.createDiv({ cls: 'nw-wizard-progress-track' });
            barTrack.createDiv({ cls: 'nw-wizard-progress-bar' });
            container.createEl('p', { text: t('cowrite.wiz.targetProject', { project: tab.project }), cls: 'nw-wizard-target' });
            return;
        }
        
        if (isDone) {
            if (slFile) {
                container.createEl('p', { text: t('cowrite.wiz.slDone'), cls: 'nw-wizard-status nw-wizard-status--success' });
                makeViewBtn();
                makeRegenBtn();
            }
        }
        else if (isRetry) {
            container.createEl('p', { text: t('cowrite.wiz.slFailed'), cls: 'nw-wizard-status nw-wizard-status--error' });
            if (slFile) {
                container.createEl('p', { text: t('cowrite.wiz.slPartialView'), cls: 'nw-wizard-status nw-wizard-status--accent nw-wizard-status--sm' });
                makeViewBtn();
            }
            makeRegenBtn();
        }
        else {
            if (slFile) {
                container.createEl('p', { text: t('cowrite.wiz.slPartial'), cls: 'nw-wizard-status nw-wizard-status--accent' });
                makeViewBtn();
                makeRegenBtn();
            }
        }
        
        container.createEl('p', { text: t('cowrite.wiz.targetProject', { project: tab.project }), cls: 'nw-wizard-target' });
    }

    /**
     * 渲染文笔风格步骤。
     *
     * @param container - 容器元素
     * @param tab - 页签
     */
    async renderWizardWritingStyleStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        const step = tab.steps[tab.currentStepIdx];
        const isDone = step.status === 'done';

        // v4.0: 文笔风格落盘于 04-世界观/文笔风格.md，兼容旧根目录路径
        const wsFile = await findWritingStyleFile(this.app, tab.project, { allowPlaceholder: true });
        const hasContent = !!wsFile;
        const wsPath = wsFile?.path ?? getWritingStylePath(tab.project);

        container.createEl('p', { text: t('cowrite.wiz.styleNote'), cls: 'nw-wizard-note' });
        container.createEl('p', { text: t('cowrite.wiz.styleModules'), cls: 'nw-wizard-note nw-wizard-note--sm' });
        container.createEl('p', { text: t('cowrite.wiz.styleWarn'), cls: 'nw-wizard-warn-text' });
        
        if (hasContent && isDone) {
            container.createEl('p', { text: t('cowrite.wiz.styleDone'), cls: 'nw-wizard-status nw-wizard-status--success' });
            // v3.4.2: 内联查看 + 重新生成按钮
            const viewBtn = container.createEl('button', { 
                text: t('cowrite.wiz.viewStyle'), 
                cls: 'nw-wizard-file-btn' 
            });
            viewBtn.addEventListener('click', () => {
                this.showFileContentInline(container, wsPath, '文笔风格');
            });
            const regenBtn = container.createEl('button', { 
                text: t('cowrite.wiz.resetStyleBtn'), 
                cls: 'nw-wizard-warn-btn' 
            });
            regenBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
        }
        else if (hasContent) {
            // v4.1: 文件已存在但内容未填写完整（仍是模板）。此前按钮被 isDone 门控导致完全不显示，
            // 这里补出「查看 / 编辑」入口，让用户可直接查看现有文件并打开设定窗口填写。
            container.createEl('p', { text: t('cowrite.wiz.stylePartial'), cls: 'nw-wizard-status nw-wizard-status--accent' });
            const viewBtn = container.createEl('button', {
                text: t('cowrite.wiz.viewStyle'),
                cls: 'nw-wizard-file-btn'
            });
            viewBtn.addEventListener('click', () => {
                this.showFileContentInline(container, wsPath, '文笔风格');
            });
            const editBtn = container.createEl('button', {
                text: t('cowrite.wiz.setStyleBtn'),
                cls: 'nw-wizard-primary-btn'
            });
            editBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
        }
        
        container.createEl('p', { text: t('cowrite.wiz.targetProject', { project: tab.project }), cls: 'nw-wizard-target' });
    }

    /**
     * 渲染大纲步骤。
     *
     * @param container - 容器元素
     * @param tab - 页签
     */
    async renderWizardOutlineStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        container.empty();
        
        const step = tab.steps[tab.currentStepIdx];
        const isDone = step.status === 'done';
        const isExecuting = this.wizardStepExecuting.has(step.id);
        
        container.createEl('p', { text: t('cowrite.wiz.outlineNote'), cls: 'nw-wizard-note' });
        container.createEl('p', { text: t('cowrite.wiz.outlineFormatNote'), cls: 'nw-wizard-note nw-wizard-note--sm' });
        
        if (isExecuting) {
            container.createEl('p', { text: t('cowrite.wiz.openingPlanWindow'), cls: 'nw-wizard-status nw-wizard-status--accent' });
            // 脉冲动画进度条
            const barTrack = container.createDiv({ cls: 'nw-wizard-progress-track' });
            barTrack.createDiv({ cls: 'nw-wizard-progress-bar' });
            container.createEl('p', { text: t('cowrite.wiz.targetProject', { project: tab.project }), cls: 'nw-wizard-target' });
        } else if (isDone) {
            container.createEl('p', { text: t('cowrite.wiz.outlineDone'), cls: 'nw-wizard-status nw-wizard-status--success' });
            // v3.4.2: 内联重新生成按钮
            const regenBtn = container.createEl('button', { 
                text: t('cowrite.wiz.replanBtn'), 
                cls: 'nw-wizard-warn-btn nw-wizard-warn-btn--inline' 
            });
            regenBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
            // v4.1.0: 统一入口 — 大纲树状预览（含全文查看，替代旧的双按钮）
            const treeBtn = container.createEl('button', { 
                text: t('cowrite.wiz.outlinePreviewBtn'), 
                cls: 'nw-wizard-primary-btn' 
            });
            treeBtn.addEventListener('click', () => {
                const modal = new ChapterOutlineTreeModal(this.app, this.plugin, tab.project);
                this.registerOutlineTreeModal(modal);
                modal.open();
            });
            const canvasBtn = container.createEl('button', { 
                text: t('cowrite.wiz.plotCanvasBtn'), 
                cls: 'nw-wizard-primary-btn nw-wizard-primary-btn--neutral nw-wizard-primary-btn--adjacent' 
            });
            canvasBtn.addEventListener('click', () => openPlotCanvas(this.plugin, tab.project));
            // v3.4.6: 内联"下一步"按钮已下线 — 保留右下角 nav bar 唯一下一步入口
        } else {
            // v4.2: 未判定完成时，若分卷大纲文件已存在也提供树状预览入口。
            const existingOutline = await readMergedVolumeOutline(this.app, tab.project);
            if (existingOutline.trim().length > 0) {
                container.createEl('p', { text: t('cowrite.wiz.outlinePartial'), cls: 'nw-wizard-status nw-wizard-status--accent' });
                const treeBtn = container.createEl('button', {
                    text: t('cowrite.wiz.outlinePreviewBtn'),
                    cls: 'nw-wizard-primary-btn'
                });
                treeBtn.addEventListener('click', () => {
                    const modal = new ChapterOutlineTreeModal(this.app, this.plugin, tab.project);
                    this.registerOutlineTreeModal(modal);
                    modal.open();
                });
            } else {
                container.createEl('p', { text: t('cowrite.wiz.outlineActionHint'), cls: 'nw-wizard-action-hint' });
            }
        }
    }

    /**
     * 渲染章节步骤。
     *
     * @param container - 容器元素
     * @param tab - 页签
     */
    async renderWizardChaptersStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        container.empty();
        
        const step = tab.steps[tab.currentStepIdx];
        const isDone = step.status === 'done';
        const isExecuting = this.wizardStepExecuting.has(step.id);
        
        container.createEl('p', { text: t('cowrite.wiz.chaptersNote'), cls: 'nw-wizard-note' });
        container.createEl('p', { text: t('cowrite.wiz.chaptersWarn'), cls: 'nw-wizard-warn-text' });
        
        if (isExecuting) {
            container.createEl('p', { text: t('cowrite.wiz.openingBatchWindow'), cls: 'nw-wizard-status nw-wizard-status--accent' });
            const barTrack = container.createDiv({ cls: 'nw-wizard-progress-track' });
            barTrack.createDiv({ cls: 'nw-wizard-progress-bar' });
            container.createEl('p', { text: t('cowrite.wiz.targetProject', { project: tab.project }), cls: 'nw-wizard-target' });
        } else if (isDone) {
            const bodyRoot = `${tab.project}/${SUBDIR_BODY_ROOT}`;
            const chapterFiles = this.app.vault.getFiles().filter(f =>
                f.path.startsWith(bodyRoot + '/')
                && /\/第\d+卷\/第\d+章[^/]*_正文\.md$/.test(f.path)
            );
            container.createEl('p', { text: t('cowrite.wiz.chaptersCreated', { count: chapterFiles.length }), cls: 'nw-wizard-status nw-wizard-status--success' });
            // v3.4.2: 内联重新生成按钮
            const regenBtn = container.createEl('button', { 
                text: t('cowrite.wiz.recreateChaptersBtn'), 
                cls: 'nw-wizard-warn-btn nw-wizard-warn-btn--inline' 
            });
            regenBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
            // v3.4.6: 内联"下一步"按钮已下线 — 保留右下角 nav bar 唯一下一步入口
        } else {
            container.createEl('p', { text: t('cowrite.wiz.chaptersActionHint'), cls: 'nw-wizard-action-hint' });
        }
    }

    /**
     * 渲染完成步骤。
     *
     * @param container - 容器元素
     * @param tab - 页签
     */
    async renderWizardCompleteStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        container.empty();
        
        container.createEl('h3', { text: t('cowrite.wiz.doneTitle') });
        container.createEl('p', { text: `项目名称: ${tab.project}`, cls: 'nw-wizard-project-name' });
        
        const summary = container.createDiv({ cls: 'nw-wizard-summary-panel' });
        summary.createEl('h4', { text: t('cowrite.wiz.statsTitle'), cls: 'nw-wizard-summary-title' });
        
        const adapter = this.app.vault.adapter;
        const stats: Array<{ label: string; status: string; detail: string }> = [];
        
        // 世界观
        const worldviewExists = await adapter.exists(getWorldviewPath(tab.project));
        stats.push({ label: '世界观', status: resolveSetupStatusIcon(resolveExistsStatus(worldviewExists)), detail: worldviewExists ? t('cowrite.wiz.stGenerated') : t('cowrite.wiz.stNotGenerated') });
        
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
        
        stats.push({ label: '人物', status: resolveSetupStatusIcon(resolveCountStatus(charCount)), detail: t('cowrite.wiz.stCount', { count: charCount }) });
        stats.push({ label: '地点', status: resolveSetupStatusIcon(resolveCountStatus(locCount)), detail: t('cowrite.wiz.stCount', { count: locCount }) });
        stats.push({ label: '势力', status: resolveSetupStatusIcon(resolveCountStatus(factionCount)), detail: t('cowrite.wiz.stCount', { count: factionCount }) });
        stats.push({ label: '物品功法', status: resolveSetupStatusIcon(resolveCountStatus(itemCount)), detail: t('cowrite.wiz.stCount', { count: itemCount }) });
        
        // 分卷大纲（v4.0：按卷归档，合并读取后统计卷数）
        const outlineContent = await readMergedVolumeOutline(this.app, tab.project);
        const outlineExists = outlineContent.trim().length > 0;
        const volumeCount = outlineExists ? countVolumeHeadings(outlineContent) : 0;
        stats.push({ label: '分卷大纲', status: outlineExists ? '✅' : '❌', detail: outlineExists ? t('cowrite.wiz.stVolumes', { count: volumeCount }) : t('cowrite.wiz.stNotGenerated') });
        
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
        stats.push({ label: '章节', status: chapterCount > 0 ? '✅' : '❌', detail: t('cowrite.wiz.stChapters', { count: chapterCount }) });
        
        const table = summary.createEl('table', { cls: 'nw-wizard-stats-table' });
        for (const s of stats) {
            const row = table.createEl('tr');
            row.createEl('td', { text: s.label, cls: 'nw-wizard-stats-cell nw-wizard-stats-cell--label' });
            row.createEl('td', { text: `${s.status} ${s.detail}`, cls: 'nw-wizard-stats-cell' });
        }
        
        container.createEl('p', { text: t('cowrite.wiz.enterWritingHint'), cls: 'nw-wizard-status nw-wizard-status--accent nw-wizard-status--lg' });
    }

    /**
     * 渲染实体步骤。
     *
     * @param container - 容器元素
     * @param tab - 页签
     */
    async renderWizardEntitiesStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        container.empty();

        if (this.plugin._entityModalJustClosed) {
            this.plugin._entityModalJustClosed = false;
            this.entitiesExecuting.clear();
        }

        const step = tab.steps[tab.currentStepIdx];

        // 预加载世界观和设定库到缓存（如果还没有的话）
        if (!this.wizardStepResults['worldview']) {
            const wvFile = this.app.vault.getAbstractFileByPath(getWorldviewPath(tab.project));
            if (wvFile instanceof TFile) {
                try {
                    const wvContent = await this.app.vault.read(wvFile);
                    if (wvContent.trim().length > 0) {
                        this.wizardStepResults['worldview'] = wvContent;
                    }
                } catch (e) { /* 忽略 */ }
            }
        }
        if (!this.wizardStepResults['setting_lib']) {
            const slFile = this.app.vault.getAbstractFileByPath(getSettingLibPath(tab.project));
            if (slFile instanceof TFile) {
                try {
                    const slContent = await this.app.vault.read(slFile);
                    if (slContent.trim().replace(/<!--[\s\S]*?-->/g, '').trim().length > 0) {
                        this.wizardStepResults['setting_lib'] = slContent;
                    }
                } catch (e) { /* 忽略 */ }
            }
        }

        container.createEl('p', { text: t('cowrite.wiz.entityNote'), cls: 'nw-wizard-note' });

        const toolBar = container.createDiv({ cls: 'nw-wizard-toolbar nw-wizard-entity-toolbar' });

        // 直接进入统一实体管理界面，不再经过「实体概览」中间层
        const managerBtn = toolBar.createEl('button', {
            text: t('cowrite.wiz.entityManagerBtn'),
            cls: 'nw-wizard-entity-manager-btn'
        });
        managerBtn.addEventListener('click', () => {
            new UnifiedEntityManagerModal(this.app, this.plugin, tab.project).open();
        });
        
        const entityConfig = [
            { id: 'characters', label: t('cowrite.wiz.entityChars'), desc: t('cowrite.wiz.entityCharsDesc'), icon: '👤', commandId: 'novel-writer-character', dir: SUBDIR_CHARS },
            { id: 'locations', label: t('cowrite.wiz.entityLocs'), desc: t('cowrite.wiz.entityLocsDesc'), icon: '📍', commandId: 'novel-writer-location', dir: SUBDIR_LOCS },
            { id: 'factions', label: t('cowrite.wiz.entityFactions'), desc: t('cowrite.wiz.entityFactionsDesc'), icon: '🏰', commandId: 'novel-writer-faction', dir: SUBDIR_FACTIONS },
            { id: 'items', label: t('cowrite.wiz.entityItems'), desc: t('cowrite.wiz.entityItemsDesc'), icon: '⚔️', commandId: 'novel-writer-item', dir: SUBDIR_ITEMS },
        ];
        
        for (const cfg of entityConfig) {
            const subStep = step.subSteps?.find(s => s.id === cfg.id);
            const isDone = subStep?.status === 'done' || subStep?.status === 'skipped';
            
            const row = container.createDiv({ cls: isDone ? 'nw-wizard-entity-row nw-wizard-entity-row--done' : 'nw-wizard-entity-row' });
            const info = row.createDiv({ cls: 'nw-wizard-entity-info' });
            info.createSpan({ text: `${cfg.icon} ${cfg.label}`, cls: 'nw-wizard-entity-name' });
            info.createEl('span', { text: ` — ${cfg.desc}`, cls: 'nw-wizard-entity-desc' });
            
            const actions = row.createDiv({ cls: 'nw-wizard-entity-actions' });
            
            if (isDone) {
                actions.createSpan({ text: subStep?.status === 'done' ? t('cowrite.wiz.stGenerated') : t('cowrite.wiz.stSkipped'), cls: 'nw-wizard-entity-state' });
                // v3.4.1: done 后仍可继续生成，不锁按钮
                const isOpening = this.entitiesExecuting.has(cfg.id);
                const regenBtn = actions.createEl('button', { 
                    text: isOpening ? t('cowrite.wiz.opening') : t('cowrite.wiz.continueGenBtn'), 
                    cls: 'nw-wizard-entity-btn nw-wizard-entity-btn--sm' 
                });
                if (isOpening) {
                    regenBtn.disabled = true;
                    regenBtn.addClass('nw-disabled-look');
                }
                regenBtn.addEventListener('click', () => {
                    if (this.entitiesExecuting.has(cfg.id)) return;
                    this.entitiesExecuting.add(cfg.id);
                    this.plugin._pendingEntityProject = tab.project;
                    this.plugin._pendingEntityContext = { project: tab.project, isEarlyStage: true };
                    const dispatched = this.plugin.executeCommand(cfg.commandId);
                    if (!dispatched) {
                        this.entitiesExecuting.delete(cfg.id);
                        showErrorNotice(t('cowrite.wiz.entryUnavailable', { label: cfg.label }), { timeout: 5000 });
                        this.renderTab(tab, true);
                        return;
                    }
                    showSuccessNotice(t('cowrite.wiz.entryOpened', { label: cfg.label }), { timeout: 2000 });
                    if (subStep && subStep.status === 'done') subStep.status = 'pending';
                    this.renderTab(tab, true);
                    // 看门狗：弹窗未打开时关闭回调不会来，避免按钮永久禁用
                    window.setTimeout(() => {
                        if (!this.entitiesExecuting.has(cfg.id)) return;
                        this.entitiesExecuting.delete(cfg.id);
                        this.renderTab(tab, true);
                    }, 5000);
                    this.plugin._entityModalCloseCallbacks.push(async () => {
                        this.entitiesExecuting.delete(cfg.id);
                        // 检测磁盘文件是否已生成
                        if (subStep) {
                            const dirPath = `${tab.project}/${cfg.dir}`;
                            const hasFile = this.app.vault.getFiles().some(f => f.path.startsWith(dirPath) && f.path.endsWith('.md'));
                            if (hasFile && subStep.status !== 'done') {
                                subStep.status = 'done';
                                // 检查所有 subStep 是否都完成
                                const allDone = (step.subSteps || []).every(s => s.status === 'done' || s.status === 'skipped');
                                if (allDone) step.status = 'done';
                            }
                        }
                        this.renderTab(tab, true);
                    });
                });
            } else {
                const isOpening = this.entitiesExecuting.has(cfg.id);
                const genBtn = actions.createEl('button', { 
                    text: isOpening ? t('cowrite.wiz.opening') : t('cowrite.wiz.generateBtn'), 
                    cls: 'nw-wizard-entity-btn' 
                });
                if (isOpening) {
                    genBtn.disabled = true;
                    genBtn.addClass('nw-disabled-look');
                }
                genBtn.addEventListener('click', () => {
                    if (this.entitiesExecuting.has(cfg.id)) return;
                    this.entitiesExecuting.add(cfg.id);
                    this.plugin._pendingEntityProject = tab.project;
                    this.plugin._pendingEntityContext = { project: tab.project, isEarlyStage: true };
                    const dispatched = this.plugin.executeCommand(cfg.commandId);
                    if (!dispatched) {
                        // 命令未注册/路由失败：不会打开任何弹窗，关闭回调永远不来
                        this.entitiesExecuting.delete(cfg.id);
                        showErrorNotice(t('cowrite.wiz.entryUnavailable', { label: cfg.label }), { timeout: 5000 });
                        this.renderTab(tab, true);
                        return;
                    }
                    showSuccessNotice(t('cowrite.wiz.entryOpened', { label: cfg.label }), { timeout: 2000 });
                    this.renderTab(tab, true);
                    // 看门狗：命令被分发但前置条件不满足时可能什么都没打开，
                    // 5 秒后若没等到弹窗关闭回调就恢复按钮，避免永久禁用。
                    window.setTimeout(() => {
                        if (!this.entitiesExecuting.has(cfg.id)) return;
                        this.entitiesExecuting.delete(cfg.id);
                        this.renderTab(tab, true);
                    }, 5000);
                    this.plugin._entityModalCloseCallbacks.push(async () => {
                        this.entitiesExecuting.delete(cfg.id);
                        // 检测磁盘文件是否已生成
                        if (subStep) {
                            const dirPath = `${tab.project}/${cfg.dir}`;
                            const hasFile = this.app.vault.getFiles().some(f => f.path.startsWith(dirPath) && f.path.endsWith('.md'));
                            if (hasFile && subStep.status !== 'done') {
                                subStep.status = 'done';
                                // 检查所有 subStep 是否都完成
                                const allDone = (step.subSteps || []).every(s => s.status === 'done' || s.status === 'skipped');
                                if (allDone) step.status = 'done';
                            }
                        }
                        this.renderTab(tab, true);
                    });
                });
            }
        }
        
        container.createEl('p', { text: t('cowrite.wiz.skipHint'), cls: 'nw-wizard-hint nw-wizard-hint--lg' });

        const tip = container.createEl('p', { 
            text: t('cowrite.wiz.manageGeneratedHint'),
            cls: 'nw-wizard-tip'
        });
    }

    /**
     * 渲染世界观步骤。
     *
     * @param container - 容器元素
     * @param tab - 页签
     */
    async renderWizardWorldviewStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        container.empty();
        
        const step = tab.steps[tab.currentStepIdx];
        const isDone = step.status === 'done';
        const isExecuting = this.wizardStepExecuting.has(step.id);
        const progress = this.wizardStepResults['_worldviewProgress'] || '';
        
        container.createEl('p', { text: t('cowrite.wiz.wvNote', { count: WV_SECTIONS.length, modules: WV_SECTIONS.join('、') }), cls: 'nw-wizard-note' });
        container.createEl('p', { text: t('cowrite.wiz.wvWarn'), cls: 'nw-wizard-warn-text' });
        
        container.createEl('p', { text: t('cowrite.wiz.targetProject', { project: tab.project }), cls: 'nw-wizard-target' });
        
        if (isExecuting && progress) {
            const progressEl = container.createDiv({ cls: 'nw-wizard-progress-panel' });
            progressEl.createEl('span', { text: `⏳ ${progress}`, cls: 'nw-wizard-progress-text', attr: { 'data-wv-progress': '' } });
            const progBar = progressEl.createDiv({ cls: 'nw-wizard-progress-track' });
            progBar.createDiv({ cls: 'nw-wizard-progress-bar nw-wizard-progress-bar--slow' });
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
            
            container.createEl('p', { text: t('cowrite.wiz.wvDone'), cls: 'nw-wizard-status nw-wizard-status--success' });
            
            // v3.4.2: 内联重新生成按钮（不依赖导航栏）
            const regenBtn = container.createEl('button', { 
                text: t('cowrite.wiz.regenerateWorldview'), 
                cls: 'nw-wizard-warn-btn nw-wizard-warn-btn--inline nw-wizard-warn-btn--lg' 
            });
            regenBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
            
            const viewBtn = container.createEl('button', { 
                text: t('cowrite.wiz.openWorldviewFile'), 
                cls: 'nw-wizard-file-btn nw-wizard-file-btn--start' 
            });
            viewBtn.addEventListener('click', () => {
                this.showFileContentInline(container, getWorldviewPath(tab.project), '世界观设定');
            });
            
            // Show module summary (only if we have content)
            if (worldviewContent) {
                const summaryDiv = container.createDiv({ cls: 'nw-wizard-hint' });
                summaryDiv.createEl('p', { text: t('cowrite.wiz.wvGeneratedModules', { count: WV_SECTIONS.length }) });
                for (const s of WV_SECTIONS) {
                    const found = worldviewContent.includes(`## ${s}`);
                    summaryDiv.createSpan({ text: `${found ? '✅' : '❌'} ${s}  ` });
                }
            }
        }
        else {
            // v4.1: 未判定完成时，若世界观文件已存在也提供查看 / 重新生成入口。
            const wvFile = this.app.vault.getAbstractFileByPath(getWorldviewPath(tab.project));
            if (wvFile) {
                container.createEl('p', { text: t('cowrite.wiz.wvPartial'), cls: 'nw-wizard-status nw-wizard-status--accent' });
                const viewBtn = container.createEl('button', {
                    text: t('cowrite.wiz.openWorldviewFile'),
                    cls: 'nw-wizard-file-btn'
                });
                viewBtn.addEventListener('click', () => {
                    this.showFileContentInline(container, getWorldviewPath(tab.project), '世界观设定');
                });
                const regenBtn = container.createEl('button', {
                    text: t('cowrite.wiz.regenerateWorldview'),
                    cls: 'nw-wizard-warn-btn'
                });
                regenBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
            }
        }
    }
}
