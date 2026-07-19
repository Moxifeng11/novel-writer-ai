import { App, Modal, Setting, Notice, TFile } from 'obsidian';
import NovelWriterAI from '../main';
import { ContextManager } from '../engine/context-manager';
import { AIEngine } from '../engine/ai-engine';
import { getChaptersForProject } from './project-utils';
import { readMergedVolumeOutline } from '../utils/helpers';
import { pjWorldview, pjCharsDir, pjLocsDir, pjFactionsDir, pjItemsDir, SUBDIR_OUTLINE_ROOT } from '../shared/paths';
import { WV_SECTIONS } from '../shared/format-constants';
import { WizardStep, buildWizardSteps } from './full-writer/wizard-types';
import { createLogger } from '../shared/logger';


const log = createLogger('ProjectWizardModal');
interface WizardProjectInfo {
    name: string;
    genre: string;
    description: string;
    projectType: 'original' | 'fanfic';
    sourceWork: string;
    sourceWorldview: string;
    projectPath: string;
}

/**
 * @deprecated 旧版项目向导实现
 * 项目向导已重构为 WizardController 模式，核心入口功能正常
 * 此类仅作为历史代码保留，不再推荐使用
 * 推荐使用: ui/full-writer/wizard-controller.ts 中的 WizardController
 */
export class ProjectWizardModal extends Modal {
    private plugin: NovelWriterAI;
    private projectInfo: WizardProjectInfo;
    private steps: WizardStep[] = [];
    private currentStepIdx = 0;
    private currentSubStepIdx = 0;
    private sidebarEl!: HTMLElement;
    private contentEl_right!: HTMLElement;
    private navBar!: HTMLElement;

    constructor(app: App, plugin: NovelWriterAI, projectInfo: WizardProjectInfo) {
        super(app);
        this.plugin = plugin;
        this.projectInfo = projectInfo;
        this.steps = buildWizardSteps(this.projectInfo.projectType);
    }

    /** v3.4.2: 检测项目已有文件，自动标记步骤状态 */
    private async detectExistingFiles(): Promise<void> {
        const project = this.projectInfo.name;
        const adapter = this.app.vault.adapter;
        const ENTITY_TEMPLATES = new Set(['人物模板.md', '地点模板.md', '势力模板.md', '物品功法模板.md']);

        // 世界观 — 严格字段：frontmatter 必须有名称为非空值
        const wvPath = pjWorldview(project);
        if (await adapter.exists(wvPath)) {
            try {
                const wvContent = await adapter.read(wvPath);
                const fmMatch = wvContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
                if (fmMatch) {
                    const m = fmMatch[1].match(/^(?:世界名称|项目名称):\s*["']?(.+?)["']?(\n|$)/m);
                    if (m && m[1].trim() && m[1].trim() !== '""' && m[1].trim() !== '" "' && !/^\{\{.*\}\}$/.test(m[1].trim())) {
                        const ws = this.steps.find(s => s.id === 'worldview');
                        if (ws) ws.status = 'done';
                    }
                }
            } catch (e) { log.warn('[小说工坊] restoreWizardStepStatus 读取世界观文件失败:', e instanceof Error ? e.message : e); }
        }

        // 实体
        const countRealEntityFiles = async (dirPath: string): Promise<number> => {
            if (!await adapter.exists(dirPath)) return 0;
            const flist = await adapter.list(dirPath);
            return flist.files.filter(f => {
                const b = f.replace(/^.*\//, '');
                return !ENTITY_TEMPLATES.has(b) && b.endsWith('.md');
            }).length;
        };
        const es = this.steps.find(s => s.id === 'entities');
        if (es) {
            if (await countRealEntityFiles(pjCharsDir(project)) > 0 && es.subSteps) {
                const ss = es.subSteps.find(s => s.id === 'characters'); if (ss) ss.status = 'done';
            }
            if (await countRealEntityFiles(pjLocsDir(project)) > 0 && es.subSteps) {
                const ss = es.subSteps.find(s => s.id === 'locations'); if (ss) ss.status = 'done';
            }
            if (await countRealEntityFiles(pjFactionsDir(project)) > 0 && es.subSteps) {
                const ss = es.subSteps.find(s => s.id === 'factions'); if (ss) ss.status = 'done';
            }
            if (await countRealEntityFiles(pjItemsDir(project)) > 0 && es.subSteps) {
                const ss = es.subSteps.find(s => s.id === 'items'); if (ss) ss.status = 'done';
            }
        }

        // 大纲（v4.0：合并读取 分卷大纲/第N卷_分卷大纲.md，兼容旧单文件）
        try {
            const olContent = await readMergedVolumeOutline(this.app, project);
            const bodyAfterFM = olContent.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim();
            if (bodyAfterFM.length > 80 && !bodyAfterFM.includes('{{')) {
                const os = this.steps.find(s => s.id === 'outline');
                if (os) os.status = 'done';
            }
        } catch (e) { log.warn('[小说工坊] restoreWizardStepStatus 读取大纲文件失败:', e instanceof Error ? e.message : e); }

        // 批量建章 — 检测是否已生成章节正文/步骤结果
        // v4.0：卷目录已下沉到 03-大纲与章节/正文/第N卷 与 步骤结果/第N卷/第M章。
        try {
            let hasChapter = false;
            // v4.0：正文目录优先（正文/第N卷/第M章[_标题]_正文.md）
            for (const branch of ['正文', '步骤结果']) {
                const branchRoot = `${project}/${SUBDIR_OUTLINE_ROOT}/${branch}`;
                if (!(await adapter.exists(branchRoot))) continue;
                const rootList = await adapter.list(branchRoot);
                for (const volDir of rootList.folders) {
                    const volName = volDir.replace(/^.*\//, '');
                    if (!/^第.+卷/.test(volName)) continue;
                    const volList = await adapter.list(volDir);
                    // 章节子目录（步骤结果） 或 平铺的章节文件（正文）
                    if (volList.folders.some(d => /第.+章/.test(d.replace(/^.*\//, '')))) {
                        hasChapter = true; break;
                    }
                    if (volList.files.some(f => /第.+章.*\.md$/.test(f.replace(/^.*\//, '')))) {
                        hasChapter = true; break;
                    }
                }
                if (hasChapter) break;
            }
            if (hasChapter) {
                const cs = this.steps.find(s => s.id === 'chapters');
                if (cs) cs.status = 'done';
            }
        } catch (e) { log.warn('[小说工坊] restoreWizardStepStatus 检测章节目录失败:', e instanceof Error ? e.message : e); }
    }

    async onOpen() {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('nw-wizard-root');

        // v3.4.2: 检测已有文件，自动标记步骤状态
        await this.detectExistingFiles();

        // ===== 左侧步骤导航 =====
        this.sidebarEl = contentEl.createDiv({ cls: 'nw-wizard-sidebar' });
        const sidebarHeader = this.sidebarEl.createDiv({ cls: 'nw-wizard-sidebar-header' });
        sidebarHeader.createSpan({ text: '✨ 项目创建向导', cls: 'nw-wizard-title' });
        sidebarHeader.createDiv({ cls: 'nw-wizard-subtitle', text: this.projectInfo.name });
        const stepsContainer = this.sidebarEl.createDiv({ cls: 'nw-wizard-steps' });
        this.renderSidebar(stepsContainer);

        // ===== 右侧内容区 =====
        const contentArea = contentEl.createDiv({ cls: 'nw-wizard-content' });
        this.contentEl_right = contentArea.createDiv({ cls: 'nw-wizard-body' });

        // ===== 底部导航栏 =====
        this.navBar = contentArea.createDiv({ cls: 'nw-wizard-footer' });
        this.renderCurrentStep();
        this.renderNavBar();
    }

    private renderSidebar(container?: HTMLElement) {
        const targetEl = container || this.sidebarEl.querySelector('.nw-wizard-steps') as HTMLElement || this.sidebarEl;
        if (!container) targetEl.empty();
        
        for (let i = 0; i < this.steps.length; i++) {
            const step = this.steps[i];
            const stepEl = targetEl.createDiv({ cls: 'nw-wizard-step' });
            if (i === this.currentStepIdx) stepEl.addClass('active');
            if (step.status === 'done') stepEl.addClass('done');
            if (step.status === 'skipped') stepEl.addClass('skipped');

            const header = stepEl.createDiv({ cls: 'nw-wizard-step-header' });
            header.createSpan({ text: step.icon, cls: 'nw-wizard-step-icon' });
            header.createSpan({ text: step.label, cls: 'nw-wizard-step-label' });

            if (step.status === 'done') {
                header.createSpan({ text: '✓', cls: 'nw-wizard-step-check' });
            } else if (step.status === 'skipped') {
                header.createSpan({ text: '⏭', cls: 'nw-wizard-step-check' });
            }

            // Sub-steps
            if (step.subSteps) {
                const substepsEl = stepEl.createDiv({ cls: 'nw-wizard-substeps' });
                for (const sub of step.subSteps) {
                    const subEl = substepsEl.createDiv({ cls: 'nw-wizard-substep' });
                    if (sub.status === 'done') subEl.addClass('done');
                    if (sub.status === 'skipped') subEl.addClass('skipped');
                    if (sub.status === 'active') subEl.addClass('active');
                    subEl.createSpan({ text: sub.label });
                    if (sub.status === 'done') subEl.createSpan({ text: ' ✓' });
                }
            }
        }
    }

    private renderCurrentStep() {
        this.contentEl_right.empty();
        const stepId = this.steps[this.currentStepIdx]?.id;
        switch (stepId) {
            case 'fanfic': this.renderFanficStep(); break;
            case 'worldview': this.renderWorldviewStep(); break;
            case 'entities': this.renderEntitiesStep(); break;
            case 'outline': this.renderOutlineStep(); break;
            case 'chapters': this.renderChaptersStep(); break;
            case 'complete': this.renderCompleteStep(); break;
        }
    }

    // === Step: Fanfic Settings (同人) ===
    private renderFanficStep() {
        const el = this.contentEl_right;
        el.createEl('h3', { text: '📖 原作设定导入（同人项目必填）' });

        // Warning box
        const warnBox = el.createDiv({ cls: 'nw-wizard-fanfic-warn' });
        warnBox.createEl('strong', { text: '⚠️ 同人创作必须设定原作信息，否则后续章节全部 OOC！' });
        warnBox.createEl('p', { text: '此步骤不可跳过。请填写原作核心设定、时间线和创作规则。', cls: 'nw-wizard-fanfic-warn-desc' });

        // Simple form for core settings
        el.createEl('h4', { text: '原作核心设定' });

        const formFields: { key: string; label: string; type: string }[] = [
            { key: '作品名称', label: '作品名称', type: 'text' },
            { key: '作品类型', label: '作品类型', type: 'text' },
            { key: '作者', label: '原作作者', type: 'text' },
            { key: '世界观类型', label: '世界观类型', type: 'text' },
            { key: '力量体系', label: '力量体系', type: 'text' },
            { key: '核心规则', label: '核心规则', type: 'text' },
        ];

        const formValues: Record<string, string> = {};

        for (const field of formFields) {
            const row = el.createDiv({ attr: { style: 'margin:8px 0;' } });
            row.createEl('label', { text: field.label + '：', attr: { style: 'display:inline-block;width:100px;font-weight:600;' } });
            const input = row.createEl('input', { type: 'text', attr: { style: 'flex:1;padding:4px 8px;' } });
            input.addEventListener('input', () => { formValues[field.key] = input.value; });
        }

        // Timeline tables
        el.createEl('h4', { text: '原作剧情时间线', attr: { style: 'margin-top:16px;' } });
        el.createEl('p', { text: '表格格式：| 时间节点 | 原作事件 | 涉及人物 | 章节参考 | 切入方式 |', cls: 'novel-writer-fw-muted' });
        const canonTimelineInput = el.createEl('textarea', { attr: { placeholder: '| 第一部 | 主角入学 | 哈利 | 第1章 | 主角替代哈利入学 |\n| 第二部 | 密室开启 | 哈利 | 第8章 | 主角发现密室秘密 |', style: 'width:100%;height:100px;font-family:monospace;' } });

        el.createEl('h4', { text: '故事背景时间线（你的同人）', attr: { style: 'margin-top:16px;' } });
        el.createEl('p', { text: '表格格式：| 你的时间节点 | 你的事件 | 对应原作时间 | 涉及人物 |', cls: 'novel-writer-fw-muted' });
        const fanTimelineInput = el.createEl('textarea', { attr: { placeholder: '| 主角穿越 | 灵魂穿越到霍格沃茨 | 第一部 | 主角 |\n| 分院仪式 | 主角被分到拉文克劳 | 第一部 | 主角、分院帽 |', style: 'width:100%;height:100px;font-family:monospace;' } });

        // Rules
        el.createEl('h4', { text: '创作规则', attr: { style: 'margin-top:16px;' } });

        el.createEl('label', { text: '必须遵守的原作规则：' });
        const mustRulesInput = el.createEl('textarea', { attr: { placeholder: '魔法世界的基本法则不能改变', style: 'width:100%;height:60px;' } });

        el.createEl('label', { text: '允许改编的范围：' });
        const adaptScopeInput = el.createEl('textarea', { attr: { placeholder: '可以增加新角色和支线剧情', style: 'width:100%;height:60px;' } });

        el.createEl('label', { text: '禁止触及的红线：' });
        const redlinesInput = el.createEl('textarea', { attr: { placeholder: '不能改变原作大结局', style: 'width:100%;height:60px;' } });

        // Validation status display
        const validationEl = el.createDiv({ attr: { style: 'margin-top:12px;' } });
    }

    // === Step: Worldview ===
    private renderWorldviewStep() {
        const el = this.contentEl_right;
        el.createEl('h3', { text: '🌍 世界观设定' });

        const isDone = this.steps[this.currentStepIdx]?.status === 'done';

        if (this.projectInfo.projectType === 'fanfic') {
            el.createEl('p', { text: '同人项目将从同人设定库导入世界观基础，并补充原创设定。' });
            el.createEl('p', { text: `原作：${this.projectInfo.sourceWork || '未指定'}`, cls: 'novel-writer-fw-muted' });
        } else {
            el.createEl('p', { text: `AI 将严格按照模板字段格式生成世界观。包含 ${WV_SECTIONS.length} 个模块：${WV_SECTIONS.join('、')}。` });
        }

        el.createEl('p', { text: '⚠️ 此步骤不可跳过，完整的世界观设定是后续所有步骤的基础。', cls: 'novel-writer-fw-muted' });

        // v3.4.2: 世界观已完成 — 显示"重新生成" + 文件已存在的提示
        if (isDone) {
            const doneBox = el.createDiv({ attr: { style: 'margin-top:16px; padding:12px; background:var(--background-primary-alt); border-radius:8px;' } });
            doneBox.createEl('p', { text: '✅ 世界观已存在（检测到完整的世界观总览文件）', attr: { style: 'color:var(--text-success); font-weight:600;' } });
            const regenBtn = doneBox.createEl('button', { 
                text: '🔄 重新生成世界观', 
                cls: 'novel-writer-fw-btn-warning'
            });
            regenBtn.addEventListener('click', async () => {
                const genBtn = regenBtn;
                genBtn.disabled = true;
                genBtn.textContent = '⏳ 生成中...';
                const progressEl = doneBox.createDiv({ attr: { style: 'margin-top:8px; color:var(--text-muted);' } });
                try {
                    const ai = this.plugin.aiEngine;
                    await ai.generateWorldviewForProject(this.app, this.projectInfo.name, undefined, (phase: string) => { progressEl.setText(phase); });
                    progressEl.setText('✅ 世界观已重新生成');
                    this.renderSidebar();
                    this.renderCurrentStep();
                    this.renderNavBar();
                } catch (e) {
                    progressEl.setText(`❌ 失败: ${e}`);
                    genBtn.disabled = false;
                    genBtn.textContent = '🔄 重新生成世界观';
                }
            });
            const viewBtn = doneBox.createEl('button', { 
                text: '📖 查看现有文件', 
                attr: { style: 'margin:8px 0 0 12px; padding:8px 16px; border-radius:6px; cursor:pointer; background:var(--background-modifier-border); border:1px solid var(--background-modifier-border);' } 
            });
            viewBtn.addEventListener('click', () => {
                const wvFile = this.app.vault.getAbstractFileByPath(pjWorldview(this.projectInfo.name));
                if (wvFile) {
                    // v3.4.9 P0-7: 工作台上下文用 safeOpenFile 避免跳转到Obsidian主体
                    this.plugin.safeOpenFile(wvFile as TFile);
                }
            });
            return;
        }

        // 未完成 — 正常渲染生成按钮
        const genContainer = el.createDiv({ attr: { style: 'margin-top: 20px;' } });
        const genBtn = genContainer.createEl('button', { 
            text: '🚀 开始生成世界观', 
            cls: 'novel-writer-fw-btn-primary' 
        });
        genBtn.style.padding = '10px 24px';
        genBtn.style.fontSize = '15px';

        const progressEl = genContainer.createDiv({ cls: 'nw-wizard-progress' });
        progressEl.style.display = 'none';
        
        genBtn.addEventListener('click', async () => {
            genBtn.disabled = true;
            genBtn.textContent = '⏳ 生成中...';
            progressEl.style.display = 'block';
            progressEl.setText('正在生成世界观骨架...');

            try {
                const ai = this.plugin.aiEngine;
                
                await ai.generateWorldviewForProject(this.app, this.projectInfo.name, undefined, (phase: string, module?: string) => {
                    if (module) {
                        progressEl.setText(`正在生成：${module}`);
                    } else {
                        progressEl.setText(phase);
                    }
                });
                
                progressEl.setText('✅ 世界观生成完成！');
                const worldviewStep = this.steps.find(s => s.id === 'worldview')!;
                worldviewStep.status = 'done';
                this.renderSidebar();
                new Notice('世界观已生成');
                // v3.4.1: 生成成功后恢复按钮，允许补充/重生成
                genBtn.disabled = false;
                genBtn.textContent = '🔄 重新生成 / 补充世界观';
            } catch (e) {
                progressEl.setText(`❌ 生成失败：${e}`);
                genBtn.disabled = false;
                genBtn.textContent = '🔄 重试生成世界观';
            }
        });
    }

    // === Step: Entities ===
    private renderEntitiesStep() {
        const el = this.contentEl_right;
        el.createEl('h3', { text: '👥 实体生成' });

        const entitiesStep = this.steps.find(s => s.id === 'entities')!;
        const subSteps = entitiesStep.subSteps!;
        const entityConfig = [
            { sub: subSteps[0], label: '人物', desc: '生成主要角色卡（含 frontmatter 字段和设定章节）', icon: '👤', commandId: 'novel-writer-character' },
            { sub: subSteps[1], label: '地点', desc: '生成故事场景地点设定', icon: '📍', commandId: 'novel-writer-location' },
            { sub: subSteps[2], label: '势力', desc: '生成各方势力组织设定', icon: '🏰', commandId: 'novel-writer-faction' },
            { sub: subSteps[3], label: '物品功法', desc: '生成关键物品和功法设定', icon: '⚔️', commandId: 'novel-writer-item' },
        ];

        for (const cfg of entityConfig) {
            const row = el.createDiv({ cls: 'nw-wizard-entity-row' });
            const info = row.createDiv({ cls: 'nw-wizard-entity-info' });
            info.createSpan({ text: `${cfg.icon} ${cfg.label}`, cls: 'nw-wizard-entity-label' });
            info.createEl('br');
            info.createSpan({ text: cfg.desc, cls: 'novel-writer-fw-muted' });

            const actions = row.createDiv({ cls: 'nw-wizard-entity-actions' });
            const skipBtn = actions.createEl('button', { text: '跳过', cls: 'novel-writer-fw-btn-secondary' });
            const genBtn = actions.createEl('button', { text: '生成', cls: 'novel-writer-fw-btn-primary' });
            const doneBtn = actions.createEl('button', { text: '✓ 完成', cls: 'novel-writer-fw-btn-primary' });
            doneBtn.classList.add('novel-writer-fw-btn-success');
            doneBtn.style.marginLeft = '6px';

            // 初始状态：如果已经是 done，按钮文案调整
            if (cfg.sub.status === 'done') {
                genBtn.textContent = '继续生成';
                genBtn.style.opacity = '0.7';
                doneBtn.textContent = '✓ 已完成';
            }

            skipBtn.addEventListener('click', () => {
                cfg.sub.status = 'skipped';
                this.advanceEntityStep();
            });

            // v3.4: "生成"按钮不再立即标记 done，允许连续生成多个实体
            genBtn.addEventListener('click', () => {
                this.plugin.executeCommand(cfg.commandId);
                new Notice(`${cfg.label}生成窗口已打开，可多次生成，完成后点击"✓ 完成"继续。`);
                // 按钮变弱提示已打开过，但依然可点
                genBtn.textContent = '继续生成';
                genBtn.style.opacity = '0.7';
            });

            // "✓ 完成"按钮——用户主动确认该类型已生成完毕
            doneBtn.addEventListener('click', () => {
                cfg.sub.status = 'done';
                this.advanceEntityStep();
            });
        }

        el.createEl('p', { text: '💡 跳过将影响后续全书规划的质量，建议至少生成人物。', cls: 'novel-writer-fw-muted' });
    }

    private advanceEntityStep() {
        const entitiesStep = this.steps.find(s => s.id === 'entities')!;
        const subSteps = entitiesStep.subSteps!;
        const allDone = subSteps.every(s => s.status === 'done' || s.status === 'skipped');
        if (allDone) {
            entitiesStep.status = 'done';
            this.advanceStep();
        }
        this.renderSidebar();
        this.renderCurrentStep();
    }

    // === Step: Outline ===
    private renderOutlineStep() {
        const el = this.contentEl_right;
        el.createEl('h3', { text: '📋 AI 全书规划' });
        el.createEl('p', { text: '基于已生成的世界观和实体设定，AI 将生成完整的分卷大纲，包括每卷的核心冲突和章节分配表。' });
        el.createEl('p', { text: '严格按照分卷大纲模板字段格式输出，确保批量建章能正确解析。', cls: 'novel-writer-fw-muted' });

        const genContainer = el.createDiv({ attr: { style: 'margin-top: 20px;' } });
        const genBtn = genContainer.createEl('button', { text: '📋 开始全书规划', cls: 'novel-writer-fw-btn-primary' });
        genBtn.style.padding = '10px 24px';
        genBtn.style.fontSize = '15px';
        genBtn.addEventListener('click', () => {
            const outlineStep = this.steps.find(s => s.id === 'outline')!;
            outlineStep.status = 'done';
            this.renderSidebar();
            this.plugin.executeCommand('novel-writer-plan-book');
            new Notice('全书规划窗口已打开');
        });
    }

    // === Step: Chapters ===
    private renderChaptersStep() {
        const el = this.contentEl_right;
        el.createEl('h3', { text: '📝 批量建章' });
        el.createEl('p', { text: '根据分卷大纲自动创建所有章节目录和文件（大纲摘要、正文、信息规划）。' });

        const genContainer = el.createDiv({ attr: { style: 'margin-top: 20px;' } });
        const genBtn = genContainer.createEl('button', { text: '📝 打开批量建章', cls: 'novel-writer-fw-btn-primary' });
        genBtn.style.padding = '10px 24px';
        genBtn.style.fontSize = '15px';
        genBtn.addEventListener('click', () => {
            const chaptersStep = this.steps.find(s => s.id === 'chapters')!;
            chaptersStep.status = 'done';
            this.renderSidebar();
            this.plugin.executeCommand('novel-writer-batch-create');
            new Notice('批量建章窗口已打开');
        });
    }

    // === Step: Complete ===
    private renderCompleteStep() {
        const el = this.contentEl_right;
        el.createEl('h3', { text: '🎉 项目创建完成！' });

        const summary = el.createDiv({ cls: 'nw-wizard-summary' });
        summary.createEl('p', { text: `项目：${this.projectInfo.name}` });
        summary.createEl('p', { text: `类型：${this.projectInfo.projectType === 'fanfic' ? '同人' : '原创'}` });

        const enterBtn = el.createEl('button', {
            text: '🚀 进入写作界面',
            cls: 'novel-writer-fw-btn-primary'
        });
        enterBtn.style.marginTop = '20px';
        enterBtn.style.padding = '10px 24px';
        enterBtn.style.fontSize = '15px';

        enterBtn.addEventListener('click', () => {
            this.close();
            this.openWritingFlow();
        });
    }

    private openWritingFlow() {
        // Try to find and open the first pending chapter
        const chapters = getChaptersForProject(this.plugin.app, this.projectInfo.name);
        const firstPending = chapters.find(c => c.status !== '已完稿' && c.status !== 'written' && c.status !== 'settled');
        if (firstPending) {
            this.plugin.openChapterInFullWriter(this.projectInfo.name, firstPending.file.path);
        } else {
            // Open project directory
            const firstFile = this.plugin.app.vault.getMarkdownFiles()
                .find(f => f.path.startsWith(this.projectInfo.name + '/'));
            if (firstFile) {
                // v3.4.9 P0-7: safeOpenFile 感知工作台上下文
                this.plugin.safeOpenFile(firstFile);
            }
        }
    }

    // === Navigation ===
    private renderNavBar() {
        this.navBar.empty();

        const leftGroup = this.navBar.createDiv({ cls: 'nw-wizard-footer-left' });
        const rightGroup = this.navBar.createDiv({ cls: 'nw-wizard-footer-right' });

        // 左侧按钮
        if (this.currentStepIdx > 0) {
            const prevBtn = leftGroup.createEl('button', { text: '← 上一步', cls: 'nw-wizard-btn nw-wizard-btn-secondary' });
            prevBtn.addEventListener('click', () => {
                this.currentStepIdx--;
                this.updateActiveStep();
                this.renderSidebar();
                this.renderCurrentStep();
                this.renderNavBar();
            });
        } else {
            const backBtn = leftGroup.createEl('button', { text: '← 返回', cls: 'nw-wizard-btn nw-wizard-btn-secondary' });
            backBtn.addEventListener('click', () => this.close());
        }

        // 右侧按钮
        if (this.currentStepIdx < this.steps.length - 1) {
            const stepId = this.steps[this.currentStepIdx]?.id;
            const cannotSkip = stepId === 'worldview' || stepId === 'fanfic' || stepId === 'outline' || stepId === 'complete' || stepId === 'chapters';

            if (!cannotSkip) {
                const skipBtn = rightGroup.createEl('button', { text: '跳过', cls: 'nw-wizard-btn nw-wizard-btn-secondary' });
                skipBtn.addEventListener('click', () => {
                    this.steps[this.currentStepIdx].status = 'skipped';
                    this.advanceStep();
                });
            }

            const isBlockedStep = this.steps[this.currentStepIdx]?.status !== 'done' &&
                (stepId === 'worldview' || stepId === 'fanfic');

            const nextBtn = rightGroup.createEl('button', { text: '下一步 →', cls: 'nw-wizard-btn nw-wizard-btn-primary' });
            if (isBlockedStep) {
                nextBtn.disabled = true;
                nextBtn.setAttr('title', '请先完成当前步骤');
            }
            nextBtn.addEventListener('click', () => {
                this.steps[this.currentStepIdx].status = 'done';
                this.advanceStep();
            });
        }

        const closeBtn = rightGroup.createEl('button', { text: '✕ 关闭', cls: 'nw-wizard-btn nw-wizard-btn-secondary' });
        closeBtn.addEventListener('click', () => this.close());
    }

    private advanceStep() {
        this.currentStepIdx++;
        this.updateActiveStep();
        this.renderSidebar();
        this.renderCurrentStep();
        this.renderNavBar();
    }

    private updateActiveStep() {
        for (const s of this.steps) s.status = s.status === 'active' ? 'pending' : s.status;
        // v3.4.8: 保留 'done' 状态，不覆盖为 'active'
        // 覆盖会导致 detectExistingFiles 设置的 done→active→isBlockedStep 误判按钮 disabled
        if (this.steps[this.currentStepIdx].status !== 'done') {
            this.steps[this.currentStepIdx].status = 'active';
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * 独立渲染函数 — 供 FullWriterView 嵌入使用
 * 从 ProjectWizardModal 各步骤渲染逻辑提取
 */
export function renderWizardFanficInline(container: HTMLElement): void {
    const warnBox = container.createDiv({ cls: 'nw-wizard-fanfic-warn' });
    warnBox.createEl('strong', { text: '⚠️ 同人创作必须设定原作信息，否则后续章节全部 OOC！' });
    warnBox.createEl('p', { text: '此步骤不可跳过。请填写原作核心设定、时间线和创作规则。', cls: 'nw-wizard-fanfic-warn-desc' });
    
    container.createEl('h4', { text: '原作核心设定' });
    
    const formFields = ['作品名称', '作品类型', '作者', '世界观类型', '力量体系', '核心规则'];
    for (const field of formFields) {
        const row = container.createDiv({ attr: { style: 'margin:8px 0;' } });
        row.createEl('label', { text: field + '：', attr: { style: 'display:inline-block;width:100px;font-weight:600;' } });
        row.createEl('input', { type: 'text', attr: { style: 'flex:1;padding:4px 8px;' } });
    }
    
    container.createEl('h4', { text: '原作剧情时间线', attr: { style: 'margin-top:16px;' } });
    container.createEl('p', { text: '表格格式：| 时间节点 | 原作事件 | 涉及人物 | 章节参考 | 切入方式 |', attr: { style: 'color:var(--text-muted);font-size:12px;' } });
    container.createEl('textarea', { attr: { placeholder: '| 第一部 | 主角入学 | 哈利 | 第1章 | ... |', style: 'width:100%;height:80px;font-family:monospace;' } });
    
    container.createEl('h4', { text: '故事背景时间线', attr: { style: 'margin-top:16px;' } });
    container.createEl('p', { text: '表格格式：| 你的时间节点 | 你的事件 | 对应原作时间 | 涉及人物 |', attr: { style: 'color:var(--text-muted);font-size:12px;' } });
    container.createEl('textarea', { attr: { placeholder: '| 主角穿越 | ... | 第一部 | ... |', style: 'width:100%;height:80px;font-family:monospace;' } });
    
    container.createEl('h4', { text: '创作规则', attr: { style: 'margin-top:16px;' } });
    container.createEl('label', { text: '必须遵守的原作规则：' });
    container.createEl('textarea', { attr: { placeholder: '魔法世界的基本法则不能改变', style: 'width:100%;height:60px;' } });
}

export function renderWizardEntitiesInline(container: HTMLElement, plugin?: any): void {
    container.createEl('p', { text: '选择要生成的实体类型，可跳过。建议先生成世界观后再生成实体以获得更好的匹配度。' });
    
    const entityTypes = [
        { name: '人物', icon: '👤', commandId: 'novel-writer-character' },
        { name: '地点', icon: '📍', commandId: 'novel-writer-location' },
        { name: '势力', icon: '🏰', commandId: 'novel-writer-faction' },
        { name: '物品功法', icon: '⚔️', commandId: 'novel-writer-item' },
    ];
    
    const grid = container.createDiv({ attr: { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px;' } });
    for (const et of entityTypes) {
        const card = grid.createDiv({ attr: { style: 'padding:16px; background:var(--background-primary-alt); border-radius:8px; text-align:center; cursor:pointer;' } });
        card.createEl('div', { text: et.icon, attr: { style: 'font-size:24px;' } });
        card.createEl('div', { text: `生成${et.name}`, attr: { style: 'font-weight:600;margin-top:4px;' } });
        if (plugin) {
            card.addEventListener('click', () => plugin.executeCommand(et.commandId));
        }
    }
}

export function renderWizardWorldviewInline(container: HTMLElement, project: string): void {
    container.createEl('p', { text: `🌍 AI 将根据模板生成世界观的 ${WV_SECTIONS.length} 个模块：` });
    const list = container.createEl('ol', { attr: { style: 'margin-top:8px;' } });
    for (const m of WV_SECTIONS) {
        list.createEl('li', { text: m });
    }
    container.createEl('p', { text: `目标项目: ${project}`, attr: { style: 'margin-top:16px;color:var(--text-muted);' } });
    container.createEl('p', { text: '⚠️ 点击"下一步"将调用 AI 生成世界观，请确保 API Key 已配置。', attr: { style: 'color:var(--text-warning);font-size:13px;' } });
}

export function renderWizardOutlineInline(container: HTMLElement): void {
    container.createEl('p', { text: '📋 AI 将分析已有的世界观和实体设定，生成分卷大纲。' });
    container.createEl('p', { text: '包含 9 个字段：卷名、章节范围、核心冲突、主要事件、人物弧光、本卷字数、本卷高潮、结尾过渡、章节分配表格', attr: { style: 'color:var(--text-muted);font-size:13px;margin-top:8px;' } });
}

export function renderWizardChaptersInline(container: HTMLElement): void {
    container.createEl('p', { text: '📝 根据分卷大纲中的章节分配表，批量创建章节 .md 文件。' });
    container.createEl('p', { text: '每个章节文件将包含标准模板结构：正文、场景要素、伏笔跟踪、变更记录。', attr: { style: 'color:var(--text-muted);font-size:13px;' } });
}
