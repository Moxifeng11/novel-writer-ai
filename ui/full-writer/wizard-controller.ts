import { App, TFile, Notice, Modal } from 'obsidian';
import { pjVolumeOutlineDir, getSettingLibPath, getWorldviewPath, readProjectMeta, SUBDIR_BODY_ROOT, SUBDIR_OUTLINE_ROOT } from '../../shared/paths';
import { WizardTab, WizardStep, buildWizardSteps as buildWizardStepsExternal } from './wizard-types';
import { WizardStepRenderers } from './wizard-step-renderers';
import { WizardStepExecutors } from './wizard-step-executors';
import { WizardChecker } from '../wizard-checker';
import { getWritingStyleCandidatePaths } from '../writing-style-paths';
import type { WizardViewAccess } from './wizard-view-access';
import { isFanficSettingsContentValidEnough } from './fanfic-settings-utils';
import { parseProjectMeta } from '../../shared/fanfic-rules';
import { validateWizardStepContent } from './wizard-step-validators';

/**
 * WizardController — 向导子系统控制器
 * 
 * 从 FullWriterView 抽取，负责：
 * - 打开项目向导 (openWizardForProject)
 * - 渲染向导 Tab 内容 (renderTabContent)
 * - 渲染当前步骤内容 (renderCurrentStep)
 * - 渲染步骤导航栏 (renderNavBar)
 * 
 * 通过 WizardViewAccess 接口访问主视图，消除 as any。
 */
export class WizardController {
    constructor(
        private view: WizardViewAccess,
        private stepRenderers: WizardStepRenderers,
        private stepExecutors: WizardStepExecutors,
        private checker: WizardChecker,
    ) {}

    buildWizardSteps(projectType: 'original' | 'fanfic'): WizardStep[] {
        return buildWizardStepsExternal(projectType);
    }

    async openWizardForProject(project: string): Promise<void> {
        const existingTab = this.view.tabs.find(
            (t: { type: string; project: string }) => t.type === 'wizard' && t.project === project
        );
        if (existingTab) {
            await this.view.pushNav(existingTab.id);
            return;
        }

        let projectType: 'original' | 'fanfic' = 'original';
        try {
            const content = await readProjectMeta(this.view.app, project);
            if (content) {
                const typeMatch = content.match(/##\s*类型\s*\r?\n\s*(.+)/);
                const typeVal = typeMatch?.[1]?.trim();
                if (typeVal === 'fanfic' || typeVal === '同人') {
                    projectType = 'fanfic';
                }
            }
        } catch (e) { /* 默认为原创 */ }

        const steps = this.buildWizardSteps(projectType);

        const adapter = this.view.app.vault.adapter;
        let startIdx = 0;

        const isPopulated = (val: string | undefined): boolean => {
            if (!val || val === '' || val === '""' || val === '—' || val === '-') return false;
            return !/^\{\{.*\}\}$/.test(val);
        };

        const extractFMField = (content: string, fieldName: string): string | undefined => {
            const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
            if (!fmMatch) return undefined;
            const m = fmMatch[1].match(new RegExp(`^${fieldName}:\\s*(.+)$`, 'm'));
            return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
        };

        let projectMetaContent: string | null = null;
        try { projectMetaContent = await readProjectMeta(this.view.app, project); } catch (e) { /* ignore */ }

        // fanfic: 只信任 .project 指向且校验通过的同人设定文件
        if (projectType === 'fanfic') {
            // 复用 parseProjectMeta，避免与 shared/fanfic-rules 的解析规则漂移
            const fanficPath = projectMetaContent ? parseProjectMeta(projectMetaContent).fanficPath : '';
            if (fanficPath && await adapter.exists(fanficPath)) {
                const content = await adapter.read(fanficPath);
                if (isFanficSettingsContentValidEnough(content).valid) {
                    const fstep = steps.find(s => s.id === 'fanfic');
                    if (fstep) fstep.status = 'done';
                }
            }
        }

        // 统一使用 check*Complete 做内容完整性判定
        const chkWorldview = await this.view.checkWorldviewComplete(project);
        if (chkWorldview) {
            const ws = steps.find(s => s.id === 'worldview');
            if (ws) ws.status = 'done';
        }

        const chkSettingLib = await this.view.checkSettingLibComplete(project);
        if (chkSettingLib) {
            const sl = steps.find(s => s.id === 'setting_lib');
            if (sl) sl.status = 'done';
        }

        const chkWritingStyle = await this.view.checkWritingStyleComplete(project);
        if (chkWritingStyle) {
            const ws = steps.find(s => s.id === 'writing_style');
            if (ws) ws.status = 'done';
        }

        const chkEntities = await this.view.checkEntitiesComplete(project);
        const es = steps.find(s => s.id === 'entities');
        if (es && chkEntities) {
            if (es.subSteps) {
                es.subSteps.forEach(ss => { ss.status = 'done'; });
            }
            es.status = 'done';
        }

        const chkOutline = await this.view.checkOutlineComplete(project);
        if (chkOutline) {
            const os = steps.find(s => s.id === 'outline');
            if (os) os.status = 'done';
        }

        for (let i = 0; i < steps.length; i++) {
            if (steps[i].status !== 'done') {
                startIdx = i;
                break;
            }
            startIdx = i;
        }

        const allPrevDone = steps.slice(0, -1).every(s => s.status === 'done' || s.status === 'skipped');
        if (allPrevDone) {
            const completeStep = steps.find(s => s.id === 'complete');
            if (completeStep) completeStep.status = 'done';
        }

        const wizardId = `wizard-${Date.now()}`;
        this.view.tabs.push({
            id: wizardId,
            label: `🧙 ${project} 向导`,
            type: 'wizard',
            project,
            projectType,
            currentStepIdx: Math.min(startIdx, steps.length - 1),
            steps,
        });
        await this.view.pushNav(wizardId);
    }

    async renderTabContent(tab: WizardTab, skipAutoAdvance = false): Promise<void> {
        // BUG-H fix: 切换步骤前关闭已打开的大纲树 Modal
        this.view.closeOutlineTreeModal();
        this.view.tabContent.empty();

        if (!(await this.view.app.vault.adapter.exists(tab.project))) {
            const idx = this.view.tabs.findIndex((t: { id: string }) => t.id === tab.id);
            if (idx >= 0) this.view.tabs.splice(idx, 1);
            new Notice(`⚠️ 项目「${tab.project}」不存在，已关闭其向导`, 5000);
            this.view.popNav();
            return;
        }

        await this.checker.restoreWizardStepStatus(tab, skipAutoAdvance);

        const container = this.view.tabContent.createDiv({ cls: 'nw-wizard-container' });

        const sidebar = container.createDiv({ cls: 'nw-wizard-sidebar' });
        sidebar.createEl('h4', { text: '📋 创建步骤', cls: 'nw-wizard-sidebar-title' });

        for (let i = 0; i < tab.steps.length; i++) {
            const step = tab.steps[i];
            const stepCls = ['nw-wizard-step-item'];
            if (i === tab.currentStepIdx) stepCls.push('nw-wizard-step-active');
            else if (step.status === 'done') stepCls.push('nw-wizard-step-done');
            else stepCls.push('nw-wizard-step-pending');
            const stepEl = sidebar.createDiv({ cls: stepCls.join(' ') });

            const statusIcon = step.status === 'done' ? '✅ ' : step.status === 'active' ? '▶ ' : step.status === 'skipped' ? '⏭ ' : '○ ';
            stepEl.createSpan({ text: `${statusIcon}${step.icon} ${step.label}` });

            const canNavigate = i <= tab.currentStepIdx || step.id === 'entities' || step.status === 'done' || step.status === 'skipped';
            if (canNavigate && i !== tab.currentStepIdx) {
                stepEl.addEventListener('click', () => {
                    tab.currentStepIdx = i;
                    this.renderTabContent(tab, true);
                });
            } else if (!canNavigate) {
                stepEl.addClass('nw-wizard-step-disabled');
                stepEl.setAttribute('title', '请先完成前置步骤');
            }

            if (step.subSteps && i === tab.currentStepIdx) {
                for (const sub of step.subSteps) {
                    const subCls = ['nw-wizard-substep'];
                    if (sub.status === 'done') subCls.push('nw-wizard-substep-done');
                    else if (sub.status === 'active') subCls.push('nw-wizard-substep-active');
                    else subCls.push('nw-wizard-substep-pending');
                    const subEl = sidebar.createDiv({ cls: subCls.join(' ') });
                    subEl.createSpan({ text: `${sub.status === 'done' ? '✅' : sub.status === 'active' ? '▶' : '○'} ${sub.label}` });
                }
            }
        }

        const contentArea = container.createDiv({ cls: 'nw-wizard-content-area' });
        
        await this.renderCurrentStep(tab, contentArea, sidebar);
    }

    async renderCurrentStep(tab: WizardTab, contentArea: HTMLElement, sidebar: HTMLElement): Promise<void> {
        const step = tab.steps[tab.currentStepIdx];
        if (!step) return;
        
        contentArea.createEl('h3', { text: `${step.icon} ${step.label}` });
        
        if (step.id === 'complete' && step.status === 'done') {
            contentArea.createEl('div', { text: '✅ 项目已完成，可以开始写作', attr: { style: 'font-size:1.1em; font-weight:600; color:var(--text-success); margin-bottom:16px; padding:12px; background:var(--background-secondary); border-radius:8px; text-align:center;' } });
        }
        
        const stepContent = contentArea.createDiv({ attr: { style: `flex: 1; min-height: var(--nw-step-min-h);` } });
        
        switch (step.id) {
            case 'fanfic':
                await this.stepRenderers.renderWizardFanficStep(stepContent, tab);
                break;
            case 'entities':
                await this.stepRenderers.renderWizardEntitiesStep(stepContent, tab);
                break;
            case 'worldview':
                await this.stepRenderers.renderWizardWorldviewStep(stepContent, tab);
                break;
            case 'setting_lib':
                await this.stepRenderers.renderWizardSettingLibStep(stepContent, tab);
                break;
            case 'writing_style':
                await this.stepRenderers.renderWizardWritingStyleStep(stepContent, tab);
                break;
            case 'outline':
                await this.stepRenderers.renderWizardOutlineStep(stepContent, tab);
                break;
            case 'chapters':
                await this.stepRenderers.renderWizardChaptersStep(stepContent, tab);
                break;
            case 'complete':
                await this.stepRenderers.renderWizardCompleteStep(stepContent, tab);
                break;
        }
        
        const navBar = contentArea.createDiv({ attr: { style: `margin-top: 16px; display: flex; justify-content: space-between; align-items: center;` } });
        this.renderNavBar(tab, step, navBar, contentArea);
    }

    renderNavBar(tab: WizardTab, step: WizardStep, navBar: HTMLElement, contentArea?: HTMLElement): void {
        const isStep0 = tab.currentStepIdx === 0;
        const isLastStep = tab.currentStepIdx === tab.steps.length - 1;
        const isMandatory = step.id !== 'entities';
        const isExecuting = this.view.wizardStepExecuting.has(step.id);
        const isDone = step.status === 'done';
        const isPending = step.status === 'pending' || step.status === 'active';
        
        // 按钮样式已迁移至 styles.css: .nw-wizard-nav-btn / -primary / -disabled / -warning
        
        // 左侧按钮 — 使用 CSS 类名
        if (isStep0) {
            const returnBtn = navBar.createEl('button', { text: '← 返回项目列表', cls: 'nw-wizard-nav-btn' });
            returnBtn.addEventListener('click', () => {
                const wizardIdx = this.view.tabs.findIndex((t: { id: string }) => t.id === tab.id);
                if (wizardIdx >= 0) {
                    this.view.tabs.splice(wizardIdx, 1);
                    this.view.popNav();
                }
            });
        } else {
            const prevBtn = navBar.createEl('button', { text: '← 上一步', cls: 'nw-wizard-nav-btn' });
            prevBtn.addEventListener('click', () => {
                tab.currentStepIdx--;
                this.renderTabContent(tab, true);
            });
        }

        const rightGroup = navBar.createDiv({ cls: 'nw-wizard-nav-btn-group' });
        
        if (isLastStep) {
            const enterBtn = rightGroup.createEl('button', { text: '🎯 进入写作', cls: 'nw-wizard-nav-btn-primary' });
            enterBtn.addEventListener('click', async () => {
                const chaptersStep = tab.steps.find(s => s.id === 'chapters');
                if (chaptersStep && chaptersStep.status !== 'skipped') {
                    const validation = await validateWizardStepContent(this.view.app, tab.project, 'chapters');
                    if (!validation.valid) {
                        new Notice(`⚠️ 章节内容不完整：${validation.missingFields.slice(0, 5).join('、')}。请先完成批量建章。`, 10000);
                        return;
                    }
                }
                step.status = 'done';
                this.view.closeTab(tab.id);
                await this.view.openFirstUnwrittenChapter(tab.project);
            });
            return;
        }
        
        if (isExecuting) {
            rightGroup.createEl('button', { text: '⏳ 生成中...', cls: 'nw-wizard-nav-btn-disabled' });
            rightGroup.createSpan({ text: '请等待 AI 返回...', cls: 'nw-wizard-nav-hint' });
            return;
        }
        
        if (isPending && isMandatory) {
            const hasExistingFile = (
                (step.id === 'setting_lib' && this.view.app.vault.getAbstractFileByPath(getSettingLibPath(tab.project))) ||
                (step.id === 'worldview' && this.view.app.vault.getAbstractFileByPath(getWorldviewPath(tab.project))) ||
                (step.id === 'writing_style' && getWritingStyleCandidatePaths(tab.project).some(p => !!this.view.app.vault.getAbstractFileByPath(p))) ||
                (step.id === 'outline' && (
                    this.view.app.vault.getFiles().some(f =>
                        f.path.startsWith(`${pjVolumeOutlineDir(tab.project)}/`) && f.name.endsWith('_分卷大纲.md'))
                    || !!this.view.app.vault.getAbstractFileByPath(`${tab.project}/${SUBDIR_OUTLINE_ROOT}/分卷大纲.md`)
                )) ||
                (step.id === 'chapters' && this.view.app.vault.getFiles().some(f =>
                    f.path.startsWith(`${tab.project}/${SUBDIR_BODY_ROOT}/`)
                    && /\/第\d+卷\/第\d+章[^/]*_正文\.md$/.test(f.path)
                ))
            );
            const execBtn = rightGroup.createEl('button', { text: '▶ 执行', cls: 'nw-wizard-nav-btn-primary' });
            execBtn.addEventListener('click', () => this.stepExecutors.executeWizardStep(tab, step));
            if (hasExistingFile) {
                const nextBtn = rightGroup.createEl('button', { text: '下一步 →', cls: 'nw-wizard-nav-btn-warning', attr: { title: '校验内容完整后进入下一步' } });
                nextBtn.addEventListener('click', () => { void this.tryAdvance(tab, step); });
            } else if (isStep0) {
                rightGroup.createEl('button', { text: '下一步 →', cls: 'nw-wizard-nav-btn-disabled', attr: { title: '请先完成当前步骤' } });
            }
        } else if (isPending && !isMandatory) {
            // 实体步骤只保留"跳过"：生成由步骤内的分类按钮打开对应生成窗口，避免两套生成路径。
            const skipBtn = rightGroup.createEl('button', { text: '跳过实体，进入下一步 →', cls: 'nw-wizard-nav-btn-warning' });
            skipBtn.addEventListener('click', () => this.skipStep(tab, step));
        } else if (isDone || step.status === 'skipped') {
            // 前进前做内容校验：不完整则阻止并提示，必须重新生成或显式跳过
            const nextBtn = rightGroup.createEl('button', { text: '下一步 →', cls: 'nw-wizard-nav-btn-primary' });
            nextBtn.addEventListener('click', () => { void this.tryAdvance(tab, step); });
        } else if (step.status === 'retry') {
            const retryBtn = rightGroup.createEl('button', { text: '🔄 重新生成', cls: 'nw-wizard-nav-btn-primary' });
            retryBtn.addEventListener('click', () => this.stepExecutors.executeWizardStep(tab, step));
        } else if (step.status === 'complete_with_warnings') {
            const retryBtn = rightGroup.createEl('button', { text: '🔄 重新生成', cls: 'nw-wizard-nav-btn-primary' });
            retryBtn.addEventListener('click', () => this.stepExecutors.executeWizardStep(tab, step));
            const skipBtn = rightGroup.createEl('button', { text: '跳过此步骤 →', cls: 'nw-wizard-nav-btn-warning' });
            skipBtn.addEventListener('click', () => {
                const ok = window.confirm(`「${step.label}」内容不完整。跳过后将带着缺失内容进入后续步骤，确定跳过？`);
                if (ok) this.skipStep(tab, step);
            });
        }
    }

    /** 校验当前步骤内容后再前进；不完整时阻止并留在当前步骤 */
    private async tryAdvance(tab: WizardTab, step: WizardStep): Promise<void> {
        // 用户已显式跳过的步骤：再次前进时不再重复校验，避免被重新拉回「内容不完整」
        if (step.status === 'skipped') {
            tab.currentStepIdx++;
            this.renderTabContent(tab, true);
            return;
        }
        const validation = await validateWizardStepContent(this.view.app, tab.project, step.id);
        if (!validation.valid) {
            step.status = 'complete_with_warnings';
            new Notice(
                `⚠️ ${step.label} 内容不完整：${validation.missingFields.slice(0, 5).join('、')}${validation.missingFields.length > 5 ? ' 等' : ''}。请重新生成，或点击「跳过此步骤」。`,
                12000
            );
            this.renderTabContent(tab, true);
            return;
        }

        if (step.status !== 'done') step.status = 'done';
        tab.currentStepIdx++;
        this.renderTabContent(tab, true);
    }

    /** 显式跳过（用户确认后调用） */
    private skipStep(tab: WizardTab, step: WizardStep): void {
        step.status = 'skipped';
        if (step.subSteps) step.subSteps.forEach(s => s.status = 'skipped');
        tab.currentStepIdx++;
        this.renderTabContent(tab, true);
    }
}
