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
import { validateFanficSettings, validateWorldviewOutput } from '../../shared/template-validator';
import { readMergedVolumeOutline } from '../../utils/helpers';
import { WritingStyleModal } from '../writing-style-modal';
import { findWritingStyleFile } from '../writing-style-paths';
import { PlanBookModal } from '../plan-book-modal';
import { BatchCreateModal } from '../batch-create-modal';
import { getFanficSettingsPath, isFanficSettingsContentValidEnough } from './fanfic-settings-utils';
import { readProjectMeta, pjFanficDir, SUBDIR_BODY_ROOT } from '../../shared/paths';

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

    async executeWizardStep(tab: WizardTab, step: WizardStep): Promise<void> {
        const isManualStep = step.id === 'writing_style';
        if (!isManualStep) {
            this.wizardStepExecuting.add(step.id);
            step.status = 'executing';
        }

        try {
            switch (step.id) {
                case 'fanfic':
                    await this.executeFanficStep(tab, step);
                    break;
                case 'worldview':
                    await this.executeWorldviewStep(tab, step);
                    break;
                case 'entities':
                    // v3.4.1: 继续生成实体 — 重置 subSteps 为 pending，让生成按钮重新出现
                    step.status = 'pending';
                    if (step.subSteps) {
                        step.subSteps.forEach(s => { if (s.status === 'done') s.status = 'pending'; });
                    }
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
            console.error(`[Wizard] Step ${step.id} execution error:`, e);
            new Notice(`❌ ${step.label} 执行失败: ${e}`, 8000);
            step.status = 'retry';
        } finally {
            this.wizardStepExecuting.delete(step.id);
            // v4.5: 统一渲染出口，避免多个回调叠加导致重复渲染
            const skipAutoAdvance = step.id === 'entities' || step.id === 'setting_lib';
            this.renderTab(tab, skipAutoAdvance);
        }
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
            const path = meta?.match(/##\s*同人设定路径\s*\r?\n\s*(.+)/)?.[1]?.trim();
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

        const result = isFanfic
            ? await this.aiEngine.generateFanficWorldviewForProject(
                this.app,
                tab.project,
                (phase: string) => {
                    this.wizardStepResults['_worldviewProgress'] = phase;
                    updateProgress(phase);
                }
            )
            : await this.aiEngine.generateWorldviewForProject(
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
            new Notice('❌ 世界观生成失败，请重试', 5000);
        }
    }

    private async executeSettingLibStep(tab: WizardTab, step: WizardStep): Promise<void> {
        console.warn('[Wizard:setting_lib] 开始执行设定库生成...');
        const content = await this.aiEngine.generateSettingLibForProject(this.app, tab.project);
        console.warn('[Wizard:setting_lib] AI 返回, content 长度:', content?.length || 0);

        if (content) {
            step.status = 'done';
            console.warn('[Wizard:setting_lib] step.status 设为 done, tab.currentStepIdx=', tab.currentStepIdx);
            this.wizardStepResults['setting_lib'] = content;
            new Notice('✅ 设定库已生成', 3000);
            // v4.5: 不再此处 render，由 finally 统一刷新
        } else {
            step.status = 'retry';
            console.warn('[Wizard:setting_lib] AI 返回空, step.status 设为 retry');
            new Notice('❌ 设定库生成失败，请重试', 5000);
        }
    }

    private async executeWritingStyleStep(tab: WizardTab, step: WizardStep): Promise<void> {
        return new Promise<void>((resolve) => {
            const modal = new WritingStyleModal(this.app, this.plugin, tab.project, () => {
                step.status = 'done';
                this.wizardStepResults['writing_style'] = 'done';
            });
            modal.onClose = async () => {
                if (step.status !== 'done') {
                    const wsFile = await findWritingStyleFile(this.app, tab.project);
                    if (wsFile) {
                        step.status = 'done';
                        this.wizardStepResults['writing_style'] = 'done';
                        new Notice('✅ 检测到已有文笔风格文件，标记为完成', 3000);
                    }
                }
                resolve();
            };
            modal.open();
        });
    }

    private async executeOutlineStep(tab: WizardTab, step: WizardStep): Promise<void> {
        return new Promise<void>((resolve) => {
            const modal = new PlanBookModal(this.app, this.plugin);
            modal.onClose = async () => {
                // v4.0：分卷大纲按卷归档，合并读取后判断是否非空
                const outlineContent = await readMergedVolumeOutline(this.app, tab.project);
                if (outlineContent.trim().length > 0) {
                    step.status = 'done';
                    new Notice('✅ 全书规划已完成', 3000);
                    // v3.5: 移除弹窗
                } else {
                    step.status = 'pending';
                    new Notice('⚠️ 未检测到分卷大纲文件，请重新生成', 5000);
                }
                resolve();
            };
            modal.open();
        });
    }

    private async executeChaptersStep(tab: WizardTab, step: WizardStep): Promise<void> {
        return new Promise<void>((resolve) => {
            const modal = new BatchCreateModal(this.app, this.plugin);
            modal.onClose = async () => {
                // v4.0：章节正文位于 03-大纲与章节/正文/第N卷/，步骤结果分离在 步骤结果/
                const ok = await this.checkChaptersComplete(tab.project);
                if (ok) {
                    const bodyRoot = `${tab.project}/${SUBDIR_BODY_ROOT}`;
                    const chapterFiles = this.app.vault.getFiles().filter(f =>
                        f.path.startsWith(bodyRoot + '/')
                        && /\/第\d+卷\/第\d+章[^/]*_正文\.md$/.test(f.path)
                    );
                    step.status = 'done';
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
