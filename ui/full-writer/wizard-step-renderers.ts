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
import { getWorldviewPath, getSettingLibPath, getWritingStylePath, pjProjectMeta, pjFanficDir, SUBDIR_CHARS, SUBDIR_LOCS, SUBDIR_FACTIONS, SUBDIR_ITEMS, SUBDIR_BODY_ROOT } from '../../shared/paths';
import { findWritingStyleFile } from '../writing-style-paths';
import { ChapterOutlineTreeModal } from '../chapter-outline-tree-modal';
import { openPlotCanvas } from '../plot-canvas-modal';
import { UnifiedEntityManagerModal } from '../unified-entity-manager-modal';
import { readMergedVolumeOutline } from '../../utils/helpers';
import { WV_SECTIONS, SL_SECTIONS } from '../../shared/format-constants';
import { attachFanficPathToProject, buildFanficSettingsContent, getFanficSettingsPath, isFanficSettingsContentValidEnough, missingFanficValueLabels, type FanficSettingsValues } from './fanfic-settings-utils';
import { extractFanficRuleValue, parseProjectMeta } from '../../shared/fanfic-rules';
import { listFanficSettingCandidates } from '../../shared/fanfic-binding';
import { getStoryStructure, getStructureStageSummary, getStoryOptionLabel, parseStorySettingsFromProjectMeta } from '../../shared/story-structure';
import { StorySettingsModal } from '../story-settings-modal';

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

    async renderWizardStoryStructureStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        container.empty();
        let settings = null;
        try {
            const metaFile = this.app.vault.getAbstractFileByPath(pjProjectMeta(tab.project));
            if (metaFile instanceof TFile) {
                settings = parseStorySettingsFromProjectMeta(await this.app.vault.read(metaFile));
            }
        } catch { /* 读取失败时按未配置处理 */ }

        const card = container.createDiv({ cls: 'nw-wizard-story-structure' });
        if (!settings) {
            card.createEl('h4', { text: '🧬 先确定故事结构' });
            card.createEl('p', {
                text: '选择起承转合、三幕式、五幕式、英雄之旅或序破急，并配置主角、冲突、力量体系；结构会作为硬约束注入后续每一步提示词。',
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
                ['主角起点', getStoryOptionLabel('protagonistStart', settings.protagonistStart)],
                ['核心冲突', getStoryOptionLabel('coreConflict', settings.coreConflict)],
                ['力量体系', getStoryOptionLabel('powerSystem', settings.powerSystem)],
                ['金手指', getStoryOptionLabel('goldenFinger', settings.goldenFinger)],
                ['人物原型', getStoryOptionLabel('archetype', settings.archetype)],
                ['主角性格', getStoryOptionLabel('temperament', settings.temperament)],
                ['叙事基调', getStoryOptionLabel('tone', settings.tone)],
                ['推进节奏', getStoryOptionLabel('pacing', settings.pacing)],
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
            text: settings ? '✏️ 编辑故事结构' : '🧬 配置故事结构',
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

    async renderWizardFanficStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        container.empty();
        
        // 如果已执行过，恢复表单数据
        const fanficResultKey = `fanfic:${tab.project}`;
        let saved = this.wizardStepResults[fanficResultKey] || '';
        // 通过「同人设定库」工具生成后，内存里没有暂存，改从 .project 记录路径回读
        if (!saved.trim()) {
            const metaFile = this.app.vault.getAbstractFileByPath(pjProjectMeta(tab.project));
            if (metaFile instanceof TFile) {
                try {
                    const meta = await this.app.vault.read(metaFile);
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
            group.createEl('label', { text: label, cls: 'nw-u-d-block nw-u-fs-0-8em nw-u-c-text-muted-2 nw-u-marginbottom-4px-2' });
            const input = type === 'textarea'
                ? group.createEl('textarea', { cls: 'nw-wizard-textarea' })
                : group.createEl('input', { attr: { style: 'width:100%; padding:6px 8px; border-radius:6px; border:1px solid var(--background-modifier-border); font-size:0.85em;' } });
            
            // 三条创作规则只写在正文（`- **字段**：…`），frontmatter 里没有，
            // 必须走正文解析，否则绑定/生成后再进向导时规则框永远为空，保存会覆盖成空。
            (input as HTMLTextAreaElement).value = type === 'textarea'
                ? extractFanficRuleValue(saved, key) || getSaved(key)
                : getSaved(key);
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
            cls: 'nw-u-margintop-12px-2 nw-u-p-6px-16px nw-u-bg-background-secondary-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-cur-pointer-2' 
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
            await attachFanficPathToProject(this.app, tab.project, path);
            this.wizardStepResults[fanficResultKey] = content;
            new Notice(`✅ 同人设定已保存: ${path}`, 3000);
            this.renderTab(tab, true);
        });
        
        if (saved) {
            container.createEl('p', { text: '📝 已有暂存设定，修改后请重新保存。', cls: 'nw-u-c-text-accent nw-u-fs-0-8em nw-u-margintop-8px-2' });
        }

        // 已存在设定文件（手写/拷入/旧项目遗留）时提供绑定入口：此前只能逐字段重填或手改 .project
        const candidates = await this.listFanficCandidates(tab.project);
        if (candidates.length > 0) {
            const bindBox = container.createDiv({ cls: 'nw-u-margintop-14px nw-u-p-8px-10px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2' });
            bindBox.createEl('p', {
                text: '🔗 项目里已有同人设定文件，可直接绑定（会把内容填入上方表单，保存时覆盖该文件）',
                cls: 'nw-u-fs-0-8em nw-u-c-text-muted-2 nw-u-m-0-0-6px'
            });
            const select = bindBox.createEl('select', { attr: { style: 'width:100%; padding:6px 8px; border-radius:6px; border:1px solid var(--background-modifier-border); font-size:0.85em;' } });
            for (const candidate of candidates) {
                select.createEl('option', { text: `${candidate.name}（${candidate.path}）`, value: candidate.path });
            }
            const bindBtn = bindBox.createEl('button', {
                text: '🔗 绑定所选文件',
                cls: 'nw-u-margintop-8px-2 nw-u-p-6px-16px nw-u-bg-background-secondary-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-cur-pointer-2'
            });
            bindBtn.addEventListener('click', async () => {
                const path = select.value;
                const file = this.app.vault.getAbstractFileByPath(path);
                if (!(file instanceof TFile)) {
                    new Notice('❌ 文件不存在，可能已被移动或删除', 6000);
                    return;
                }
                let content = '';
                try {
                    content = await this.app.vault.read(file);
                } catch {
                    new Notice('❌ 读取失败，请检查文件权限后重试', 6000);
                    return;
                }
                if (!content.trim()) {
                    new Notice('❌ 该同人设定文件为空，无法绑定', 6000);
                    return;
                }
                await attachFanficPathToProject(this.app, tab.project, path);
                this.wizardStepResults[fanficResultKey] = content;
                const check = isFanficSettingsContentValidEnough(content);
                new Notice(
                    check.valid
                        ? `✅ 已绑定：${path}`
                        : `⚠️ 已绑定 ${path}，但仍缺少：${check.missingFields.slice(0, 5).join('、')}。请补全后点「保存同人设定」。`,
                    8000
                );
                this.renderTab(tab, true);
            });
        }
    }

    /** 本项目同人设定库 + 全局同人设定库下的 Markdown 候选（排除当前已绑定文件） */
    private async listFanficCandidates(project: string): Promise<{ path: string; name: string }[]> {
        let currentPath = '';
        const metaFile = this.app.vault.getAbstractFileByPath(pjProjectMeta(project));
        if (metaFile instanceof TFile) {
            try {
                currentPath = parseProjectMeta(await this.app.vault.read(metaFile)).fanficPath;
            } catch { /* 元信息读取失败时按「未绑定」处理 */ }
        }
        return listFanficSettingCandidates(
            this.app.vault.getMarkdownFiles().map(file => file.path),
            [pjFanficDir(project), '元文件/05-同人设定库'],
            currentPath,
        );
    }

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
        
        container.createEl('p', { text: '从已生成的世界观中提炼结构化的设定库，供后续写作快速查阅。', cls: 'nw-u-c-text-muted-2' });
        
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
                text: `📚 已生成 ${detectedModules.length} 个模块：${detectedModules.join('、')}`, 
                cls: 'nw-u-c-text-muted-2 nw-u-fs-0-85em' 
            });
        } else {
            container.createEl('p', { 
                text: `📚 包含 ${SL_SECTIONS.length} 个模块：${SL_SECTIONS.join('、')}`, 
                cls: 'nw-u-c-text-muted-2 nw-u-fs-0-85em' 
            });
        }
        
        if (!hasWorldview) {
            container.createEl('p', { text: '⚠️ 未检测到世界观总览，请先生成世界观再生成设定库。', cls: 'nw-u-c-text-warning nw-u-fwt-600-2 nw-u-margintop-12px-2' });
            return;
        }
        
        // v4.5: 通用按钮工厂，复用 isExecuting 处理
        const makeViewBtn = () => {
            const viewBtn = container.createEl('button', {
                text: '📖 查看设定库',
                attr: { style: 'margin:8px 12px 8px 0; padding:6px 14px; border-radius:6px; cursor:pointer; background:var(--background-modifier-border); border:1px solid var(--background-modifier-border);' }
            });
            viewBtn.addEventListener('click', () => {
                this.showFileContentInline(container, getSettingLibPath(tab.project), '设定库');
            });
            return viewBtn;
        };
        
        const makeRegenBtn = () => {
            const regenBtn = container.createEl('button', {
                text: isExecuting ? '⏳ 生成中...' : '🔄 重新生成',
                cls: 'nw-u-m-8px-0 nw-u-p-6px-14px nw-u-bg-f59e0b nw-u-c-white-2 nw-u-b-none nw-u-brd-6px-2 nw-u-cur-pointer-2'
            });
            if (isExecuting) {
                regenBtn.style.opacity = '0.6';
                regenBtn.style.cursor = 'not-allowed';
            } else {
                regenBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
            }
            return regenBtn;
        };
        
        // 执行中状态统一处理
        if (isExecuting) {
            container.createEl('p', { text: '⏳ 设定库正在生成中，请稍候...', cls: 'nw-u-c-text-accent nw-u-fwt-600-2 nw-u-margintop-12px-2' });
            // 执行中显示禁用按钮 + 动画进度条
            makeViewBtn();
            const disabledBtn = makeRegenBtn();
            disabledBtn.textContent = '⏳ 生成中...';
            // 添加脉冲动画进度条
            const barTrack = container.createDiv({ cls: 'nw-u-margintop-8px-2 nw-u-h-6px-2 nw-u-bg-background-modifier-bo-3 nw-u-brd-3px-2 nw-u-ov-hidden-2' });
            barTrack.createDiv({ cls: 'nw-u-h-100-2 nw-u-w-60 nw-u-bg-linear-gradient-90deg- nw-u-animation-nw-progress-anim-1-5s- nw-u-brd-3px-2' });
            container.createEl('p', { text: `目标项目: ${tab.project}`, cls: 'nw-u-margintop-8px-2 nw-u-c-text-muted-2 nw-u-fs-0-85em' });
            return;
        }
        
        if (isDone) {
            if (slFile) {
                container.createEl('p', { text: '✅ 设定库已生成。', cls: 'nw-u-c-text-success nw-u-fwt-600-2 nw-u-margintop-12px-2' });
                makeViewBtn();
                makeRegenBtn();
            }
        }
        else if (isRetry) {
            container.createEl('p', { text: '❌ 设定库生成失败，请检查 API 配置后重试。', cls: 'nw-u-c-text-error nw-u-fwt-600-2 nw-u-margintop-12px-2' });
            if (slFile) {
                container.createEl('p', { text: '📄 检测到设定库文件（可能不完整），可先查看。', cls: 'nw-u-c-text-accent nw-u-fwt-600-2 nw-u-margintop-8px-2' });
                makeViewBtn();
            }
            makeRegenBtn();
        }
        else {
            if (slFile) {
                container.createEl('p', { text: '📄 检测到设定库文件，内容可能尚未填写完整。', cls: 'nw-u-c-text-accent nw-u-fwt-600-2 nw-u-margintop-12px-2' });
                makeViewBtn();
                makeRegenBtn();
            }
        }
        
        container.createEl('p', { text: `目标项目: ${tab.project}`, cls: 'nw-u-margintop-8px-2 nw-u-c-text-muted-2 nw-u-fs-0-85em' });
    }

    async renderWizardWritingStyleStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        const step = tab.steps[tab.currentStepIdx];
        const isDone = step.status === 'done';

        // v4.0: 文笔风格落盘于 04-世界观/文笔风格.md，兼容旧根目录路径
        const wsFile = await findWritingStyleFile(this.app, tab.project, { allowPlaceholder: true });
        const hasContent = !!wsFile;
        const wsPath = wsFile?.path ?? getWritingStylePath(tab.project);

        container.createEl('p', { text: '定义本项目的文笔风格、叙事特征和语言习惯。此步骤为手动设定，点击按钮后请在弹窗中保存。', cls: 'nw-u-c-text-muted-2' });
        container.createEl('p', { text: '✍️ 包含 9 个模块：叙事视角、文笔特征、对话风格、描写风格、叙事节奏、情感表达、禁用/慎用、参考作品、格式要求', cls: 'nw-u-c-text-muted-2 nw-u-fs-0-85em' });
        container.createEl('p', { text: '⚠️ 此步骤不可跳过，文笔风格是 AI 写作质量的核心保障。', cls: 'nw-u-c-text-accent nw-u-fs-0-85em' });
        
        if (hasContent && isDone) {
            container.createEl('p', { text: '✅ 文笔风格已设定。', cls: 'nw-u-c-text-success nw-u-fwt-600-2 nw-u-margintop-12px-2' });
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
                cls: 'nw-u-m-8px-0 nw-u-p-6px-14px nw-u-bg-f59e0b nw-u-c-white-2 nw-u-b-none nw-u-brd-6px-2 nw-u-cur-pointer-2' 
            });
            regenBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
        }
        else if (hasContent) {
            // v4.1: 文件已存在但内容未填写完整（仍是模板）。此前按钮被 isDone 门控导致完全不显示，
            // 这里补出「查看 / 编辑」入口，让用户可直接查看现有文件并打开设定窗口填写。
            container.createEl('p', { text: '📄 检测到文笔风格文件，但内容尚未填写完整。可查看现有内容或点击下方设定。', cls: 'nw-u-c-text-accent nw-u-fwt-600-2 nw-u-margintop-12px-2' });
            const viewBtn = container.createEl('button', {
                text: '📖 查看文笔风格',
                attr: { style: 'margin:8px 12px 8px 0; padding:6px 14px; border-radius:6px; cursor:pointer; background:var(--background-modifier-border); border:1px solid var(--background-modifier-border);' }
            });
            viewBtn.addEventListener('click', () => {
                this.showFileContentInline(container, wsPath, '文笔风格');
            });
            const editBtn = container.createEl('button', {
                text: '✍️ 设定文笔风格',
                cls: 'nw-u-m-8px-0 nw-u-p-6px-14px nw-u-bg-text-accent nw-u-c-white-2 nw-u-b-none nw-u-brd-6px-2 nw-u-cur-pointer-2'
            });
            editBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
        }
        
        container.createEl('p', { text: `目标项目: ${tab.project}`, cls: 'nw-u-margintop-8px-2 nw-u-c-text-muted-2 nw-u-fs-0-85em' });
    }

    async renderWizardOutlineStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        container.empty();
        
        const step = tab.steps[tab.currentStepIdx];
        const isDone = step.status === 'done';
        const isExecuting = this.wizardStepExecuting.has(step.id);
        
        container.createEl('p', { text: '基于已生成的世界观和实体设定，AI 将生成完整的分卷大纲，包括每卷的核心冲突和章节分配表。', cls: 'nw-u-c-text-muted-2' });
        container.createEl('p', { text: '严格按照分卷大纲模板字段格式输出，确保批量建章能正确解析。', cls: 'nw-u-c-text-muted-2 nw-u-fs-0-85em' });
        
        if (isExecuting) {
            container.createEl('p', { text: '⏳ 正在打开全书规划窗口...', cls: 'nw-u-c-text-accent nw-u-fwt-600-2 nw-u-margintop-12px-2' });
            // 脉冲动画进度条
            const barTrack = container.createDiv({ cls: 'nw-u-margintop-8px-2 nw-u-h-6px-2 nw-u-bg-background-modifier-bo-3 nw-u-brd-3px-2 nw-u-ov-hidden-2' });
            barTrack.createDiv({ cls: 'nw-u-h-100-2 nw-u-w-60 nw-u-bg-linear-gradient-90deg- nw-u-animation-nw-progress-anim-1-5s- nw-u-brd-3px-2' });
            container.createEl('p', { text: `目标项目: ${tab.project}`, cls: 'nw-u-margintop-8px-2 nw-u-c-text-muted-2 nw-u-fs-0-85em' });
        } else if (isDone) {
            container.createEl('p', { text: '✅ 全书规划已完成。', cls: 'nw-u-c-text-success nw-u-fwt-600-2 nw-u-margintop-12px-2' });
            // v3.4.2: 内联重新生成按钮
            const regenBtn = container.createEl('button', { 
                text: '🔄 重新规划', 
                cls: 'nw-u-m-8px-12px-8px-0 nw-u-p-6px-14px nw-u-bg-f59e0b nw-u-c-white-2 nw-u-b-none nw-u-brd-6px-2 nw-u-cur-pointer-2' 
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
            const canvasBtn = container.createEl('button', { 
                text: '🗺️ 情节画布', 
                attr: { style: 'margin:8px 0 8px 8px; padding:6px 14px; border-radius:6px; cursor:pointer; background:var(--interactive-accent); color:white; border:none; font-weight:600;' } 
            });
            canvasBtn.addEventListener('click', () => openPlotCanvas(this.plugin, tab.project));
            // v3.4.6: 内联"下一步"按钮已下线 — 保留右下角 nav bar 唯一下一步入口
        } else {
            // v4.2: 未判定完成时，若分卷大纲文件已存在也提供树状预览入口。
            const existingOutline = await readMergedVolumeOutline(this.app, tab.project);
            if (existingOutline.trim().length > 0) {
                container.createEl('p', { text: '📄 检测到分卷大纲文件，内容可能尚未填写完整。', cls: 'nw-u-c-text-accent nw-u-fwt-600-2 nw-u-margintop-12px-2' });
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
                container.createEl('p', { text: '点击下方"▶ 执行"按钮打开全书规划窗口。', cls: 'nw-u-margintop-12px-2' });
            }
        }
    }

    async renderWizardChaptersStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        container.empty();
        
        const step = tab.steps[tab.currentStepIdx];
        const isDone = step.status === 'done';
        const isExecuting = this.wizardStepExecuting.has(step.id);
        
        container.createEl('p', { text: '根据分卷大纲自动批量创建所有章节目录和文件（大纲摘要、正文、信息规划）。', cls: 'nw-u-c-text-muted-2' });
        container.createEl('p', { text: '⚠️ 请确保已先完成"全书规划"步骤，否则无法解析卷结构。', cls: 'nw-u-c-text-accent nw-u-fs-0-85em' });
        
        if (isExecuting) {
            container.createEl('p', { text: '⏳ 正在打开批量建章窗口...', cls: 'nw-u-c-text-accent nw-u-fwt-600-2 nw-u-margintop-12px-2' });
            const barTrack = container.createDiv({ cls: 'nw-u-margintop-8px-2 nw-u-h-6px-2 nw-u-bg-background-modifier-bo-3 nw-u-brd-3px-2 nw-u-ov-hidden-2' });
            barTrack.createDiv({ cls: 'nw-u-h-100-2 nw-u-w-60 nw-u-bg-linear-gradient-90deg- nw-u-animation-nw-progress-anim-1-5s- nw-u-brd-3px-2' });
            container.createEl('p', { text: `目标项目: ${tab.project}`, cls: 'nw-u-margintop-8px-2 nw-u-c-text-muted-2 nw-u-fs-0-85em' });
        } else if (isDone) {
            const bodyRoot = `${tab.project}/${SUBDIR_BODY_ROOT}`;
            const chapterFiles = this.app.vault.getFiles().filter(f =>
                f.path.startsWith(bodyRoot + '/')
                && /\/第\d+卷\/第\d+章[^/]*_正文\.md$/.test(f.path)
            );
            container.createEl('p', { text: `✅ 已创建 ${chapterFiles.length} 个章节文件。`, cls: 'nw-u-c-text-success nw-u-fwt-600-2 nw-u-margintop-12px-2' });
            // v3.4.2: 内联重新生成按钮
            const regenBtn = container.createEl('button', { 
                text: '🔄 重新建章', 
                cls: 'nw-u-m-8px-12px-8px-0 nw-u-p-6px-14px nw-u-bg-f59e0b nw-u-c-white-2 nw-u-b-none nw-u-brd-6px-2 nw-u-cur-pointer-2' 
            });
            regenBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
            // v3.4.6: 内联"下一步"按钮已下线 — 保留右下角 nav bar 唯一下一步入口
        } else {
            container.createEl('p', { text: '点击下方"▶ 执行"按钮打开批量建章窗口。', cls: 'nw-u-margintop-12px-2' });
        }
    }

    async renderWizardCompleteStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        container.empty();
        
        container.createEl('h3', { text: '🎉 项目初始化完成！' });
        container.createEl('p', { text: `项目名称: ${tab.project}`, cls: 'nw-u-c-text-muted-2 nw-u-fs-1-1em' });
        
        const summary = container.createDiv({ cls: 'nw-u-margintop-20px-2 nw-u-p-16px-2 nw-u-bg-background-primary-alt nw-u-brd-8px-2' });
        summary.createEl('h4', { text: '📊 项目统计', cls: 'nw-u-m-0-0-12px-0-2' });
        
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
        
        const table = summary.createEl('table', { cls: 'nw-u-w-100-2 nw-u-bordercollapse-collapse-2' });
        for (const s of stats) {
            const row = table.createEl('tr');
            row.createEl('td', { text: s.label, cls: 'nw-u-p-6px-8px-2 nw-u-bb-1px-solid-background-m-2 nw-u-fwt-600-2' });
            row.createEl('td', { text: `${s.status} ${s.detail}`, cls: 'nw-u-p-6px-8px-2 nw-u-bb-1px-solid-background-m-2' });
        }
        
        container.createEl('p', { text: '点击下方"🎯 进入写作界面"开始写作。', cls: 'nw-u-margintop-16px-2 nw-u-c-text-accent nw-u-fwt-600-2' });
    }

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

        container.createEl('p', { text: '此步骤可选。点击下方按钮打开对应的实体生成窗口。', cls: 'nw-u-c-text-muted-2' });

        const toolBar = container.createDiv({ cls: "nw-wizard-toolbar nw-u-d-flex-2 nw-u-fwr-wrap-2 nw-u-gap-8px-2 nw-u-marginbottom-12px-2", attr: {} });

        // 直接进入统一实体管理界面，不再经过「实体概览」中间层
        const managerBtn = toolBar.createEl('button', {
            text: '📚 实体管理',
            cls: 'nw-u-p-6px-16px nw-u-bg-interactive-accent-2 nw-u-c-text-on-accent-2 nw-u-b-none nw-u-brd-6px-2 nw-u-cur-pointer-2 nw-u-fs-0-9em nw-u-fwt-600-2'
        });
        managerBtn.addEventListener('click', () => {
            new UnifiedEntityManagerModal(this.app, this.plugin, tab.project).open();
        });
        
        const entityConfig = [
            { id: 'characters', label: '人物', desc: '生成主要角色卡（含 frontmatter 字段和设定章节）', icon: '👤', commandId: 'novel-writer-character', dir: SUBDIR_CHARS },
            { id: 'locations', label: '地点', desc: '生成故事场景地点设定', icon: '📍', commandId: 'novel-writer-location', dir: SUBDIR_LOCS },
            { id: 'factions', label: '势力', desc: '生成各方势力组织设定', icon: '🏰', commandId: 'novel-writer-faction', dir: SUBDIR_FACTIONS },
            { id: 'items', label: '物品功法', desc: '生成关键物品和功法设定', icon: '⚔️', commandId: 'novel-writer-item', dir: SUBDIR_ITEMS },
        ];
        
        for (const cfg of entityConfig) {
            const subStep = step.subSteps?.find(s => s.id === cfg.id);
            const isDone = subStep?.status === 'done' || subStep?.status === 'skipped';
            
            const row = container.createDiv({ cls: 'nw-wizard-entity-row', attr: { style: isDone ? 'opacity:0.6;' : '' } });
            const info = row.createDiv();
            info.createSpan({ text: `${cfg.icon} ${cfg.label}`, cls: 'nw-u-fwt-600-2' });
            info.createEl('span', { text: ` — ${cfg.desc}`, cls: 'nw-u-c-text-muted-2 nw-u-fs-0-8em' });
            
            const actions = row.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-6px-2' });
            
            if (isDone) {
                actions.createSpan({ text: subStep?.status === 'done' ? '✅ 已生成' : '⏭ 已跳过', cls: 'nw-u-c-text-muted-2 nw-u-fs-0-8em nw-u-marginright-6px' });
                // v3.4.1: done 后仍可继续生成，不锁按钮
                const isOpening = this.entitiesExecuting.has(cfg.id);
                const regenBtn = actions.createEl('button', { 
                    text: isOpening ? '打开中...' : '继续生成', 
                    cls: 'nw-u-p-4px-10px-2 nw-u-bg-text-accent nw-u-c-white-2 nw-u-b-none nw-u-brd-4px-2 nw-u-cur-pointer-2 nw-u-fs-0-8em nw-u-op-0-8' 
                });
                if (isOpening) {
                    regenBtn.disabled = true;
                    regenBtn.style.opacity = '0.6';
                    regenBtn.style.cursor = 'not-allowed';
                }
                regenBtn.addEventListener('click', () => {
                    if (this.entitiesExecuting.has(cfg.id)) return;
                    this.entitiesExecuting.add(cfg.id);
                    this.plugin._pendingEntityProject = tab.project;
                    this.plugin._pendingEntityContext = { project: tab.project, isEarlyStage: true };
                    const dispatched = this.plugin.executeCommand(cfg.commandId);
                    if (!dispatched) {
                        this.entitiesExecuting.delete(cfg.id);
                        new Notice(`❌ ${cfg.label}生成入口不可用（命令未注册）`, 5000);
                        this.renderTab(tab, true);
                        return;
                    }
                    new Notice(`${cfg.label}生成窗口已打开`, 2000);
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
                    text: isOpening ? '打开中...' : '生成', 
                    cls: 'nw-u-p-4px-14px nw-u-bg-text-accent nw-u-c-white-2 nw-u-b-none nw-u-brd-4px-2 nw-u-cur-pointer-2 nw-u-fs-0-85em' 
                });
                if (isOpening) {
                    genBtn.disabled = true;
                    genBtn.style.opacity = '0.6';
                    genBtn.style.cursor = 'not-allowed';
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
                        new Notice(`❌ ${cfg.label}生成入口不可用（命令未注册）`, 5000);
                        this.renderTab(tab, true);
                        return;
                    }
                    new Notice(`${cfg.label}生成窗口已打开`, 2000);
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
        
        container.createEl('p', { text: '💡 跳过将影响后续全书规划的质量，建议至少生成人物。', cls: 'nw-u-c-text-muted-2 nw-u-fs-0-8em nw-u-margintop-12px-2' });

        const tip = container.createEl('p', { 
            text: '💡 「管理已生成」可批量改名磁盘上的"未命名_N"文件（联动 YAML名称 + H1标题 + 文件名三处）',
            cls: 'nw-u-c-text-muted-2 nw-u-fs-0-78em nw-u-margintop-8px-2'
        });
    }

    async renderWizardWorldviewStep(container: HTMLElement, tab: WizardTab): Promise<void> {
        container.empty();
        
        const step = tab.steps[tab.currentStepIdx];
        const isDone = step.status === 'done';
        const isExecuting = this.wizardStepExecuting.has(step.id);
        const progress = this.wizardStepResults['_worldviewProgress'] || '';
        
        container.createEl('p', { text: `AI 将严格按照模板字段格式生成世界观。包含 ${WV_SECTIONS.length} 个模块：${WV_SECTIONS.join('、')}。`, cls: 'nw-u-c-text-muted-2' });
        container.createEl('p', { text: '⚠️ 此步骤不可跳过，完整的世界观设定是后续所有步骤的基础。', cls: 'nw-u-c-text-accent nw-u-fs-0-85em' });
        
        container.createEl('p', { text: `目标项目: ${tab.project}`, cls: 'nw-u-margintop-8px-2 nw-u-c-text-muted-2 nw-u-fs-0-85em' });
        
        if (isExecuting && progress) {
            const progressEl = container.createDiv({ cls: 'nw-u-margintop-16px-2 nw-u-p-12px-2 nw-u-bg-background-primary-alt nw-u-brd-8px-2' });
            progressEl.createEl('span', { text: `⏳ ${progress}`, attr: { style: 'font-weight:600;', 'data-wv-progress': '' } });
            const progBar = progressEl.createDiv({ cls: 'nw-u-margintop-8px-2 nw-u-h-6px-2 nw-u-bg-background-modifier-bo-3 nw-u-brd-3px-2 nw-u-ov-hidden-2' });
            progBar.createDiv({ cls: 'nw-u-h-100-2 nw-u-w-60 nw-u-bg-text-accent nw-u-animation-nw-progress-anim-2s-ea' });
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
            
            container.createEl('p', { text: '✅ 世界观已生成。', cls: 'nw-u-c-text-success nw-u-fwt-600-2 nw-u-margintop-12px-2' });
            
            // v3.4.2: 内联重新生成按钮（不依赖导航栏）
            const regenBtn = container.createEl('button', { 
                text: '🔄 重新生成世界观', 
                cls: 'nw-u-m-8px-12px-8px-0 nw-u-p-6px-14px nw-u-bg-f59e0b nw-u-c-white-2 nw-u-b-none nw-u-brd-6px-2 nw-u-cur-pointer-2 nw-u-fs-0-9em' 
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
                const summaryDiv = container.createDiv({ cls: 'nw-u-margintop-8px-2 nw-u-fs-0-8em nw-u-c-text-muted-2' });
                summaryDiv.createEl('p', { text: `已生成模块（${WV_SECTIONS.length}个）：` });
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
                container.createEl('p', { text: '📄 检测到世界观文件，内容可能尚未填写完整。', cls: 'nw-u-c-text-accent nw-u-fwt-600-2 nw-u-margintop-12px-2' });
                const viewBtn = container.createEl('button', {
                    text: '📖 打开世界观文件',
                    attr: { style: 'margin:8px 12px 8px 0; padding:6px 14px; border-radius:6px; cursor:pointer; background:var(--background-modifier-border); border:1px solid var(--background-modifier-border);' }
                });
                viewBtn.addEventListener('click', () => {
                    this.showFileContentInline(container, getWorldviewPath(tab.project), '世界观设定');
                });
                const regenBtn = container.createEl('button', {
                    text: '🔄 重新生成世界观',
                    cls: 'nw-u-m-8px-0 nw-u-p-6px-14px nw-u-bg-f59e0b nw-u-c-white-2 nw-u-b-none nw-u-brd-6px-2 nw-u-cur-pointer-2'
                });
                regenBtn.addEventListener('click', () => this.executeWizardStep(tab, step));
            }
        }
    }
}
