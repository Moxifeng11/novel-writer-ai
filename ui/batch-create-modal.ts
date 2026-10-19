import { App, Modal, Notice, TFile, TFolder } from 'obsidian';
import NovelWriterPlugin from '../main';
import { ContextManager } from '../engine/context-manager';
import { getChapterFileName, findChapterFile, normalizeChapterFiles, CHAPTER_FILE_TYPES, findBodyFileV4 } from '../engine/chapter-utils';
import { FIELD_CHAPTER_RANGE, RE_VOLUME_HEADER, RE_VOLUME_NAME, RE_CHAPTER_RANGE } from '../shared/format-constants';
import { readMergedVolumeOutline } from '../utils/helpers';
import { pjBodyDir, pjBodyFile, pjStepDir, pjStepFile, SUBDIR_BODY_ROOT, SUBDIR_STEP_ROOT } from '../shared/paths';
import { mkdirp } from '../utils/helpers';
import { TemplateService } from '../services/template-service';
import { ENGINE_NAMES } from '../engine/engine-registry';
import { createLogger } from '../shared/logger';


const log = createLogger('BatchCreateModal');
export class BatchCreateModal extends Modal {
    private plugin: NovelWriterPlugin;
    private contextManager: ContextManager;
    private _volumeData: Map<string, { volName: string; startChapter: number; endChapter: number; rawSection: string }> | null = null;

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
        contentEl.createEl('h2', { text: '📦 批量建章' });

        const projectSelect = contentEl.createEl('select', { cls: 'nw-select novel-writer-select' });

        const populateProjects = async () => {
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

            projects.forEach(project => {
                projectSelect.createEl('option', { value: project, text: project });
            });

            const volumeSelect = contentEl.createEl('select', { cls: 'nw-select novel-writer-select' });

            const startInput = contentEl.createEl('input', {
                type: 'text',
                placeholder: '起始章号（如：1）',
                cls: 'nw-input novel-writer-input',
                value: '1'
            });

            const endInput = contentEl.createEl('input', {
                type: 'text',
                placeholder: '结束章号（如：20）',
                cls: 'nw-input novel-writer-input',
                value: '20'
            });

            const hintEl = contentEl.createEl('div');

            const populateVolumes = async () => {
                const project = projectSelect.value;
                volumeSelect.innerHTML = '';
                hintEl.innerHTML = '';
                this._volumeData = null;

                // v4.0：合并读取 分卷大纲/第N卷_分卷大纲.md（兼容旧单文件）
                const content = await readMergedVolumeOutline(this.app, project);

                if (content && content.trim().length > 0) {
                    try {
                        const volumeMap = new Map<string, { volName: string; startChapter: number; endChapter: number; rawSection: string }>();

                        // Find all ### 第N卷 headers
                        const volHeaders: Array<{ volNum: string; startIndex: number; endIndex: number }> = [];
                        const headerRegex = new RegExp(RE_VOLUME_HEADER.source, 'gm');
                        let match;
                        while ((match = headerRegex.exec(content)) !== null) {
                            volHeaders.push({ volNum: match[1], startIndex: match.index, endIndex: -1 });
                        }

                        // Calculate end indices for each volume section
                        for (let i = 0; i < volHeaders.length; i++) {
                            if (i < volHeaders.length - 1) {
                                volHeaders[i].endIndex = volHeaders[i + 1].startIndex;
                            } else {
                                volHeaders[i].endIndex = content.length;
                            }
                        }

                        // Parse each volume section
                        for (let i = 0; i < volHeaders.length; i++) {
                            const { volNum, startIndex, endIndex } = volHeaders[i];
                            const section = content.substring(startIndex, endIndex);

                            // Extract volume name
                            const nameMatch = section.match(new RegExp(`- \\*\\*卷名\\*\\*：` + RE_VOLUME_NAME.source));
                            const volName = nameMatch ? nameMatch[1] : '未命名';

                            // Extract chapter range
                            const rangeMatch = section.match(new RegExp(`- \\*\\*章节范围\\*\\*[：:]\\s*` + RE_CHAPTER_RANGE.source));
                            const startChapter = rangeMatch ? parseInt(rangeMatch[1]) : 1;
                            const endChapter = rangeMatch ? parseInt(rangeMatch[2]) : startChapter;

                            volumeMap.set(volNum, { volName, startChapter, endChapter, rawSection: section });

                            // Create dropdown option
                            const optionText = `${volNum} · ${volName}（第${startChapter}章-第${endChapter}章）`;
                            volumeSelect.createEl('option', { value: volNum, text: optionText });
                        }

                        this._volumeData = volumeMap;
                        return;
                    } catch (e) {
                        log.warn('解析分卷大纲失败，回退到文件夹扫描:', e);
                    }
                }

                // Fallback: folder scanning（v4.0：卷目录位于 正文/第N卷 与 步骤结果/第N卷）
                const volumes = new Set<string>();
                for (const file of this.app.vault.getFiles()) {
                    const m = file.path.match(new RegExp(`${project}/(?:${SUBDIR_BODY_ROOT}|${SUBDIR_STEP_ROOT})/(第\\d+卷)/`));
                    if (m) volumes.add(m[1]);
                }

                if (volumes.size === 0) {
                    volumes.add('第1卷');
                }

                volumes.forEach(vol => {
                    volumeSelect.createEl('option', { value: vol, text: vol });
                });

                this._volumeData = null;
            };

            const populateHint = () => {
                hintEl.innerHTML = '';
                if (!this._volumeData) return;

                const volData = this._volumeData.get(volumeSelect.value);
                if (!volData) return;

                // Auto-fill inputs
                startInput.value = String(volData.startChapter);
                endInput.value = String(volData.endChapter);

                // Parse chapter table
                const tableRegex = /^\|\s*\d+\s*\|/gm;
                const tableMatches = volData.rawSection.match(tableRegex);
                const tableCount = tableMatches ? tableMatches.length : 0;

                if (tableCount === 0) return;

                const rangeCount = volData.endChapter - volData.startChapter + 1;

                if (tableCount === rangeCount) {
                    hintEl.innerHTML = `<p style="font-size:0.8em;color:var(--text-muted)">（大纲范围：第${volData.startChapter}章-第${volData.endChapter}章，表格检测到 ${tableCount} 章）</p>`;
                } else {
                    hintEl.innerHTML = `<p style="font-size:0.8em;color:#b8860b">⚠️ 表格仅检测到 ${tableCount} 章，与声明范围（第${volData.startChapter}章-第${volData.endChapter}章）不一致</p>`;
                }
            };

            projectSelect.onchange = async () => {
                await populateVolumes();
                if (volumeSelect.options.length > 0) {
                    volumeSelect.selectedIndex = 0;
                    populateHint();
                }
            };
            volumeSelect.onchange = populateHint;
            await populateVolumes();
            populateHint();

            const createButton = contentEl.createEl('button', { text: '批量创建', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
            createButton.onclick = async () => {
                const project = projectSelect.value;
                const volume = volumeSelect.value;
                const start = parseInt(startInput.value) || 1;
                const end = parseInt(endInput.value) || 20;

                await this.batchCreate(project, volume, start, end);
            };
        };

        populateProjects();
    }

    private async batchCreate(project: string, volume: string, start: number, end: number): Promise<void> {
        const createNotice = new Notice(`⏳ 正在批量创建第${start}-${end}章...`, 0);

        let count = 0;
        // U7（技术审计）：批量单项失败此前仅写日志用户不可见，收集失败清单供结束汇总
        const failures: string[] = [];
        const volN = parseInt(volume.match(/\d+/)?.[0] || '0') || 1;
        const allFiles = this.app.vault.getFiles();
        const templateService = this.plugin.engineRegistry.get<TemplateService>(ENGINE_NAMES.TEMPLATE_SERVICE);

        for (let i = start; i <= end; i++) {
            const chapterName = `第${i}章`;
            const bodyDir = pjBodyDir(project, volN);
            const stepDir = pjStepDir(project, volN, i);

            try {
                await mkdirp(this.app, bodyDir);
                await mkdirp(this.app, stepDir);

                const stepFolder = this.app.vault.getAbstractFileByPath(stepDir);
                if (stepFolder instanceof TFolder) {
                    await normalizeChapterFiles(this.app, stepFolder, chapterName);
                }

                const vars = {
                    project,
                    volume,
                    chapterName,
                    chapterNumber: i,
                };

                // 仅创建当前 11 步流水线实际使用的步骤文件；
                // 旧版 selfCheck / fix / finalFix / continuityReview 已合并入 qualityControl，
                // 不再预生成空报告占位（连贯性审查由 ReviewAgent 在需要时按需创建）。
                const stepFileTypes: Array<{ key: string; type: string; templateKey: string }> = [
                    { key: 'infoPlan', type: CHAPTER_FILE_TYPES.infoPlan, templateKey: 'infoPlan' },
                    { key: 'plotDistill', type: CHAPTER_FILE_TYPES.plotDistill, templateKey: 'plotDistill' },
                    { key: 'outline', type: CHAPTER_FILE_TYPES.outline, templateKey: 'outline' },
                    { key: 'emotionPlan', type: CHAPTER_FILE_TYPES.emotionPlan, templateKey: 'emotionPlan' },
                    { key: 'sceneExpand', type: CHAPTER_FILE_TYPES.sceneExpand, templateKey: 'sceneExpand' },
                    { key: 'characterSoul', type: CHAPTER_FILE_TYPES.characterSoul, templateKey: 'characterSoul' },
                    { key: 'qualityControl', type: CHAPTER_FILE_TYPES.qualityControl, templateKey: 'qualityControl' },
                    { key: 'analysisReport', type: CHAPTER_FILE_TYPES.analysisReport, templateKey: 'analysisReport' },
                ];

                for (const { type, templateKey } of stepFileTypes) {
                    const existing = findChapterFile(allFiles, stepDir, type);
                    if (!existing) {
                        const filePath = `${stepDir}/${getChapterFileName(chapterName, type)}`;
                        const fileContent = await templateService.getStepTemplate(templateKey, vars);
                        await this.app.vault.create(filePath, fileContent);
                    }
                }

                const bodyPath = pjBodyFile(project, volN, i);
                // v4.1.1 fix: 使用 findBodyFileV4 正确查找正文章节文件
                // 之前用 findChapterFile(allFiles, bodyDir, '正文') 传入的是卷目录而非章目录，导致匹配失败
                const existingBody = findBodyFileV4(this.app, project, volN, i);
                if (!existingBody) {
                    const bodyContent = await templateService.getBodyTemplate(vars);
                    await this.app.vault.create(bodyPath, bodyContent);
                }

                count++;
            } catch (e) {
                log.warn(`创建第${i}章失败:`, e);
                failures.push(`第${i}章`);
            }
        }

        createNotice.hide();
        // U7：失败项汇总反馈（截取前 5 个避免 Notice 过长，完整原因见控制台日志）
        if (failures.length > 0) {
            new Notice(`⚠️ 批量创建完成：成功 ${count} 章，失败 ${failures.length} 章（${failures.slice(0, 5).join('、')}${failures.length > 5 ? ' 等' : ''}），原因详见控制台`, 10000);
        } else {
            new Notice(`✅ 批量创建完成，成功创建 ${count} 个章节`, 5000);
        }
        this.close();
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
        const { contentEl } = this;
        contentEl.empty();
    }
}
