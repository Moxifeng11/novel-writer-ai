import { App, Modal, Notice, TFile, TFolder } from 'obsidian';
import NovelWriterPlugin from '../main';
import { ContextManager } from '../engine/context-manager';
import { mkdirp, showSuccess, showError, stripFrontmatter } from '../utils/helpers';
import { getChapterFileName, getChapterFile, findChapterFile, findBodyFileByChapterNum, normalizeChapterFiles, CHAPTER_FILE_TYPES } from '../engine/chapter-utils';
import { TemplateService } from '../engine/template-service';
import { ENGINE_NAMES } from '../shared/engine-names';
import { RE_VOLUME_HEADER, RE_RANGE_NUMBERS, RE_OUTLINE_TABLE_ROW } from '../shared/format-constants';
import { pjBodyDir, pjBodyFile, pjStepDir, pjVolumeOutlineFile, SUBDIR_BODY_ROOT, SUBDIR_STEP_ROOT, pjVolumeOutlineDir } from '../shared/paths';
import { BodyWriter } from '../engine/body-writer';
import { describeBodyFormat } from '../shared/body-format';
import { listFolderFiles } from '../shared/vault-tree';
import { createLogger } from '../shared/logger';


const log = createLogger('ContinueChaptersModal');

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
            wrapper.addClass('nw-modal');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
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

            contentEl.createEl('hr');
            contentEl.createEl('h3', { text: '✨ 自动生成续写内容' });
            contentEl.createEl('p', { text: '读取前一章正文和本章大纲，调用AI生成章节正文内容。' });

            const startChapterInput = contentEl.createEl('input', {
                type: 'text',
                placeholder: '起始章号（留空则从最后一章已完成正文+1开始）',
                cls: 'nw-input novel-writer-input'
            });

            const generateContentButton = contentEl.createEl('button', { text: '自动生成续写内容', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
            generateContentButton.onclick = async () => {
                await this.autoGenerateContents(projectSelect.value, startChapterInput.value);
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
                    } catch (e) { log.warn('[小说工坊] 操作失败:', e); }
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

        // 常驻进度条必须在 finally 里关：旧实现只在成功路径 hide()，
        // 中途 create 抛错（同名/只读/权限）会留下永久「正在创建章节 k/N」横幅，且错误不可见。
        try {
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

            const templateService = this.plugin.engineRegistry.get(ENGINE_NAMES.TEMPLATE_SERVICE);
            const vars = {
                project,
                volume,
                chapterName: chapName,
                chapterNumber: chapter.num,
            };

            const existingBody = findBodyFileByChapterNum(listFolderFiles<TFile>(this.app.vault, bodyDir), bodyDir, chapter.num, chapName);
            if (!existingBody) {
                const bodyContent = await templateService.getBodyTemplate(vars);
                await this.app.vault.create(bodyPath, bodyContent);
            }

            const existingOutline = findChapterFile(listFolderFiles<TFile>(this.app.vault, basePath), basePath, '大纲摘要');
            if (!existingOutline) {
                const outlineContent = await templateService.getOutlineTemplate(vars);
                await this.app.vault.create(outlinePath, outlineContent);
            }

            const existingInfo = findChapterFile(listFolderFiles<TFile>(this.app.vault, basePath), basePath, '信息规划');
            if (!existingInfo) {
                const infoContent = await templateService.getInfoPlanTemplate(vars);
                await this.app.vault.create(infoPath, infoContent);
            }

            done++;
            notice.setMessage(`⏳ 正在创建章节：${done}/${targetChapters.length}`);
        }
        } catch (e) {
            log.error('[ContinueChapters] 批量创建章节中断:', e);
            showError(
                `创建章节中断：已创建 ${done}/${targetChapters.length} 章。${e instanceof Error ? e.message : String(e)}`,
            );
            return;
        } finally {
            notice.hide();
        }

        showSuccess(`自动创建完成：${done}个章节`);
    }

    /**
     * 自动生成续写内容：读取前一章正文和本章大纲，调用AI生成正文并写入文件
     */
    private async autoGenerateContents(project: string, startChapterInput: string): Promise<void> {
        try {
            if (!this.plugin.hasAiCredentials) {
                showError('请先配置 API 密钥或本地模型端点');
                return;
            }

            const outlineContent = await this.readMergedOutline(project);
            if (!outlineContent) {
                showError('未找到分卷大纲，请先执行全书规划');
                return;
            }
            const chapters = this.parseOutlineChapters(outlineContent);
            if (chapters.length === 0) {
                showError('未解析到章节信息');
                return;
            }

            // 确定起始章号
            let startChapter = 0;
            if (startChapterInput && startChapterInput.trim()) {
                startChapter = parseInt(startChapterInput.trim(), 10);
                if (isNaN(startChapter) || startChapter < 1) {
                    showError('起始章号无效');
                    return;
                }
            } else {
                // 自动检测：最后一章已完成正文 + 1
                let lastComplete = 0;
                for (const chapter of chapters) {
                    for (const vol of this.getVolumes(project)) {
                        const vmN = vol.match(/第(\d+)卷/);
                        const vN = vmN ? parseInt(vmN[1], 10) : 0;
                        const bodyPath = vN > 0 ? pjBodyFile(project, vN, chapter.num) : '';
                        const bodyFile = bodyPath ? (this.app.vault.getAbstractFileByPath(bodyPath) as TFile | null) : null;
                        if (bodyFile) {
                            try {
                                const cache = this.app.metadataCache.getFileCache(bodyFile);
                                const status = cache?.frontmatter?.status;
                                if (status === 'written' || status === 'settled') {
                                    lastComplete = chapter.num;
                                }
                            } catch (e) { log.warn('[小说工坊] 操作失败:', e); }
                        }
                    }
                }
                startChapter = lastComplete + 1;
            }

            const targetChapters = chapters.filter(c => c.num >= startChapter);
            if (targetChapters.length === 0) {
                showSuccess('所有章节内容已生成');
                return;
            }

            // 加载项目上下文
            const promptCtx = await this.plugin.ctxManager.buildPromptSection(project);
            const worldView = promptCtx.worldView || '';
            const settingLib = promptCtx.settingLib ? promptCtx.settingLib.slice(0, 1500) : '';
            const writingStyle = promptCtx.writingStyle ? promptCtx.writingStyle.slice(0, 1000) : '';
            const timelineEvents = promptCtx.timeline ? promptCtx.timeline.slice(0, 500) : '';

            // 构建角色信息摘要
            let characters = '';
            if (promptCtx.rawCharacters && promptCtx.rawCharacters.length > 0) {
                const charLines = promptCtx.rawCharacters.map(ch => {
                    const name = ch.name || ch.姓名 || '';
                    if (!name) return '';
                    return `- ${name}：身份=${ch['身份'] || '—'}，性格=${ch['性格标签'] || '—'}，动机=${ch['核心动机'] || '—'}，状态=${ch['当前状态'] || '—'}`;
                }).filter(Boolean);
                characters = charLines.join('\n').slice(0, 2000);
            }

            const notice = new Notice(`⏳ 正在生成续写内容：0/${targetChapters.length}`, 0);
            let done = 0;
            // 续写输出与正文落盘共用同一份格式契约
            const bodyFormat = await new BodyWriter({ app: this.app }).resolveContract(project);

            for (const chapter of targetChapters) {
                const volume = this.findVolumeForChapter(project, chapter.num);
                const chapName = `第${chapter.num}章`;
                const volMatchN = volume.match(/第(\d+)卷/);
                const volN = volMatchN ? parseInt(volMatchN[1], 10) : 0;

                notice.setMessage(`⏳ 正在生成 ${chapName}（${done}/${targetChapters.length}）`);

                // 1. 读取前一章正文最后 1500 字（尾部太短会丢失承接所需的人物/场景状态）
                const prevTail = await this.readPreviousChapterTail(project, chapter.num);

                // 2. 读取本章大纲摘要
                const outlineSummary = await this.readChapterOutlineSummary(project, chapter, volN);

                // 3. 定位正文文件（不存在则创建）
                const bodyDir = volN > 0
                    ? pjBodyDir(project, volN)
                    : `${project}/${SUBDIR_BODY_ROOT}/${volume}`;
                const bodyPath = volN > 0 ? pjBodyFile(project, volN, chapter.num) : `${bodyDir}/${chapName}_正文.md`;
                let bodyFile = findBodyFileByChapterNum(listFolderFiles<TFile>(this.app.vault, bodyDir), bodyDir, chapter.num, chapName);
                if (!bodyFile) {
                    await mkdirp(this.app, bodyDir);
                    const templateService = this.plugin.engineRegistry.get(ENGINE_NAMES.TEMPLATE_SERVICE);
                    const bodyContent = await templateService.getBodyTemplate({
                        project, volume, chapterName: chapName, chapterNumber: chapter.num
                    });
                    bodyFile = await this.app.vault.create(bodyPath, bodyContent);
                }

                // 4. 构建系统提示词
                const sysPrompt = `你是专业小说写手，根据前文和大纲续写下一章正文。
要求：
1. 连续性：本章首句无缝承接前一章结尾
2. 字数：≥2500字
3. 对话和动作推动剧情
4. 分段与缩进严格按下方【输出格式（硬性约束）】执行
5. 标题行 '# 第X章' 后面只写标题（2-15字）
6. 不使用破折号、分号、省略号
7. 感叹号≤3个
8. 无排比、无抒情升华、无过度心理描写

${describeBodyFormat({ ...bodyFormat, allowTitle: true })}`;

                // 5. 构建用户提示词
                let userContent = `请撰写第${chapter.num}章正文，输出完整 .md 格式，标题为 # 第${chapter.num}章。\n\n`;
                if (prevTail) userContent += `【前文最后1500字】\n${prevTail}\n\n`;
                userContent += `【本章大纲摘要】\n${outlineSummary}\n\n`;
                if (worldView) userContent += `【世界观概述】\n${worldView.slice(0, 500)}\n\n`;
                if (settingLib) userContent += `【设定库】\n${settingLib}\n\n`;
                if (writingStyle) userContent += `【文笔风格要求】\n${writingStyle}\n\n`;
                if (timelineEvents) userContent += `【时间线事件】\n${timelineEvents}\n\n`;
                if (characters) userContent += `【角色信息】\n${characters}\n\n`;
                userContent += `请直接输出正文内容，以 # 第${chapter.num}章 开头。`;

                // 6. 调用 AI 生成
                const result = await this.plugin.aiEngine.callAI(
                    sysPrompt,
                    userContent,
                    undefined,
                    0.7,
                    this.plugin.settings.maxOutput
                );

                if (result.error) {
                    new Notice(`❌ 第${chapter.num}章生成失败：${result.error}`, 8000);
                    continue;
                }

                if (!result.content || result.content.trim().length < 100) {
                    new Notice(`❌ 第${chapter.num}章生成内容为空`, 8000);
                    continue;
                }

                // 7. 统一落盘入口（保留原有 frontmatter、统一标题与缩进）
                const writer = new BodyWriter({ app: this.app });
                await writer.write({
                    path: bodyFile.path,
                    raw: result.content,
                    chapterNum: chapter.num,
                    chapterName: chapName,
                    volume,
                    project,
                    writingMode: 'continue',
                    naturalize: this.plugin.settings.naturalParagraphMode !== false,
                });

                done++;
                notice.setMessage(`⏳ 正在生成续写内容：${done}/${targetChapters.length}`);
            }

            notice.hide();
            showSuccess(`续写内容生成完成：${done}/${targetChapters.length} 章`);
        } catch (e) {
            log.error('[小说工坊] 自动生成续写内容失败:', e);
            showError(`生成失败：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /**
     * 读取前一章正文的最后 1500 字作为续写上下文
     */
    private async readPreviousChapterTail(project: string, chapterNum: number): Promise<string> {
        if (chapterNum <= 1) return '';
        const prevNum = chapterNum - 1;
        for (const vol of this.getVolumes(project)) {
            const vmN = vol.match(/第(\d+)卷/);
            const vN = vmN ? parseInt(vmN[1], 10) : 0;
            if (vN <= 0) continue;
            const bodyPath = pjBodyFile(project, vN, prevNum);
            const bodyFile = this.app.vault.getAbstractFileByPath(bodyPath) as TFile | null;
            if (bodyFile) {
                try {
                    const content = await this.app.vault.read(bodyFile);
                    const clean = content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
                    return clean.slice(-1500);
                } catch (e) { log.warn('[小说工坊] 读取前一章正文失败:', e); }
            }
        }
        return '';
    }

    /**
     * 读取本章大纲摘要：合并章节分配表中的核心冲突描述和大纲摘要文件内容
     */
    private async readChapterOutlineSummary(project: string, chapter: ChapterInfo, volN: number): Promise<string> {
        const parts: string[] = [];
        if (chapter.conflict) {
            parts.push(`核心冲突：${chapter.conflict}`);
        }
        if (volN > 0) {
            const basePath = pjStepDir(project, volN, chapter.num);
            const outlineFile = findChapterFile(listFolderFiles<TFile>(this.app.vault, basePath), basePath, '大纲摘要');
            if (outlineFile) {
                try {
                    const content = stripFrontmatter(await this.app.vault.read(outlineFile));
                    if (content.trim().length > 20) {
                        parts.push(content.slice(0, 800));
                    }
                } catch (e) { log.warn('[小说工坊] 读取大纲摘要失败:', e); }
            }
        }
        return parts.join('\n\n');
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

        for (const f of listFolderFiles<TFile>(this.app.vault, `${project}/03-大纲与章节`, { recursive: true })) {
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
        for (const f of listFolderFiles<TFile>(this.app.vault, pjVolumeOutlineDir(project))) {
            if (f.name.endsWith('_分卷大纲.md')) {
                try { parts.push(await this.app.vault.read(f)); } catch (e) { log.warn('[小说工坊] 读取分卷大纲失败:', f.path, e); }
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
