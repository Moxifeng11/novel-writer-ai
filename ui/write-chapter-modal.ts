/**
 * @deprecated Legacy 单章 AI 写作 Modal（命令 ID: novel-writer-write-chapter, 显示名带"〔旧〕"）。
 *
 * 当前推荐入口：
 *   - 完整写作工作台（FullWriterView，11 步流水线）
 *   - 句级协同写作工作台（CoWritingView）
 *
 * 保留原因：
 *   - 命令面板/快捷键可能仍有用户依赖
 *   - 与新工作台并存，作为快速一次性生成的回退路径
 *
 * 计划：在下个大版本（v5.x）评估完全移除，迁移用户到 FullWriterView。
 * 维护原则：仅修 Bug，不再加新特性。
 */
import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine, ChapterContext } from '../engine/ai-engine';
import { ContextManager } from '../engine/context-manager';
import { ForeshadowManager } from '../services/foreshadow-manager';
import { ReviewAgent } from '../engine/review-agent';
import { scoreAndFilterEntities, ScoredEntity } from '../engine/entity-scorer';
import { stripFrontmatter, showProgress, hideProgress, showSuccess, showError, showWarning } from '../utils/helpers';
import { extractWorldviewMeta } from './utils/worldview-utils';
import { getChapterFileName, findChapterFile, CHAPTER_FILE_TYPES } from '../engine/chapter-utils';
import { isInfoPlanComplete, isOutlineComplete } from '../shared/info-debt';
import { filterForeshadowsByChapter, getInvolvedEntities, getEntityStatusLine } from '../engine/chapter-context-builder';
import { FIX_PROMPTS, fillTemplate } from '../engine/prompt-templates';
import { SettlementEngine, SettlementResult } from '../engine/settlement-engine';
import { ENGINE_NAMES } from '../engine/engine-registry';
import { pjBodyDir, pjBodyFile, pjForeshadowDB, pjStepDir, pjVolumeOutlineFile, SUBDIR_STEP_ROOT } from '../shared/paths';
import { CHARACTER_DISPLAY_KEYS } from '../shared/format-constants';
import { buildStepFrontmatter } from '../shared/step-frontmatter';
import { createLogger } from '../shared/logger';


const log = createLogger('WriteChapterModal');
export class WriteChapterModal extends Modal {
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;
    private contextManager: ContextManager;
    private foreshadowManager: ForeshadowManager;
    private reviewAgent: ReviewAgent;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.aiEngine = plugin.aiEngine;
        this.contextManager = plugin.ctxManager;
        this.foreshadowManager = plugin.foreshadowManager;
        this.reviewAgent = plugin.reviewAgent;
    }

    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;
        const activeFile = this.app.workspace.getActiveFile();

        // ═══ v3.4.8: 两层CSS规则 — 见 docs/CSS变量注入与两层规则_全插件避坑指南.md ═══
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.empty();
        contentEl.createEl('h2', { text: '✍️ AI写正文' });

        if (!activeFile) {
            contentEl.createEl('p', { text: '❌ 请先打开章节正文文件' });
            return;
        }

        const path = activeFile.path;
        const parsed = WriteChapterModal.parseChapterPath(path);
        if (!parsed) {
            contentEl.createEl('p', { text: '❌ 当前文件不在 v4.0 章节路径中（需位于 正文/ 或 步骤结果/ 下）' });
            return;
        }
        const { project, volN, chapN, volName, chapName } = parsed;
        const chapDir = pjStepDir(project, volN, chapN);
        contentEl.createEl('p', { text: `正在为 ${project} → ${volName} → ${chapName} 生成正文...` });
        this.writeChapter(project, volName, chapName, chapN, chapDir, true);
    }

    static async runBackground(app: App, plugin: NovelWriterPlugin): Promise<void> {
        const activeFile = app.workspace.getActiveFile();
        if (!activeFile) {
            showError('请先打开章节正文文件');
            return;
        }

        const path = activeFile.path;
        const parsed = WriteChapterModal.parseChapterPath(path);
        if (!parsed) {
            showError('当前文件不在 v4.0 章节路径中');
            return;
        }
        const { project, volN, chapN, volName, chapName } = parsed;
        const chapDir = pjStepDir(project, volN, chapN);

        const aiEngine = plugin.aiEngine;
        const reviewAgent = plugin.reviewAgent;

        await WriteChapterModal.doWriteChapter(
            app, plugin, aiEngine, reviewAgent,
            project, volName, chapName, chapN, chapDir, false
        );
    }

    /**
     * v4.0: 从活动文件路径中解析出 project / 卷号 / 章号
     * 支持两类路径：
     *  - 正文：{project}/03-大纲与章节/正文/第V卷/第C章[_标题]_正文.md
     *  - 步骤：{project}/03-大纲与章节/步骤结果/第V卷/第C章/xxx.md
     */
    static parseChapterPath(path: string): { project: string; volN: number; chapN: number; volName: string; chapName: string } | null {
        const bodyMatch = path.match(/^(.+?)\/03-大纲与章节\/正文\/第(\d+)卷\/第(\d+)章[^/]*\.md$/);
        if (bodyMatch) {
            const volN = parseInt(bodyMatch[2], 10);
            const chapN = parseInt(bodyMatch[3], 10);
            return { project: bodyMatch[1], volN, chapN, volName: `第${volN}卷`, chapName: `第${chapN}章` };
        }
        const stepMatch = path.match(/^(.+?)\/03-大纲与章节\/步骤结果\/第(\d+)卷\/第(\d+)章\//);
        if (stepMatch) {
            const volN = parseInt(stepMatch[2], 10);
            const chapN = parseInt(stepMatch[3], 10);
            return { project: stepMatch[1], volN, chapN, volName: `第${volN}卷`, chapName: `第${chapN}章` };
        }
        return null;
    }

    private static async doWriteChapter(
        app: App, plugin: NovelWriterPlugin, aiEngine: AIEngine, reviewAgent: ReviewAgent,
        project: string, volName: string, chapName: string, chapNum: number, chapDir: string,
        showStepProgress: boolean
    ): Promise<void> {
        if (!plugin.settings.apiKey) {
            showError('请先配置API密钥');
            return;
        }

        if (showStepProgress) showProgress('📖 加载上下文数据...');

        const volN = parseInt(volName.match(/\d+/)?.[0] ?? '0', 10) || 1;

        let planForThisChap = '';
        try {
            // v4.0：分卷大纲按卷归档
            const pf = app.vault.getAbstractFileByPath(pjVolumeOutlineFile(project, volN));
            if (pf instanceof TFile) planForThisChap = await app.vault.read(pf);
        } catch (e) { log.warn('[小说工坊] 操作失败:', e); }
        const chapPlan = planForThisChap.match(new RegExp(`第${chapNum}章[\\s\\S]*?(?=\\n###|$)`))?.[0] || '';

        if (showStepProgress) showProgress('📖 读取前文摘要...');

        let prevChaptersSummary = '';
        for (let n = 1; n < chapNum; n++) {
            // v4.0：步骤结果按 步骤结果/第V卷/第N章/ 归档；正文则在 正文/第V卷/ 下
            const prevDir = pjStepDir(project, volN, n);
            const prevOutline = findChapterFile(app.vault.getFiles(), prevDir, '大纲摘要');
            if (prevOutline) {
                const c = stripFrontmatter(await app.vault.read(prevOutline));
                if (c.length > 50) prevChaptersSummary += `\n【第${n}章摘要】${c.slice(0, 300)}`;
            }
            if (n === chapNum - 1) {
                // v4.0：上一章正文文件位于 正文/第V卷/ 而非步骤结果目录
                const prevBodyPath = pjBodyFile(project, volN, n);
                let prevBody: TFile | undefined;
                const pbf = app.vault.getAbstractFileByPath(prevBodyPath);
                if (pbf instanceof TFile) prevBody = pbf;
                if (!prevBody) {
                    // 兜底：在卷正文目录里寻找 "第n章...正文.md" 形态
                    const bodyDir = pjBodyDir(project, volN);
                    prevBody = app.vault.getFiles().find(f =>
                        f.path.startsWith(bodyDir + '/') &&
                        f.name.startsWith(`第${n}章`) &&
                        f.name.includes('正文') &&
                        f.name.endsWith('.md')
                    );
                }
                if (prevBody) {
                    const bc = await app.vault.read(prevBody);
                    const paragraphs = bc.split('\n').filter(p => p.trim().length > 20);
                    const lastPara = paragraphs.length > 0 ? paragraphs[paragraphs.length - 1].trim().slice(0, 500) : '';
                    if (lastPara.length > 10) prevChaptersSummary += `\n【上一章结束场景】${lastPara}……`;
                    const firstPara = paragraphs.length > 1 ? paragraphs[0].trim().slice(0, 200) : '';
                    if (firstPara.length > 20) prevChaptersSummary += `\n【上一章开局】${firstPara}……`;
                }
                try {
                    const reportFile = findChapterFile(app.vault.getFiles(), prevDir, '分析报告');
                    if (reportFile) {
                        const reportText = await app.vault.read(reportFile);
                        const suggestMatch = reportText.match(/(?:续写建议|写作建议|建议)[：:]\s*([^#]+)/);
                        if (suggestMatch) {
                            prevChaptersSummary += `\n【上章分析·续写建议】${suggestMatch[1].trim().slice(0, 500)}`;
                        }
                        const breakMatch = reportText.match(/(?:互信息断裂|断裂检测|逻辑断裂)[：:]\s*([^#]+)/);
                        if (breakMatch) {
                            prevChaptersSummary += `\n【上章分析·改进方向】${breakMatch[1].trim().slice(0, 300)}`;
                        }
                    }
                    const reviewFile = findChapterFile(app.vault.getFiles(), prevDir, '连贯性审查');
                    if (reviewFile) {
                        const reviewText = await app.vault.read(reviewFile);
                        const issues: string[] = [];
                        for (const line of reviewText.split('\n')) {
                            const t = line.trim();
                            if (t.startsWith('❌') || t.startsWith('⚠️')) issues.push(t.slice(0, 200));
                        }
                        if (issues.length > 0) {
                            prevChaptersSummary += `\n【上章审查发现的问题】\n${issues.slice(0, 5).join('\n')}`;
                        }
                    }
                } catch (e) { log.warn('[小说工坊] 操作失败:', e); }
            }
        }

        if (showStepProgress) showProgress('📖 统一加载项目上下文...');
        const cm = plugin.ctxManager;
        const promptCtx = await cm.buildPromptSection(project);

        if (showStepProgress) showProgress('📖 读取伏笔库和时间线...');

        let unrevealedForeshadow = '';
        let unrevealedCount = 0;
        try {
            const fPath = pjForeshadowDB(project);
            const fFile = app.vault.getAbstractFileByPath(fPath);
            if (fFile instanceof TFile) {
                const fContent = await app.vault.read(fFile);
                // 统计全部未揭示伏笔数量（用于信息债判断）
                for (const line of fContent.split('\n')) {
                    if (!line.match(/^\|.*\|/)) continue;
                    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
                    if (cols.length === 0) continue;
                    if (cols[0] === '#' || cols[0].includes('---') || cols[0] === '伏笔') continue;
                    const status = cols.length >= 6 ? cols[5] : cols[1] || '';
                    if (status.includes('未揭示') || status === '') {
                        unrevealedCount++;
                    }
                }
                // 按章号过滤，只注入当前章相关的伏笔
                const filtered = filterForeshadowsByChapter(fContent, chapNum);
                unrevealedForeshadow = filtered.relevant;
                if (filtered.summary) {
                    unrevealedForeshadow += '\n' + filtered.summary;
                }
            }
        } catch (e) { log.warn('[小说工坊] 操作失败:', e); }

        let selectedToReveal: string[] = [];
        const allUnrevealed = unrevealedForeshadow.split('\n').filter(s => s.startsWith('- ')).map(s => s.replace(/^- /, '').trim());
        if (unrevealedCount > 20) {
            selectedToReveal = allUnrevealed.slice(0, 4);
            showWarning(`信息债严重（${unrevealedCount}个），本章必须揭示4个旧伏笔：${selectedToReveal.join('、')}`, 12000);
        } else if (unrevealedCount > 15) {
            selectedToReveal = allUnrevealed.slice(0, 3);
            showWarning(`信息债过高（${unrevealedCount}个），本章必须揭示3个旧伏笔：${selectedToReveal.join('、')}`, 10000);
        } else if (unrevealedCount > 10) {
            selectedToReveal = allUnrevealed.slice(0, 2);
            showWarning(`信息债偏高（${unrevealedCount}个），本章强制揭示2个旧伏笔：${selectedToReveal.join('、')}`, 8000);
        } else if (unrevealedCount > 5) {
            selectedToReveal = allUnrevealed.slice(0, 1);
            showWarning(`信息债中等（${unrevealedCount}个），本章建议揭示1个旧伏笔：${selectedToReveal.join('、')}`, 6000);
        }

        if (showStepProgress) showProgress('📖 读取大纲摘要和世界观...');

        let outlineContent = '';
        const outlineFile = findChapterFile(app.vault.getFiles(), chapDir, '大纲摘要');
        if (outlineFile) outlineContent = stripFrontmatter(await app.vault.read(outlineFile));

        let infoPlan = '';
        const infoFile = findChapterFile(app.vault.getFiles(), chapDir, '信息规划');
        if (infoFile) infoPlan = stripFrontmatter(await app.vault.read(infoFile));

        if (showStepProgress) showProgress('📖 读取人物状态...');

        // v4.0：正文文件位于 正文/第V卷/，与 chapDir（步骤结果）分离
        const bodyPath = pjBodyFile(project, volN, chapNum);
        let bodyFile: TFile | undefined;
        {
            const direct = app.vault.getAbstractFileByPath(bodyPath);
            if (direct instanceof TFile) bodyFile = direct;
            if (!bodyFile) {
                const bodyDir = pjBodyDir(project, volN);
                bodyFile = app.vault.getFiles().find(f =>
                    f.path.startsWith(bodyDir + '/') &&
                    f.name.startsWith(`第${chapNum}章`) &&
                    f.name.includes('正文') &&
                    f.name.endsWith('.md')
                );
            }
        }
        let involvedSet: Set<string> = new Set();
        if (plugin.settings.contextScope === 'compact' && bodyFile) {
            try {
                const { chars } = await getInvolvedEntities(app, bodyFile);
                if (chars.length > 0) involvedSet = new Set(chars);
            } catch (e) { log.warn('[小说工坊] 读取涉及人物失败:', e); }
        }

        let allChars = '';
        const charEntities: ScoredEntity[] = [];
        const charFieldKeys = CHARACTER_DISPLAY_KEYS as unknown as string[];
        for (const ch of promptCtx.rawCharacters) {
            const name = ch.name || ch.姓名 || '';
            if (!name) continue;

            // 非涉及实体且存在索引 → 一行状态摘要
            if (involvedSet.size > 0 && !involvedSet.has(name)) {
                const statusLine = getEntityStatusLine(`---\n${charFieldKeys.map(k => `${k}: ${ch[k] || '—'}`).join('\n')}\n---`, name);
                charEntities.push({ name, fields: {}, type: 'character', formatText: statusLine });
                continue;
            }

            // 涉及实体（或无索引兜底）→ 完整解析 14 字段
            const fields: Record<string, string> = {};
            for (const k of charFieldKeys) {
                const v = ch[k] || '—';
                if (v !== '—') fields[k] = v;
            }
            const formatText = `\n- ${name}：年龄=${ch['年龄'] || '—'}，身份=${ch['身份'] || '—'}，性格=${ch['性格标签'] || '—'}，动机=${ch['核心动机'] || '—'}，软肋=${ch['核心驱动力_软肋'] || '—'}，习惯=${ch['习惯性小动作'] || '—'}，状态=${ch['当前状态'] || '—'}，情绪=${ch['当前情绪'] || '—'}，能力=${ch['金手指/特殊能力'] || '—'}，功法=${ch['功法/技能树'] || '—'}，势力=${ch['所属势力'] || '—'}，背景=${ch['人物背景'] || '—'}，外貌=${ch['外貌特征'] || '—'}，目标=${ch['当前目标'] || '—'}`;
            charEntities.push({ name, fields, type: 'character', formatText });
        }

        const charContextText = (outlineContent || '') + '\n' + (prevChaptersSummary || '');
        const filteredChars = scoreAndFilterEntities(charEntities, charContextText);
        allChars = filteredChars.map(e => e.text).join('');

        if (showStepProgress) showProgress('📖 读取设定库和文笔风格...');

        let settingLib = promptCtx.settingLib;
        if (settingLib) {
            const isSlEmpty = !settingLib.trim() || (settingLib.includes('<!--') && !settingLib.replace(/<!--[\s\S]*?-->/g, '').trim());
            if (isSlEmpty && promptCtx.worldView) {
                const meta = extractWorldviewMeta(promptCtx.worldView);
                settingLib = meta.fallbackSettingLib.slice(0, 2000);
            } else {
                settingLib = settingLib.slice(0, 2000);
            }
        }

        let writingStyle = promptCtx.writingStyle.slice(0, 1500);

        if (!bodyFile) {
            hideProgress();
            showError('未找到正文文件');
            return;
        }

        hideProgress();

        showProgress(`⏳ 正在生成第${chapNum}章信息规划...`);

        let planResult = { content: infoPlan };
        if (!isInfoPlanComplete(infoPlan)) {
            const requiredReveal = chapPlan.match(/揭示[：:]\s*(.+?)(?=\n|$)/)?.[1] || '';
            const foreshadowReminder = requiredReveal ? `\n【分卷规划要求本章揭示】${requiredReveal}` : '';

            planResult = await aiEngine.generateChapterPlan({
                chapterNumber: chapNum,
                project,
                volume: volName,
                chapterPlan: chapPlan,
                outline: outlineContent,
                previousChapters: prevChaptersSummary,
                unrevealedForeshadow: unrevealedForeshadow,
                timelineEvents: promptCtx.timeline
            });

            if (planResult.content) {
                if (!app.vault.getAbstractFileByPath(chapDir)) {
                    try { await app.vault.createFolder(chapDir); } catch (e) { log.warn('[小说工坊] 创建步骤目录失败:', chapDir, e); }
                }
                const infoPath = `${chapDir}/${getChapterFileName(chapName, '信息规划')}`;
                const infoFm = buildStepFrontmatter({
                    tag: '信息规划',
                    volume: volName,
                    chapter: chapName,
                    model: plugin.settings.flashModel,
                });
                const infoContent = `${infoFm}

# 第${chapNum}章 信息规划

${planResult.content}
`;
                const infoFile2 = app.vault.getAbstractFileByPath(infoPath);
                if (infoFile2 instanceof TFile) await app.vault.modify(infoFile2, infoContent);
                else await app.vault.create(infoPath, infoContent);
            }
        } else {
            showSuccess('已有信息规划，跳过生成');
        }

        infoPlan = planResult.content ? stripFrontmatter(planResult.content) : infoPlan;
        if (!isOutlineComplete(outlineContent) && infoPlan.length > 50 && outlineFile) {
            showProgress(`⏳ 正在生成 ${chapName} 大纲摘要...`);
            const olResult = await aiEngine.callAI(
                '你是一个小说大纲规划师。',
                `根据本章信息规划，生成详细的大纲摘要，包含：全书定位、关键场景（3-5个）、需要呈现的信息、情感基调、结尾钩子。

【信息规划】
${infoPlan.slice(0, 800)}

输出 Markdown。`,
                undefined, 0.7, 4096
            );
            hideProgress();
            if (olResult.content) {
                try {
                    const outlineFm = buildStepFrontmatter({
                        tag: '大纲摘要',
                        volume: volName,
                        chapter: chapName,
                        model: plugin.settings.defaultModel,
                    });
                    await app.vault.modify(outlineFile, `${outlineFm}

# ${chapName} · 大纲摘要

> 核心冲突：（待定）

${olResult.content.trim()}
`);
                } catch (e) { log.warn('[小说工坊] 操作失败:', e); }
                outlineContent = stripFrontmatter(olResult.content);
            }
        }

        showProgress(`⏳ 正在撰写第${chapNum}章（衔接前文）...`);

        let forcedRevealHint = '';
        if (selectedToReveal.length > 0) {
            let revealContext = '';
            try {
                const ff = app.vault.getAbstractFileByPath(pjForeshadowDB(project));
                if (ff instanceof TFile) {
                    const fc = await app.vault.read(ff);
                    for (const name of selectedToReveal) {
                        for (const line of fc.split('\n')) {
                            if (!line.match(/^\|.*\|/)) continue;
                            const cols = line.split('|').map(s => s.trim()).filter(Boolean);
                            if (cols.length >= 6 && cols[1] === name) {
                                const buriedChap = cols[3];
                                if (buriedChap) {
                                    // v4.0：从当前卷步骤结果目录里寻找埋设章的「大纲摘要」
                                    const buriedChapN = parseInt(buriedChap.match(/\d+/)?.[0] ?? '0', 10);
                                    const buriedDir = buriedChapN > 0
                                        ? pjStepDir(project, volN, buriedChapN)
                                        : `${project}/${SUBDIR_STEP_ROOT}/${volName}/${buriedChap}`;
                                    const buriedOutline = findChapterFile(app.vault.getFiles(), buriedDir, '大纲摘要');
                                    if (buriedOutline) {
                                        const ctx = stripFrontmatter(await app.vault.read(buriedOutline)).slice(0, 300);
                                        if (ctx.length > 20) revealContext += `\n【${name}·埋设章节(${buriedChap})上下文】${ctx}`;
                                    }
                                }
                                break;
                            }
                        }
                    }
                }
            } catch (e) { log.warn('[小说工坊] 操作失败:', e); }
            const revealedNames = selectedToReveal.map(n => `- ${n}`).join('\n');
            forcedRevealHint = `【本章必须揭示的伏笔】以下伏笔必须在本章正文中通过剧情/对话揭示：\n${revealedNames}\n请在正文中明确交代这些伏笔的结果。${revealContext}`;
        }

        const context: ChapterContext = {
            chapterNumber: chapNum,
            project,
            volume: volName,
            chapterPlan: chapPlan,
            outline: outlineContent,
            infoPlan: infoPlan.slice(0, 2000),
            previousChapters: prevChaptersSummary,
            unrevealedForeshadow: unrevealedForeshadow,
            timelineEvents: promptCtx.timeline,
            worldView: promptCtx.worldView,
            settingLib: settingLib,
            writingStyle: writingStyle,
            characters: allChars,
            forcedReveal: selectedToReveal,
            unrevealedCount: unrevealedCount
        };

        const result = await aiEngine.generateChapterStream(
            context,
            (text, done) => {
                if (!done) {
                    showProgress(`⏳ 正在撰写第${chapNum}章（${text.length} 字）...`);
                }
            }
        );

        hideProgress();

        if (result.error) {
            showError(result.error);
            return;
        }

        const violations = WriteChapterModal.checkWritingRules(result.content, chapNum, plugin.settings.minWordCount);
        if (violations.length > 0) {
            showWarning(`${violations.slice(0, 3).join('；')}${violations.length > 3 ? `…等${violations.length}项` : ''}`);
        }

        let fmPart = (await app.vault.read(bodyFile)).match(/^---\n[\s\S]*?\n---\n/)?.[0] || '';
        let bodyText = result.content.replace(/^---\n[\s\S]*?\n---\n?/, '');

        bodyText = WriteChapterModal.fixQuotes(bodyText);

        bodyText = bodyText.split('\n').map(line => {
            const t = line.trim();
            if (!t || t.startsWith('#') || t.startsWith('```') || t.startsWith('|') || t.startsWith('- ') || t.startsWith('* ')) return line;
            if (!t.startsWith('  ')) return '  ' + line.trimStart();
            return line;
        }).join('\n');

        const titleMatch = result.content.match(/^#\s*第\d+章[\s：:]+(.+)/m);
        if (titleMatch) {
            const ct = titleMatch[1].trim();
            fmPart = fmPart.includes('标题:')
                ? fmPart.replace(/标题:.*/, `标题: ${ct}`)
                : fmPart.replace(/^---\n/, `---\n标题: ${ct}\n`);
            bodyText = bodyText.replace(/^#\s+第\d+章\s+.*/m, `# 第${chapNum}章 ${ct}`);
        }

        const merged = fmPart + bodyText;
        await app.vault.modify(bodyFile, merged);
        showSuccess(`第${chapNum}章正文已生成`);

        showProgress('⏳ 正在生成分析报告...');
        const reportResult = await aiEngine.generateAnalysisReport(bodyText);
        hideProgress();

        if (reportResult.content) {
            const reportPath = `${chapDir}/${getChapterFileName(chapName, '分析报告')}`;
            const reportFm = buildStepFrontmatter({
                tag: '分析报告',
                volume: volName,
                chapter: chapName,
                model: plugin.settings.flashModel,
            });
            const reportFull = `${reportFm}

# 第${chapNum}章 分析报告

${reportResult.content}
`;
            const existingReportFile = app.vault.getAbstractFileByPath(reportPath);
            if (existingReportFile) await app.vault.delete(existingReportFile);
            if (!app.vault.getAbstractFileByPath(chapDir)) await app.vault.createFolder(chapDir);
            await app.vault.create(reportPath, reportFull);
            showSuccess(`分析报告已生成：${getChapterFileName(chapName, '分析报告')}`);

            showProgress('⏳ 正在执行章节结算...');
            const settleResult = await WriteChapterModal.executeSettlement(plugin, project, chapDir, chapName, reportResult.content, bodyText, selectedToReveal);
            hideProgress();
            showSuccess(`结算：更新${settleResult.updated}项 / 新建${settleResult.created}项`, 8000);

            // v4.0: 结算表带 frontmatter（与 元文件/00-系统模板/结算表模板.md 对齐）
            const settleNow = new Date().toISOString();
            const settleFm = buildStepFrontmatter({
                tag: '结算表',
                volume: volName,
                chapter: chapName,
                model: plugin.settings.flashModel,
                timestamp: settleNow,
                extra: {
                    '结算时间': settleNow,
                    '结算状态': 'completed',
                },
            });
            const settleSummary = `${settleFm}# 第${chapName}章 结算表

## 更新状态
- 人物状态更新：${settleResult.updatedChars} 人
- 伏笔状态更新：${settleResult.updatedForeshadows} 个

## 新建元素
- 新建人物：${settleResult.createdChars} 个
- 新建地点：${settleResult.createdLocs} 个
- 新建势力：${settleResult.createdFactions} 个
- 新建物品功法：${settleResult.createdItems} 个
- 新建伏笔：${settleResult.createdForeshadows} 个
- 新建时间线事件：${settleResult.createdTimelines} 个
`;
            try {
                const sp = `${chapDir}/${getChapterFileName(chapName, '结算表')}`;
                const existingSettleFile = app.vault.getAbstractFileByPath(sp);
                if (existingSettleFile) await app.vault.delete(existingSettleFile);
                await app.vault.create(sp, settleSummary);
            } catch (e) { log.warn('结算表写入失败:', e); }

            try {
                let currentBody = await app.vault.read(bodyFile);
                let newFm = currentBody.match(/^---\n[\s\S]*?\n---\n/)?.[0] || '';
                if (newFm) {
                    newFm = newFm.includes('status:')
                        ? newFm.replace(/status:.*/, 'status: written')
                        : newFm.replace(/^---\n/, '---\nstatus: written\n');

                    const reportChars = reportResult.content;
                    const charLinks = reportChars.match(/\[\[(.*?)\]\]/g) || [];
                    const charNames = [...new Set(charLinks.map(l => l.replace(/[\[\]]/g, '').trim()))];
                    if (charNames.length > 0) {
                        const yamlList = charNames.map(n => `  - "[[${n}]]"`).join('\n');
                        if (newFm.includes('涉及人物:')) {
                            const listRegex = /涉及人物:\n(?:  .*\n?)*/;
                            newFm = newFm.replace(listRegex, `涉及人物:\n${yamlList}\n`);
                        } else {
                            newFm = newFm.replace(/^---\n/, `---\n涉及人物:\n${yamlList}\n`);
                        }
                    }

                    const locNames: string[] = [];
                    for (const line of reportResult.content.split('\n')) {
                        const m = line.match(/NEW_LOCATION:\s*(.*?)\s*\|/);
                        if (m) locNames.push(m[1].trim());
                    }
                    if (locNames.length > 0) {
                        const yamlList = locNames.map(n => `  - "[[${n}]]"`).join('\n');
                        if (newFm.includes('涉及地点:')) {
                            const listRegex = /涉及地点:\n(?:  .*\n?)*/;
                            newFm = newFm.replace(listRegex, `涉及地点:\n${yamlList}\n`);
                        } else {
                            newFm = newFm.replace(/^---\n/, `---\n涉及地点:\n${yamlList}\n`);
                        }
                    }

                    const facNames: string[] = [];
                    for (const line of reportResult.content.split('\n')) {
                        const m = line.match(/NEW_FACTION:\s*(.*?)\s*\|/);
                        if (m) facNames.push(m[1].trim());
                    }
                    if (facNames.length > 0) {
                        const yl = facNames.map(n => `  - "[[${n}]]"`).join('\n');
                        newFm = newFm.includes('涉及势力:') ? newFm.replace(/涉及势力:\n(?:  .*\n?)*/, `涉及势力:\n${yl}\n`) : newFm.replace(/^---\n/, `---\n涉及势力:\n${yl}\n`);
                    }

                    const itemNames: string[] = [];
                    for (const line of reportResult.content.split('\n')) {
                        const m = line.match(/NEW_ITEM:\s*(.*?)\s*\|\s*(.*)/);
                        if (m) itemNames.push(m[1].trim());
                    }
                    if (itemNames.length > 0) {
                        const yl = itemNames.map(n => `  - "[[${n}]]"`).join('\n');
                        newFm = newFm.includes('涉及物品功法:') ? newFm.replace(/涉及物品功法:\n(?:  .*\n?)*/, `涉及物品功法:\n${yl}\n`) : newFm.replace(/^---\n/, `---\n涉及物品功法:\n${yl}\n`);
                    }

                    const updatedBody = newFm + currentBody.replace(/^---\n[\s\S]*?\n---\n/, '');
                    await app.vault.modify(bodyFile, updatedBody);
                }
            } catch (e) { log.warn('frontmatter更新失败:', e); }

            if (titleMatch) {
                try {
                    const ct = titleMatch[1].trim().slice(0, 15);
                    const baseName = getChapterFileName(chapName, '正文');
                    const newName = baseName.replace(`_${CHAPTER_FILE_TYPES.body}.md`, `_${ct}_${CHAPTER_FILE_TYPES.body}.md`);
                    const oldPath = bodyFile.path;
                    const newPath = oldPath.replace(/\/[^/]+$/, '/' + newName);
                    if (oldPath !== newPath && !app.vault.getAbstractFileByPath(newPath)) {
                        await app.vault.adapter.rename(oldPath, newPath);
                    }
                } catch (e) { log.warn('正文文件重命名失败:', e); }
            }

            showProgress('⏳ 正在执行连贯性审查...');
            await reviewAgent.reviewChapter(project, bodyFile.path);
            hideProgress();

            // 审查→修正闭环：解析审查结果中的严重问题并自动修正
            const reviewFile = findChapterFile(app.vault.getFiles(), chapDir, '连贯性审查');
            if (reviewFile) {
                try {
                    const reviewContent = await app.vault.read(reviewFile);
                    const reviewIssues: string[] = [];
                    let hasSerious = false;
                    for (const line of reviewContent.split('\n')) {
                        const t = line.trim();
                        if (t.startsWith('❌')) {
                            reviewIssues.push(t.slice(0, 300));
                            if (t.includes('世界观冲突') || t.includes('角色错乱') || t.includes('设定违规')) {
                                hasSerious = true;
                            }
                        }
                    }

                    if (hasSerious && reviewIssues.length > 0 && bodyFile) {
                        showProgress('⏳ 发现严重审查问题，正在自动修正...');
                        const fixResult = await aiEngine.callAI(
                            FIX_PROMPTS.systemPrompt,
                            fillTemplate(FIX_PROMPTS.userPrompt, { issues: reviewIssues.join('\n'), bodyText: bodyText }),
                            plugin.settings.proModel,
                            0.7,
                            plugin.settings.maxOutput
                        );
                        hideProgress();

                        if (fixResult.content) {
                            let fixedBody = fixResult.content.replace(/^---[\s\S]*?\n---\n?/, '');
                            fixedBody = fixedBody.split('\n').map(line => {
                                const t = line.trim();
                                if (!t || t.startsWith('#') || t.startsWith('```') || t.startsWith('|') || t.startsWith('- ') || t.startsWith('* ')) return line;
                                if (!t.startsWith('  ')) return '  ' + line.trimStart();
                                return line;
                            }).join('\n');

                            const merged = fmPart + fixedBody;
                            await app.vault.modify(bodyFile, merged);
                            showSuccess('审查问题已自动修正');
                        }
                    }
                } catch (e) { log.warn('[小说工坊] 审查修正失败:', e); }
            }
        }
    }

    private async writeChapter(project: string, volName: string, chapName: string, chapNum: number, chapDir: string, showStepProgress: boolean): Promise<void> {
        await WriteChapterModal.doWriteChapter(
            this.app, this.plugin, this.aiEngine, this.reviewAgent,
            project, volName, chapName, chapNum, chapDir, showStepProgress
        );
        this.close();
    }

    private static checkWritingRules(content: string, chapterNum: number, minWordCount: number): string[] {
        const violations: string[] = [];
        const wordCount = content.replace(/\s/g, '').length;
        if (wordCount < minWordCount) {
            violations.push(`字数不足（${wordCount}字，要求≥${minWordCount}字）`);
        }
        const dashCount = (content.match(/——/g) || []).length;
        if (dashCount > 3) {
            violations.push(`破折号过多（${dashCount}个，要求≤3个）`);
        }
        const semicolonCount = (content.match(/；/g) || []).length;
        if (semicolonCount > 0) {
            violations.push(`使用了分号（${semicolonCount}个，禁止使用）`);
        }
        const ellipsisCount = (content.match(/……/g) || []).length;
        if (ellipsisCount > 0) {
            violations.push(`使用了省略号（${ellipsisCount}个，禁止使用）`);
        }
        const exclamationCount = (content.match(/！/g) || []).length;
        if (exclamationCount > 3) {
            violations.push(`感叹号过多（${exclamationCount}个，要求≤3个）`);
        }
        return violations;
    }

    private static fixQuotes(text: string): string {
        return text.replace(/(["'])([^"']{2,})\1/g, (_, q, c) => `"${c}"`);
    }


    private static async executeSettlement(plugin: NovelWriterPlugin, project: string, chapDir: string, chapName: string, report: string, bodyText: string, forceReveal: string[] = []): Promise<SettlementResult> {
        const engine = plugin.engineRegistry.get<SettlementEngine>(ENGINE_NAMES.SETTLEMENT_ENGINE);
        return engine.settle(project, chapDir, chapName, report, bodyText,
            { forceReveal: forceReveal.length > 0 ? forceReveal : undefined }
        );
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
