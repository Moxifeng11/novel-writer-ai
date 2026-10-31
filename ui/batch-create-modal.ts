import { App, Modal, Notice, TFolder } from 'obsidian';
import NovelWriterPlugin from '../main';
import { ContextManager } from '../engine/context-manager';
import { getChapterFileName, findChapterFile, normalizeChapterFiles, CHAPTER_FILE_TYPES, findBodyFileV4 } from '../engine/chapter-utils';
import { readMergedVolumeOutline } from '../utils/helpers';
import { pjBodyDir, pjBodyFile, pjStepDir } from '../shared/paths';
import { mkdirp } from '../utils/helpers';
import { TemplateService } from '../engine/template-service';
import { ENGINE_NAMES } from '../shared/engine-names';
import { countPlannedChapters, hasBlockingIssues, parseVolumePlan, VolumePlan, VolumePlanParseResult } from '../shared/volume-plan';
import { createLogger } from '../shared/logger';
import { writeVaultText } from '../shared/file-system-port';
import { getProjectMeta } from './project-utils';
import { getCreationModeLabel, type CreationMode } from '../shared/creation-mode';
import {
    buildScriptUnitSkeleton,
    buildShortUnitSkeleton,
    ensureModeContentStructure,
    modeBodyDir,
    modeUnitFileName,
} from '../shared/mode-content';


const log = createLogger('BatchCreateModal');

/** 每章骨架文件（与 11 步流水线保持一致） */
const STEP_FILE_TYPES: Array<{ type: string; templateKey: string }> = [
    { type: CHAPTER_FILE_TYPES.infoPlan, templateKey: 'infoPlan' },
    { type: CHAPTER_FILE_TYPES.plotDistill, templateKey: 'plotDistill' },
    { type: CHAPTER_FILE_TYPES.outline, templateKey: 'outline' },
    { type: CHAPTER_FILE_TYPES.emotionPlan, templateKey: 'emotionPlan' },
    { type: CHAPTER_FILE_TYPES.sceneExpand, templateKey: 'sceneExpand' },
    { type: CHAPTER_FILE_TYPES.characterSoul, templateKey: 'characterSoul' },
    { type: CHAPTER_FILE_TYPES.qualityControl, templateKey: 'qualityControl' },
    { type: CHAPTER_FILE_TYPES.analysisReport, templateKey: 'analysisReport' },
];

interface WrittenFile {
    label: string;
    path: string;
}

export class BatchCreateModal extends Modal {
    private plugin: NovelWriterPlugin;
    private contextManager: ContextManager;
    private _plan: VolumePlanParseResult | null = null;
    private creationMode: CreationMode = 'long';
    private modeUnitCount = 20;
    private modeUnitLabel = '章';
    private preferredProject?: string;

    constructor(app: App, plugin: NovelWriterPlugin, preferredProject?: string) {
        super(app);
        this.plugin = plugin;
        this.contextManager = plugin.ctxManager;
        this.preferredProject = preferredProject;
    }

    onOpen(): void {
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
        const titleEl = contentEl.createEl('h2', { text: '📦 批量建章（按全书规划）' });
        const descEl = contentEl.createEl('p', {
            text: '读取上一步「AI 全书规划」产出的分卷大纲，一次性为全部卷创建章节骨架；建章前会校验大纲一致性，建章后会校验落盘完整性。',
            attr: { style: 'font-size:0.85em;color:var(--text-muted);margin-top:-6px;' },
        });

        const projectSelect = contentEl.createEl('select', { cls: 'nw-select novel-writer-select' });
        const modeBox = contentEl.createDiv({ cls: 'nw-batch-plan-box' });
        modeBox.hidden = true;
        const modeLabel = modeBox.createEl('label', { text: '创建数量' });
        modeLabel.addClass('nw-form-label');
        const modeCountInput = modeBox.createEl('input', { type: 'number', cls: 'nw-input' });
        const modeHint = modeBox.createEl('p', { cls: 'nw-text-12-muted' });
        const planBox = contentEl.createEl('div', {
            cls: 'nw-batch-plan-box',
            attr: { style: 'margin:12px 0;padding:10px 12px;border-radius:8px;background:var(--background-secondary);font-size:0.9em;line-height:1.7;' },
        });
        const createButton = contentEl.createEl('button', { text: '批量创建全部卷章节', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
        createButton.disabled = true;

        const loadPlan = async (): Promise<void> => {
            const project = projectSelect.value;
            planBox.empty();
            this._plan = null;
            createButton.disabled = true;
            if (!project) {
                planBox.setText('未选择项目');
                return;
            }

            const meta = await getProjectMeta(this.app, project);
            this.creationMode = meta.creationMode;
            this.modeUnitLabel = meta.unitLabel;
            modeBox.hidden = this.creationMode === 'long';
            if (this.creationMode !== 'long') {
                titleEl.setText(this.creationMode === 'script' ? '📦 批量建集（剧本模式）' : '📦 批量建节（短篇模式）');
                descEl.setText(
                    `${meta.creationModeLabel}不依赖分卷大纲，按设定数量一次性创建${this.modeUnitLabel}骨架；已存在的文件会自动跳过。`
                );
                this.modeUnitCount = Math.max(1, meta.modeTargetUnits || (this.creationMode === 'script' ? 80 : 20));
                modeCountInput.min = '1';
                modeCountInput.max = String(this.creationMode === 'script' ? 120 : 40);
                modeCountInput.value = String(this.modeUnitCount);
                modeHint.setText(`${meta.creationModeLabel}：将创建 ${this.modeUnitCount} ${this.modeUnitLabel}骨架，不依赖分卷大纲。`);
                createButton.textContent = `创建 ${this.modeUnitCount} ${this.modeUnitLabel}骨架`;
                createButton.disabled = false;
                return;
            }
            createButton.textContent = '批量创建全部卷章节';
            titleEl.setText('📦 批量建章（按全书规划）');
            descEl.setText('读取上一步「AI 全书规划」产出的分卷大纲，一次性为全部卷创建章节骨架；建章前会校验大纲一致性，建章后会校验落盘完整性。');
            planBox.setText('⏳ 正在读取全书规划...');
            const content = await readMergedVolumeOutline(this.app, project);
            if (!content || content.trim().length === 0) {
                planBox.empty();
                planBox.createEl('div', {
                    text: '❌ 未找到全书规划（分卷大纲）。请先在上一步执行「AI 全书规划」，再回来批量建章。',
                    attr: { style: 'color:var(--text-error);font-weight:600;' },
                });
                return;
            }

            const plan = parseVolumePlan(content);
            this._plan = plan;
            planBox.empty();

            if (plan.volumes.length > 0) {
                const total = countPlannedChapters(plan);
                planBox.createEl('div', {
                    text: `✅ 检测到 ${plan.volumes.length} 卷 / ${total} 章`,
                    attr: { style: 'font-weight:600;margin-bottom:4px;' },
                });
                for (const volume of [...plan.volumes].sort((a, b) => a.volumeNumber - b.volumeNumber)) {
                    planBox.createEl('div', {
                        text: `第${volume.volumeNumber}卷 · ${volume.volumeName}（第${volume.startChapter}-${volume.endChapter}章，共 ${volume.chapterNumbers.length} 章）`,
                    });
                }
            }

            const errors = plan.issues.filter(i => i.level === 'error');
            const warnings = plan.issues.filter(i => i.level === 'warning');
            if (warnings.length > 0) {
                const warnEl = planBox.createEl('div', { attr: { style: 'color:#b8860b;margin-top:6px;' } });
                warnEl.createEl('div', { text: '⚠️ 提示：' });
                for (const issue of warnings) warnEl.createEl('div', { text: `· ${issue.message}` });
            }
            if (errors.length > 0) {
                const errEl = planBox.createEl('div', { attr: { style: 'color:var(--text-error);margin-top:6px;' } });
                errEl.createEl('div', { text: '❌ 大纲校验未通过，已阻止建章：' });
                for (const issue of errors) errEl.createEl('div', { text: `· ${issue.message}` });
            }

            createButton.disabled = plan.volumes.length === 0 || hasBlockingIssues(plan);
        };

        const populateProjects = async (): Promise<void> => {
            let projects = await this.contextManager.detectProjects();
            if (projects.length === 0) {
                projects = this.fallbackDetectProjects();
            }
            if (projects.length === 0) {
                const errorEl = contentEl.createEl('p', { text: '❌ 未找到项目，请先创建新项目' });
                const retryBtn = contentEl.createEl('button', { text: '🔄 重试', cls: 'nw-btn' });
                retryBtn.onclick = () => {
                    errorEl.remove();
                    retryBtn.remove();
                    populateProjects();
                };
                return;
            }

            for (const project of projects) {
                projectSelect.createEl('option', { value: project, text: project });
            }
            if (this.preferredProject && projects.includes(this.preferredProject)) {
                projectSelect.value = this.preferredProject;
            }
            projectSelect.onchange = () => { void loadPlan(); };
            await loadPlan();
        };

        modeCountInput.onchange = () => {
            const n = parseInt(modeCountInput.value, 10);
            if (Number.isFinite(n) && n > 0) {
                this.modeUnitCount = n;
                createButton.textContent = `创建 ${n} ${this.modeUnitLabel}骨架`;
                modeHint.setText(`${getCreationModeLabel(this.creationMode)}：将创建 ${n} ${this.modeUnitLabel}骨架，不依赖分卷大纲。`);
            }
        };

        createButton.onclick = async () => {
            const project = projectSelect.value;
            if (!project) return;
            const plan: VolumePlanParseResult = this.creationMode === 'long'
                ? (this._plan as VolumePlanParseResult)
                : {
                    volumes: [{
                        volumeNumber: 1,
                        volumeLabel: '第1卷',
                        volumeName: '主体',
                        startChapter: 1,
                        endChapter: this.modeUnitCount,
                        chapterNumbers: Array.from({ length: this.modeUnitCount }, (_, i) => i + 1),
                        rawSection: '',
                    }],
                    issues: [],
                };
            if (!plan) {
                new Notice('❌ 全书规划尚未就绪，无法建章', 5000);
                return;
            }
            if (this.creationMode === 'long' && hasBlockingIssues(plan)) {
                new Notice('❌ 大纲校验未通过，请先修复分卷大纲', 8000);
                return;
            }

            createButton.disabled = true;
            try {
                await this.batchCreateAll(project, plan.volumes, planBox);
            } finally {
                createButton.disabled = false;
            }
        };

        void populateProjects();
    }

    /** 短篇/剧本：只在模式内容根目录创建正文单元，不建长篇步骤文件 */
    private async batchCreateModeUnits(project: string, planBox: HTMLElement): Promise<void> {
        const mode = this.creationMode;
        const unit = this.modeUnitLabel;
        const total = Math.max(1, this.modeUnitCount);
        const progress = new Notice(`⏳ 正在创建 ${total} ${unit}骨架...`, 0);
        const written: WrittenFile[] = [];
        let created = 0;
        const failures: string[] = [];

        try {
            await ensureModeContentStructure(this.app.vault.adapter, project, mode);
            const dir = modeBodyDir(project, mode);
            if (!(await this.app.vault.adapter.exists(dir))) await this.app.vault.adapter.mkdir(dir);

            for (let n = 1; n <= total; n++) {
                const path = `${dir}/${modeUnitFileName(mode, n)}`;
                try {
                    if (await this.app.vault.adapter.exists(path)) {
                        written.push({ label: `第${n}${unit}`, path });
                        continue;
                    }
                    const content = mode === 'short'
                        ? buildShortUnitSkeleton(n)
                        : buildScriptUnitSkeleton(n);
                    await writeVaultText(this.app, path, content);
                    written.push({ label: `第${n}${unit}`, path });
                    created++;
                } catch (e) {
                    failures.push(`第${n}${unit}：${e instanceof Error ? e.message : String(e)}`);
                }
                if (n % 10 === 0) progress.setMessage(`⏳ 批量建${unit} ${n}/${total} ${unit}...`);
            }
        } finally {
            progress.hide();
        }

        const invalid = await this.verifyWrittenFiles(written);
        this.renderResult(planBox, {
            volumes: 0,
            totalChapters: total,
            createdChapters: total - failures.length,
            createdFiles: created,
            failures,
            invalidFiles: invalid,
            unitLabel: unit,
            isLong: false,
        });

        if (failures.length === 0 && invalid.length === 0) {
            new Notice(`✅ 已创建 ${total - failures.length} ${unit}骨架（${created} 个新文件），落盘校验通过`, 6000);
            this.close();
            return;
        }
        new Notice(`⚠️ 建${unit}完成但存在问题：失败 ${failures.length} ${unit}，落盘异常 ${invalid.length} 项。详见弹窗清单`, 12000);
    }

    private async batchCreateAll(project: string, volumes: VolumePlan[], planBox: HTMLElement): Promise<void> {
        if (this.creationMode !== 'long') {
            await this.batchCreateModeUnits(project, planBox);
            return;
        }
        const sortedVolumes = [...volumes].sort((a, b) => a.volumeNumber - b.volumeNumber);
        const totalChapters = countPlannedChapters({ volumes, issues: [] });
        const isLong = this.creationMode === 'long';
        const unit = this.modeUnitLabel;
        const progressNotice = new Notice(
            isLong
                ? `⏳ 正在按全书规划创建 ${sortedVolumes.length} 卷 / ${totalChapters} 章...`
                : `⏳ 正在创建 ${totalChapters} ${unit}骨架...`,
            0
        );

        const failures: string[] = [];
        const writtenFiles: WrittenFile[] = [];
        let createdChapters = 0;
        let createdFiles = 0;
        let processedChapters = 0;

        const allFiles = this.app.vault.getFiles();
        const templateService = this.plugin.engineRegistry.get(ENGINE_NAMES.TEMPLATE_SERVICE);

        for (const volume of sortedVolumes) {
            const volN = volume.volumeNumber;
            try {
                await mkdirp(this.app, pjBodyDir(project, volN));
            } catch (e) {
                failures.push(`第${volN}卷：创建正文目录失败（${errorText(e)}）`);
                continue;
            }

            for (const chapterNumber of volume.chapterNumbers) {
                const chapterName = `第${chapterNumber}章`;
                const chapterLabel = `第${volN}卷第${chapterNumber}章`;

                try {
                    const stepDir = pjStepDir(project, volN, chapterNumber);
                    await mkdirp(this.app, stepDir);

                    const stepFolder = this.app.vault.getAbstractFileByPath(stepDir);
                    if (stepFolder instanceof TFolder) {
                        await normalizeChapterFiles(this.app, stepFolder, chapterName);
                    }

                    const vars = { project, volume: volume.volumeLabel, chapterName, chapterNumber, creationMode: this.creationMode, unitLabel: this.modeUnitLabel };

                    for (const { type, templateKey } of STEP_FILE_TYPES) {
                        const existing = findChapterFile(allFiles, stepDir, type);
                        if (existing) {
                            writtenFiles.push({ label: `${chapterLabel} ${type}`, path: existing.path });
                            continue;
                        }
                        const filePath = `${stepDir}/${getChapterFileName(chapterName, type)}`;
                        const fileContent = await templateService.getStepTemplate(templateKey, vars);
                        await this.app.vault.create(filePath, fileContent);
                        writtenFiles.push({ label: `${chapterLabel} ${type}`, path: filePath });
                        createdFiles++;
                    }

                    const existingBody = findBodyFileV4(this.app, project, volN, chapterNumber);
                    if (existingBody) {
                        writtenFiles.push({ label: `${chapterLabel} 正文`, path: existingBody.path });
                    } else {
                        const bodyPath = pjBodyFile(project, volN, chapterNumber);
                        const bodyContent = await templateService.getBodyTemplate(vars);
                        await this.app.vault.create(bodyPath, bodyContent);
                        writtenFiles.push({ label: `${chapterLabel} 正文`, path: bodyPath });
                        createdFiles++;
                    }

                    createdChapters++;
                } catch (e) {
                    log.warn(`创建${chapterLabel}失败:`, e);
                    failures.push(`${chapterLabel}：${errorText(e)}`);
                }

                processedChapters++;
                if (processedChapters % 10 === 0) {
                    progressNotice.setMessage(
                        isLong
                            ? `⏳ 批量建章 ${processedChapters}/${totalChapters} 章...`
                            : `⏳ 批量建${unit} ${processedChapters}/${totalChapters} ${unit}...`
                    );
                }
            }
        }

        const invalidFiles = await this.verifyWrittenFiles(writtenFiles);
        progressNotice.hide();

        const hasProblem = failures.length > 0 || invalidFiles.length > 0;
        this.renderResult(planBox, {
            volumes: sortedVolumes.length,
            totalChapters,
            createdChapters,
            createdFiles,
            failures,
            invalidFiles,
            unitLabel: unit,
            isLong,
        });

        if (!hasProblem) {
            new Notice(
                isLong
                    ? `✅ 已按全书规划创建 ${sortedVolumes.length} 卷 / ${createdChapters} 章（${createdFiles} 个新文件），落盘校验通过`
                    : `✅ 已创建 ${createdChapters} ${unit}骨架（${createdFiles} 个新文件），落盘校验通过`,
                6000
            );
            this.close();
            return;
        }

        // 有失败/校验异常时不关闭弹窗，保留清单供用户修复后重试（重试会跳过已存在文件）
        new Notice(
            isLong
                ? `⚠️ 建章完成但存在问题：成功 ${createdChapters}/${totalChapters} 章，失败 ${failures.length} 章，落盘异常 ${invalidFiles.length} 项。详见弹窗清单`
                : `⚠️ 建${unit}完成但存在问题：成功 ${createdChapters}/${totalChapters} ${unit}，失败 ${failures.length} ${unit}，落盘异常 ${invalidFiles.length} 项。详见弹窗清单`,
            12000
        );
    }

    /** 落盘校验：每个应存在的骨架文件必须真实存在且非空 */
    private async verifyWrittenFiles(files: WrittenFile[]): Promise<string[]> {
        const invalid: string[] = [];
        for (const file of files) {
            try {
                const stat = await this.app.vault.adapter.stat(file.path);
                if (!stat || stat.size <= 0) {
                    invalid.push(`${file.label} → ${file.path}（不存在或为空）`);
                }
            } catch (e) {
                invalid.push(`${file.label} → ${file.path}（校验失败：${errorText(e)}）`);
            }
        }
        return invalid;
    }

    private renderResult(
        planBox: HTMLElement,
        result: {
            volumes: number;
            totalChapters: number;
            createdChapters: number;
            createdFiles: number;
            failures: string[];
            invalidFiles: string[];
            unitLabel: string;
            isLong: boolean;
        }
    ): void {
        planBox.empty();
        const ok = result.failures.length === 0 && result.invalidFiles.length === 0;
        planBox.createEl('div', {
            text: `${ok ? '✅' : '⚠️'} 结果：${
                result.isLong
                    ? `${result.volumes} 卷 / ${result.createdChapters}/${result.totalChapters} 章`
                    : `${result.createdChapters}/${result.totalChapters} ${result.unitLabel}`
            }，新建 ${result.createdFiles} 个文件`,
            attr: { style: `font-weight:600;color:${ok ? 'var(--text-success)' : '#b8860b'};` },
        });

        if (result.failures.length > 0) {
            planBox.createEl('div', { text: `❌ 创建失败 ${result.failures.length} 项：`, attr: { style: 'color:var(--text-error);margin-top:6px;' } });
            for (const failure of result.failures.slice(0, 30)) {
                planBox.createEl('div', { text: `· ${failure}` });
            }
        }

        if (result.invalidFiles.length > 0) {
            planBox.createEl('div', { text: `❌ 落盘校验异常 ${result.invalidFiles.length} 项：`, attr: { style: 'color:var(--text-error);margin-top:6px;' } });
            for (const invalid of result.invalidFiles.slice(0, 30)) {
                planBox.createEl('div', { text: `· ${invalid}` });
            }
        }

        if (!ok) {
            planBox.createEl('div', {
                text: '修复后可直接再次点击「批量创建全部卷章节」，已存在的文件会自动跳过。',
                attr: { style: 'color:var(--text-muted);margin-top:6px;' },
            });
        }
    }

    private fallbackDetectProjects(): string[] {
        const projectDirs = new Set<string>();
        for (const file of this.app.vault.getFiles()) {
            const parts = file.path.split('/');
            if (parts.length < 2) continue;
            const rootDir = parts[0];
            if (rootDir.startsWith('.') || rootDir === '元文件') continue;
            if (parts.length === 2 && parts[1] === '.project') {
                projectDirs.add(rootDir);
            }
            if (parts[1] === '01-世界架构') {
                projectDirs.add(rootDir);
            }
        }
        return Array.from(projectDirs).sort();
    }

    onClose(): void {
        this._plan = null;
        const { contentEl } = this;
        contentEl.empty();
    }
}

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
