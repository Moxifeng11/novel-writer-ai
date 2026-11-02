/**
 * 向导步骤执行器（v3.5 向导执行逻辑外迁）
 *
 * 从 FullWriterView 外迁的步骤执行方法（dispatcher + 各 executeXxxStep）。
 * 控制器持有共享的 wizardStepResults / wizardStepExecuting 引用（与 view
 * 同一对象），以及 app / plugin / aiEngine 与 view 回调（findWizardTab /
 * renderTab / checkChaptersComplete）。
 */
import { App, Notice } from 'obsidian';
import NovelWriterPlugin from '../../main';
import { AIEngine } from '../../engine/ai-engine';
import { WizardTab, WizardStep } from './wizard-types';
import {
    validateFanficSettings,
    validateOutlineOutput,
    validateSettingLibOutput,
    validateWorldviewOutput,
} from '../../shared/template-validator';
import { validateWizardStepContent } from './wizard-step-validators';
import { readMergedVolumeOutline } from '../../utils/helpers';
import { WritingStyleModal } from '../writing-style-modal';
import { PlanBookModal } from '../plan-book-modal';
import { BatchCreateModal } from '../batch-create-modal';
import { attachFanficPathToProject, getFanficSettingsPath, isFanficSettingsContentValidEnough } from './fanfic-settings-utils';
import { parseProjectMeta } from '../../shared/fanfic-rules';
import { readProjectMeta, pjFanficDir, SUBDIR_BODY_ROOT } from '../../shared/paths';
import { StorySettingsModal } from '../story-settings-modal';
import { createLogger } from '../../shared/logger';
import { nextFrame } from '../../shared/yield';


const log = createLogger('WizardStepExecutors');
/**
 * WizardStepExecutors 类。
 */
export class WizardStepExecutors {
    private app: App;
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;
    private wizardStepResults: Record<string, string>;
    private wizardStepExecuting: Set<string>;
    private findWizardTab: (id: string) => WizardTab | undefined;
    private renderTab: (tab: WizardTab, skipAutoAdvance?: boolean) => void;
    private checkChaptersComplete: (project: string) => Promise<boolean>;
    private getTabContent: () => HTMLDivElement;

    constructor(
        app: App,
        plugin: NovelWriterPlugin,
        aiEngine: AIEngine,
        wizardStepResults: Record<string, string>,
        wizardStepExecuting: Set<string>,
        findWizardTab: (id: string) => WizardTab | undefined,
        renderTab: (tab: WizardTab, skipAutoAdvance?: boolean) => void,
        checkChaptersComplete: (project: string) => Promise<boolean>,
        getTabContent: () => HTMLDivElement,
    ) {
        this.app = app;
        this.plugin = plugin;
        this.aiEngine = aiEngine;
        this.wizardStepResults = wizardStepResults;
        this.wizardStepExecuting = wizardStepExecuting;
        this.findWizardTab = findWizardTab;
        this.renderTab = renderTab;
        this.checkChaptersComplete = checkChaptersComplete;
        this.getTabContent = getTabContent;
    }

    /**
     * executeWizardStep 方法。
     * @param tab - 页签
     * @param step - 步骤
     */
    async executeWizardStep(tab: WizardTab, step: WizardStep): Promise<void> {
        // writing_style/outline/chapters 均为"打开弹窗"步骤：AI 生成由弹窗内部按钮触发，
        // 需用户在弹窗内二次确认，不能进入 executing 状态，否则 nav bar 会误导性显示"生成中...请等待 AI 返回"。
        const isModalStep = step.id === 'writing_style' || step.id === 'outline' || step.id === 'chapters' || step.id === 'story_structure';
        if (!isModalStep) {
            this.wizardStepExecuting.add(step.id);
            step.status = 'executing';
            // 立即重新渲染 UI，让用户"看到"执行中状态，而不是黑盒（outline/chapters 打开 Modal 后用户才能看到变化）
            this.renderTab(tab, true);
            // 让出执行权，让浏览器有机会渲染进度条（否则后续 modal.open / await 会阻塞绘制）
            await nextFrame();
        }

        try {
            switch (step.id) {
                case 'fanfic':
                    await this.executeFanficStep(tab, step);
                    break;
                case 'story_structure':
                    this.executeStoryStructureStep(tab, step);
                    break;
                case 'worldview':
                    await this.executeWorldviewStep(tab, step);
                    break;
                case 'setting_lib':
                    await this.executeSettingLibStep(tab, step);
                    break;
                case 'writing_style':
                    await this.executeWritingStyleStep(tab, step);
                    break;
                case 'outline':
                    await this.executeOutlineStep(tab, step);
                    break;
                case 'chapters':
                    await this.executeChaptersStep(tab, step);
                    break;
            }
        } catch (e) {
            log.error(`[Wizard] Step ${step.id} execution error:`, e);
            new Notice(`❌ ${step.label} 执行失败: ${e}`, 8000);
            step.status = 'retry';
        } finally {
            this.wizardStepExecuting.delete(step.id);
            // v4.5: 统一渲染出口，避免多个回调叠加导致重复渲染
            // 执行完成后一律停留在当前步骤，由用户手动点击「下一步 →」步进，不再自动跳转
            this.renderTab(tab, true);
        }
    }

    private executeStoryStructureStep(tab: WizardTab, step: WizardStep): void {
        const modal = new StorySettingsModal(this.app, this.plugin, tab.project, () => {
            step.status = 'done';
            this.renderTab(tab, true);
        });
        modal.open();
    }

    private async executeFanficStep(tab: WizardTab, step: WizardStep): Promise<void> {
        const adapter = this.app.vault.adapter;
        const fanficDir = pjFanficDir(tab.project);
        if (!(await adapter.exists(fanficDir))) {
            await adapter.mkdir(fanficDir);
        }

        const fanficResultKey = `fanfic:${tab.project}`;
        let content = this.wizardStepResults[fanficResultKey] || '';
        if (!content.trim()) {
            const meta = await readProjectMeta(this.app, tab.project);
            const path = meta ? parseProjectMeta(meta).fanficPath : '';
            if (path && await adapter.exists(path)) content = await adapter.read(path);
        }
        if (!content.trim()) {
            step.status = 'pending';
            new Notice('⚠️ 请先保存同人设定，再执行此步骤', 6000);
            return;
        }

        const validation = isFanficSettingsContentValidEnough(content);
        if (!validation.valid) {
            step.status = 'pending';
            new Notice(`⚠️ 同人设定缺少字段: ${validation.missingFields.slice(0, 5).join(', ')}`, 8000);
            return;
        }

        const filePath = getFanficSettingsPath(tab.project, content, tab.project);
        await adapter.write(filePath, content);
        await attachFanficPathToProject(this.app, tab.project, filePath);
        this.wizardStepResults[fanficResultKey] = content;

        step.status = 'done';
        new Notice('✅ 同人设定已保存并通过校验', 3000);
        // v3.5: 移除弹窗——内容通过步骤内联展示
    }

    private async executeWorldviewStep(tab: WizardTab, step: WizardStep): Promise<void> {
        // 同人项目使用不同的世界观生成路径：从导入的原作设定中提取
        const isFanfic = tab.projectType === 'fanfic';

        const updateProgress = (text: string) => {
            const tc = this.getTabContent();
            if (!tc) return;
            const progressSpan = tc.querySelector<HTMLElement>('[data-wv-progress]');
            if (progressSpan) {
                progressSpan.textContent = `⏳ ${text}`;
            } else {
                const tabRef = this.findWizardTab(tab.id);
                if (tabRef) this.renderTab(tabRef, true);
            }
        };

        let result = '';
        let failure: string | undefined;

        if (isFanfic) {
            result = await this.aiEngine.generateFanficWorldviewForProject(
                this.app,
                tab.project,
                (phase: string) => {
                    this.wizardStepResults['_worldviewProgress'] = phase;
                    updateProgress(phase);
                }
            );
        } else {
            const outcome = await this.aiEngine.generateWorldviewForProject(
                this.app,
                tab.project,
                undefined,
                (phase: string, module?: string) => {
                    if (module) {
                        const text = `正在生成：${module}`;
                        this.wizardStepResults['_worldviewProgress'] = text;
                        updateProgress(text);
                    } else {
                        this.wizardStepResults['_worldviewProgress'] = phase;
                        updateProgress(phase);
                    }
                }
            );
            result = outcome.content;
            failure = outcome.error;
        }

        delete this.wizardStepResults['_worldviewProgress'];

        if (result) {
            const validation = validateWorldviewOutput(result);
            this.wizardStepResults['worldview'] = result;
            if (validation.valid) {
                step.status = 'done';
                new Notice('✅ 世界观生成成功，通过校验', 3000);
            } else {
                step.status = 'complete_with_warnings';
                new Notice(`⚠️ 世界观已生成，但缺少: ${validation.missingFields.slice(0, 5).join(', ')}。可点击"重新生成"重试。`, 8000);
            }
            // v3.5: 移除弹窗——Modal 在 Obsidian 主窗口打开，遮挡工作台"下一步"按钮
        } else {
            step.status = 'retry';
            new Notice(`❌ 世界观生成失败：${failure || '未知错误，请检查 API 密钥与网络'}`, 10000);
        }
    }

    private async executeSettingLibStep(tab: WizardTab, step: WizardStep): Promise<void> {
        log.debug('[Wizard:setting_lib] worldview from cache:', !!this.wizardStepResults['worldview']);
        log.warn('[Wizard:setting_lib] 开始执行设定库生成...');
        const cachedWorldview = this.wizardStepResults['worldview'];
        const content = await this.aiEngine.generateSettingLibForProject(this.app, tab.project, cachedWorldview);
        log.warn('[Wizard:setting_lib] AI 返回, content 长度:', content?.length || 0);

        if (content) {
            const validation = validateSettingLibOutput(content);
            this.wizardStepResults['setting_lib'] = content;
            if (validation.valid) {
                step.status = 'done';
                log.warn('[Wizard:setting_lib] step.status 设为 done, tab.currentStepIdx=', tab.currentStepIdx);
                new Notice('✅ 设定库已生成并通过校验', 3000);
            } else {
                step.status = 'complete_with_warnings';
                log.warn('[Wizard:setting_lib] 内容不完整:', validation.missingFields);
                new Notice(`⚠️ 设定库已生成，但缺少：${validation.missingFields.slice(0, 5).join('、')}。请重新生成或跳过此步骤。`, 8000);
            }
            // v4.5: 不再此处 render，由 finally 统一刷新
        } else {
            step.status = 'retry';
            log.warn('[Wizard:setting_lib] AI 返回空, step.status 设为 retry');
            new Notice('❌ 设定库生成失败，请重试', 5000);
        }
    }

    private async executeWritingStyleStep(tab: WizardTab, step: WizardStep): Promise<void> {
        return new Promise<void>((resolve) => {
            let saved = false;
            const modal = new WritingStyleModal(this.app, this.plugin, tab.project, () => {
                saved = true;
            });
            modal.onClose = async () => {
                const result = await validateWizardStepContent(this.app, tab.project, 'writing_style');
                if (result.valid) {
                    step.status = 'done';
                    this.wizardStepResults['writing_style'] = 'done';
                    new Notice(saved ? '✅ 文笔风格已保存并通过校验' : '✅ 检测到完整文笔风格，标记为完成', 3000);
                } else {
                    step.status = 'complete_with_warnings';
                    new Notice(`⚠️ 文笔风格不完整，缺少：${result.missingFields.slice(0, 5).join('、')}。请重新生成或跳过此步骤。`, 8000);
                }
                resolve();
            };
            modal.open();
        });
    }

    private async executeOutlineStep(tab: WizardTab, step: WizardStep): Promise<void> {
        return new Promise<void>((resolve) => {
            // 必须把向导绑定的项目传进去：旧实现不传，弹窗默认选中「检测到的第一个项目」，
            // 从项目 B 的向导点执行时可能给项目 A 生成并覆盖分卷大纲。
            const modal = new PlanBookModal(this.app, this.plugin, tab.project);
            modal.onClose = async () => {
                // v4.0：分卷大纲按卷归档，合并读取后判断是否非空
                const outlineContent = await readMergedVolumeOutline(this.app, tab.project);
                if (outlineContent.trim().length === 0) {
                    step.status = 'pending';
                    new Notice('⚠️ 未检测到分卷大纲文件，请重新生成', 5000);
                } else {
                    const validation = validateOutlineOutput(outlineContent);
                    if (validation.valid) {
                        step.status = 'done';
                        new Notice('✅ 全书规划已完成并通过校验', 3000);
                    } else {
                        step.status = 'complete_with_warnings';
                        new Notice(`⚠️ 分卷大纲不完整，缺少：${validation.missingFields.slice(0, 5).join('、')}。请重新生成或跳过此步骤。`, 8000);
                    }
                }
                resolve();
            };
            modal.open();
        });
    }

    private async executeChaptersStep(tab: WizardTab, step: WizardStep): Promise<void> {
        return new Promise<void>((resolve) => {
            // 同上：批量建章弹窗支持 preferredProject，必须传向导项目
            const modal = new BatchCreateModal(this.app, this.plugin, tab.project);
            modal.onClose = async () => {
                // v4.0：章节正文位于 03-大纲与章节/正文/第N卷/，步骤结果分离在 步骤结果/
                const ok = await this.checkChaptersComplete(tab.project);
                if (ok) {
                    const validation = await validateWizardStepContent(this.app, tab.project, 'chapters');
                    if (!validation.valid) {
                        step.status = 'complete_with_warnings';
                        new Notice(`⚠️ 章节内容不完整：${validation.missingFields.slice(0, 3).join('、')}。请重新创建或跳过此步骤。`, 8000);
                        resolve();
                        return;
                    }
                    const bodyRoot = `${tab.project}/${SUBDIR_BODY_ROOT}`;
                    const chapterFiles = this.app.vault.getFiles().filter(f =>
                        f.path.startsWith(bodyRoot + '/')
                        && /\/第\d+卷\/第\d+章[^/]*_正文\.md$/.test(f.path)
                    );
                    step.status = 'done';
                    // v4.5: 记录 ChapterContext 数据来源 — write-chapter-modal 通过 ContextManager.buildPromptSection 从磁盘读取
                    const hasWorldview = !!this.wizardStepResults['worldview'];
                    const hasSettingLib = !!this.wizardStepResults['setting_lib'];
                    log.debug(`[Wizard:chapters] 已创建 ${chapterFiles.length} 个章节文件，project=${tab.project}`);
                    log.debug(`[Wizard:chapters] ChapterContext 数据来源：write-chapter-modal 将通过 ContextManager.buildPromptSection 从磁盘读取 worldview/settingLib/characters/timeline`);
                    log.debug(`[Wizard:chapters] wizardStepResults 缓存：worldview=${hasWorldview}, settingLib=${hasSettingLib}（写作工作台不依赖此缓存，读磁盘）`);
                    new Notice(`✅ 已创建 ${chapterFiles.length} 个章节文件`, 3000);
                } else {
                    step.status = 'pending';
                    new Notice('⚠️ 未检测到章节文件，请重新创建', 5000);
                }
                resolve();
            };
            modal.open();
        });
    }
}
