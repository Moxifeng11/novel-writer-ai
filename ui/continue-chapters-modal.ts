import { App, Modal, Notice, TFile, TFolder } from 'obsidian';
import NovelWriterPlugin from '../main';
import { ContextManager } from '../engine/context-manager';
import { mkdirp, showSuccess, showError } from '../utils/helpers';
import { getChapterFileName, getChapterFile, findChapterFile, normalizeChapterFiles, CHAPTER_FILE_TYPES } from '../engine/chapter-utils';
import { TemplateService } from '../services/template-service';
import { RE_VOLUME_HEADER, RE_RANGE_NUMBERS, RE_OUTLINE_TABLE_ROW } from '../shared/format-constants';
import { pjBodyDir, pjBodyFile, pjStepDir, pjVolumeOutlineFile, SUBDIR_BODY_ROOT, SUBDIR_STEP_ROOT, pjVolumeOutlineDir } from '../shared/paths';

export class ContinueChaptersModal extends Modal {
    private plugin: NovelWriterPlugin;
    private contextManager: ContextManager;

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
            wrapper.style.setProperty('max-width', 'min(650px, 90vw)', 'important');
            wrapper.style.setProperty('width', 'min(650px, 90vw)', 'important');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.maxWidth = 'min(650px, 90vw)';
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.empty();
        contentEl.createEl('h2', { text: '🔗 续写规划' });

        const projectSelect = contentEl.createEl('select', { cls: 'nw-select novel-writer-select' });

        const populateProjects = async () => {
            const projects = await this.contextManager.detectProjects();
            if (projects.length === 0) {
                contentEl.createEl('p', { text: '❌ 未找到项目，请先创建新项目' });
                return;
            }

            projects.forEach(project => {
                projectSelect.createEl('option', { value: project, text: project });
            });

            const detectButton = contentEl.createEl('button', { text: '检测续写起点', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
            detectButton.onclick = async () => {
                await this.detectContinuePoint(projectSelect.value);
            };

            const autoCreateButton = contentEl.createEl('button', { text: '自动创建章节', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
            autoCreateButton.onclick = async () => {
                await this.autoCreateChapters(projectSelect.value);
            };
        };

        populateProjects();
    }

    private async detectContinuePoint(project: string): Promise<void> {
        const outlineContent = await this.readMergedOutline(project);
        if (!outlineContent) {
            showError('未找到分卷大纲，请先执行全书规划');
            return;
        }
        const chapters = this.parseOutlineChapters(outlineContent);

        let lastCompleteChapter = 0;
        let lastChapterFile = 0;

        for (const chapter of chapters) {
            for (const vol of this.getVolumes(project)) {
                // v4.0: 正文文件直接通过 pjBodyFile 查找
                const vmN = vol.match(/第(\d+)卷/);
                const vN = vmN ? parseInt(vmN[1], 10) : 0;
                const bodyPath = vN > 0 ? pjBodyFile(project, vN, chapter.num) : '';
                const bodyFile = bodyPath ? (this.app.vault.getAbstractFileByPath(bodyPath) as TFile | null) : null;
                if (bodyFile) {
                    lastChapterFile = chapter.num;
                    try {
                        const cache = this.app.metadataCache.getFileCache(bodyFile);
                        const status = cache?.frontmatter?.status;
                        if (status === 'written' || status === 'settled') {
                            lastCompleteChapter = chapter.num;
                        }
                    } catch (e) { console.warn('[小说工坊] 操作失败:', e); }
                }
            }
        }

        let resultMsg = `## 续写检测结果\n\n`;
        resultMsg += `- **大纲总章节数**: ${chapters.length}\n`;
        resultMsg += `- **已创建章节文件**: ${lastChapterFile}\n`;
        resultMsg += `- **已完成正文**: ${lastCompleteChapter}\n\n`;

        if (lastCompleteChapter === chapters.length) {
            resultMsg += `✅ 全书已完成！`;
        } else {
            const nextChapter = lastCompleteChapter + 1;
            const targetVol = this.findVolumeForChapter(project, nextChapter);
            resultMsg += `📌 续写起点：**第${nextChapter}章**（${targetVol}）\n\n`;
            resultMsg += `需要创建的章节：${nextChapter} - ${chapters.length}（共${chapters.length - lastCompleteChapter}章）`;
        }

        const resultEl = document.createElement('div');
        resultEl.innerHTML = resultMsg;
        this.contentEl.appendChild(resultEl);
    }

    private async autoCreateChapters(project: string): Promise<void> {
        const outlineContent = await this.readMergedOutline(project);
        if (!outlineContent) {
            showError('未找到分卷大纲，请先执行全书规划');
            return;
        }
        const chapters = this.parseOutlineChapters(outlineContent);

        let lastChapterFile = 0;
        for (const chapter of chapters) {
            for (const vol of this.getVolumes(project)) {
                const vmN = vol.match(/第(\d+)卷/);
                const vN = vmN ? parseInt(vmN[1], 10) : 0;
                const bodyPath = vN > 0 ? pjBodyFile(project, vN, chapter.num) : '';
                const bodyFile = bodyPath ? (this.app.vault.getAbstractFileByPath(bodyPath) as TFile | null) : null;
                if (bodyFile) lastChapterFile = chapter.num;
            }
        }

        const startChapter = lastChapterFile + 1;
        const targetChapters = chapters.filter(c => c.num >= startChapter);

        if (targetChapters.length === 0) {
            showSuccess('所有章节文件已创建');
            return;
        }

        const notice = new Notice(`⏳ 正在创建章节：0/${targetChapters.length}`, 0);
        let done = 0;

        for (const chapter of targetChapters) {
            const volume = this.findVolumeForChapter(project, chapter.num);
            const chapName = `第${chapter.num}章`;
            const volMatchN = volume.match(/第(\d+)卷/);
            const volN = volMatchN ? parseInt(volMatchN[1], 10) : 0;
            // v4.0: basePath = 步骤结果目录；正文写入 pjBodyFile
            const basePath = volN > 0
                ? pjStepDir(project, volN, chapter.num)
                : `${project}/${SUBDIR_STEP_ROOT}/${volume}/${chapName}`;
            const bodyDir = volN > 0
                ? pjBodyDir(project, volN)
                : `${project}/${SUBDIR_BODY_ROOT}/${volume}`;

            await mkdirp(this.app, basePath);
            await mkdirp(this.app, bodyDir);

            // 【规范化】将旧格式文件统一迁移为标准格式
            const chapFolder = this.app.vault.getAbstractFileByPath(basePath);
            if (chapFolder instanceof TFolder) {
                await normalizeChapterFiles(this.app, chapFolder, chapName);
            }

            // v4.0: 正文位于 bodyDir
            const bodyPath = volN > 0 ? pjBodyFile(project, volN, chapter.num) : `${bodyDir}/${chapName}_正文.md`;
            const outlinePath = `${basePath}/${getChapterFileName(chapName, CHAPTER_FILE_TYPES.outline)}`;
            const infoPath = `${basePath}/${getChapterFileName(chapName, CHAPTER_FILE_TYPES.infoPlan)}`;

            const templateService = new TemplateService(this.app);
            const vars = {
                project,
                volume,
                chapterName: chapName,
                chapterNumber: chapter.num,
            };

            const existingBody = findChapterFile(this.app.vault.getFiles(), bodyDir, '正文', this.app);
            if (!existingBody) {
                const bodyContent = await templateService.getBodyTemplate(vars);
                await this.app.vault.create(bodyPath, bodyContent);
            }

            const existingOutline = findChapterFile(this.app.vault.getFiles(), basePath, '大纲摘要');
            if (!existingOutline) {
                const outlineContent = await templateService.getOutlineTemplate(vars);
                await this.app.vault.create(outlinePath, outlineContent);
            }

            const existingInfo = findChapterFile(this.app.vault.getFiles(), basePath, '信息规划');
            if (!existingInfo) {
                const infoContent = await templateService.getInfoPlanTemplate(vars);
                await this.app.vault.create(infoPath, infoContent);
            }

            done++;
            notice.setMessage(`⏳ 正在创建章节：${done}/${targetChapters.length}`);
        }

        notice.hide();
        showSuccess(`自动创建完成：${done}个章节`);
    }

    private parseOutlineChapters(content: string): ChapterInfo[] {
        const chapters: ChapterInfo[] = [];
        const lines = content.split('\n');
        let currentVol = '';

        for (const line of lines) {
            const volMatch = line.match(RE_VOLUME_HEADER);
            if (volMatch) {
                currentVol = volMatch[1];
                continue;
            }

            const chapMatch = line.match(RE_OUTLINE_TABLE_ROW);
            if (chapMatch) {
                chapters.push({
                    num: parseInt(chapMatch[1]),
                    conflict: chapMatch[2].trim(),
                    volume: currentVol
                });
            }
        }

        return chapters;
    }

    private getVolumes(project: string): string[] {
        const volumes: string[] = [];
        const visited = new Set<string>();

        for (const f of this.app.vault.getFiles()) {
            const m = f.path.match(new RegExp(`${project}/(?:${SUBDIR_BODY_ROOT}|${SUBDIR_STEP_ROOT})/(第\\d+卷)/`));
            if (m && !visited.has(m[1])) {
                volumes.push(m[1]);
                visited.add(m[1]);
            }
        }

        return volumes.sort((a, b) => {
            const numA = parseInt(a.match(/\d+/)?.[0] || '0');
            const numB = parseInt(b.match(/\d+/)?.[0] || '0');
            return numA - numB;
        });
    }

    private findVolumeForChapter(project: string, chapterNum: number): string {
        // v4.0: 该方法保留同步签名，但实际无法异步读取，沿用前次扫描结果
        // 调用方应在 detect/autoCreate 流程内已读取过 outline；此处仅做卷归属粗判
        let currentVol = '第1卷';
        // 在已存在的卷里挑 chapter.num 所在卷（按现存正文文件存在性）
        for (const vol of this.getVolumes(project)) {
            const vmN = vol.match(/第(\d+)卷/);
            const vN = vmN ? parseInt(vmN[1], 10) : 0;
            if (vN > 0) {
                const path = pjBodyFile(project, vN, chapterNum);
                if (this.app.vault.getAbstractFileByPath(path)) return vol;
                currentVol = vol;
            }
        }
        return currentVol;
    }

    /**
     * v4.0: 合并所有「分卷大纲/第X卷_分卷大纲.md」内容，向后兼容旧的单文件 03-大纲与章节/分卷大纲.md
     */
    private async readMergedOutline(project: string): Promise<string> {
        const parts: string[] = [];
        // 旧单文件兜底
        const legacy = this.app.vault.getAbstractFileByPath(`${pjVolumeOutlineFile(project, 0)}`);
        if (legacy instanceof TFile) parts.push(await this.app.vault.read(legacy));
        // 按卷归档：扫描 03-大纲与章节/分卷大纲/*.md
        const volOutlineDir = `${pjVolumeOutlineDir(project)}`;
        for (const f of this.app.vault.getFiles()) {
            if (f.path.startsWith(volOutlineDir) && f.name.endsWith('_分卷大纲.md')) {
                try { parts.push(await this.app.vault.read(f)); } catch (e) { console.warn('[小说工坊] 读取分卷大纲失败:', f.path, e); }
            }
        }
        return parts.join('\n\n');
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

interface ChapterInfo {
    num: number;
    conflict: string;
    volume: string;
}
