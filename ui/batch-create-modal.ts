import { App, Modal, Notice, TFolder } from 'obsidian';
import NovelWriterPlugin from '../main';
import { ContextManager } from '../engine/context-manager';
import { getChapterFileName, findChapterFile, normalizeChapterFiles, CHAPTER_FILE_TYPES, findBodyFileV4 } from '../engine/chapter-utils';
import { readMergedVolumeOutline } from '../utils/helpers';
import { pjBodyDir, pjBodyFile, pjStepDir } from '../shared/paths';
import { mkdirp } from '../utils/helpers';
import { TemplateService } from '../services/template-service';
import { ENGINE_NAMES } from '../engine/engine-registry';
import { countPlannedChapters, hasBlockingIssues, parseVolumePlan, VolumePlan, VolumePlanParseResult } from '../shared/volume-plan';
import { createLogger } from '../shared/logger';


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

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.contextManager = plugin.ctxManager;
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
        contentEl.createEl('h2', { text: '📦 批量建章（按全书规划）' });
        contentEl.createEl('p', {
            text: '读取上一步「AI 全书规划」产出的分卷大纲，一次性为全部卷创建章节骨架；建章前会校验大纲一致性，建章后会校验落盘完整性。',
            attr: { style: 'font-size:0.85em;color:var(--text-muted);margin-top:-6px;' },
        });

        const projectSelect = contentEl.createEl('select', { cls: 'nw-select novel-writer-select' });
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
            projectSelect.onchange = () => { void loadPlan(); };
            await loadPlan();
        };

        createButton.onclick = async () => {
            const project = projectSelect.value;
            const plan = this._plan;
            if (!project || !plan) {
                new Notice('❌ 全书规划尚未就绪，无法建章', 5000);
                return;
            }
            if (hasBlockingIssues(plan)) {
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

    private async batchCreateAll(project: string, volumes: VolumePlan[], planBox: HTMLElement): Promise<void> {
        const sortedVolumes = [...volumes].sort((a, b) => a.volumeNumber - b.volumeNumber);
        const totalChapters = countPlannedChapters({ volumes, issues: [] });
        const progressNotice = new Notice(`⏳ 正在按全书规划创建 ${sortedVolumes.length} 卷 / ${totalChapters} 章...`, 0);

        const failures: string[] = [];
        const writtenFiles: WrittenFile[] = [];
        let createdChapters = 0;
        let createdFiles = 0;
        let processedChapters = 0;

        const allFiles = this.app.vault.getFiles();
        const templateService = this.plugin.engineRegistry.get<TemplateService>(ENGINE_NAMES.TEMPLATE_SERVICE);

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

                    const vars = { project, volume: volume.volumeLabel, chapterName, chapterNumber };

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
                    progressNotice.setMessage(`⏳ 批量建章 ${processedChapters}/${totalChapters} 章...`);
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
        });

        if (!hasProblem) {
            new Notice(`✅ 已按全书规划创建 ${sortedVolumes.length} 卷 / ${createdChapters} 章（${createdFiles} 个新文件），落盘校验通过`, 6000);
            this.close();
            return;
        }

        // 有失败/校验异常时不关闭弹窗，保留清单供用户修复后重试（重试会跳过已存在文件）
        new Notice(`⚠️ 建章完成但存在问题：成功 ${createdChapters}/${totalChapters} 章，失败 ${failures.length} 章，落盘异常 ${invalidFiles.length} 项。详见弹窗清单`, 12000);
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
        }
    ): void {
        planBox.empty();
        const ok = result.failures.length === 0 && result.invalidFiles.length === 0;
        planBox.createEl('div', {
            text: `${ok ? '✅' : '⚠️'} 结果：${result.volumes} 卷 / ${result.createdChapters}/${result.totalChapters} 章，新建 ${result.createdFiles} 个文件`,
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
