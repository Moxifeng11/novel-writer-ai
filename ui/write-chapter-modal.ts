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
import { App, Modal, TFile } from 'obsidian';
import { isChapterSettledText } from '@/shared/chapter-status';
import { buildSettlementTable } from '@/engine/settlement/settlement-artifacts';
import { settlementArtifactNotice, writeSettlementArtifacts } from '@/engine/settlement/settlement-coordinator';
import { writeChapterStateSnapshot } from '@/engine/chapter-state-snapshot-service';
import { pjNarrativeOverview } from '@/shared/paths';
import { writeVaultText } from '@/shared/file-system-port';
import { splitTableCells } from '@/shared/chapter-table';
import NovelWriterPlugin from '@/main';
import { AIEngine, ChapterContext } from '@/engine/ai-engine';
import { ContextManager } from '@/engine/context-manager';
import { ForeshadowManager } from '@/engine/foreshadow-manager';
import { ReviewAgent } from '@/engine/review-agent';
import { scoreAndFilterEntities, ScoredEntity } from '@/engine/entity-scorer';
import { stripFrontmatter, showProgress, hideProgress, showSuccess, showError, showWarning } from '@/utils/helpers';
import { extractWorldviewMeta } from './utils/worldview-utils';
import { showWarningNotice } from './components/notice-helpers';
import { getChapterFileName, findChapterFile, CHAPTER_FILE_TYPES } from '@/engine/chapter-utils';
import { ActiveChapterTarget } from '@/shared/chapter-target';
import { isInfoPlanComplete, isOutlineComplete } from '@/shared/info-debt';
import { filterForeshadowsByChapter, getInvolvedEntities, getEntityStatusLine } from '@/engine/chapter-context-builder';
import { FIX_PROMPTS, fillTemplate } from '@/engine/prompt-templates';
import { SettlementEngine, SettlementResult } from '@/engine/settlement-engine';
import { ENGINE_NAMES } from '@/shared/engine-names';
import { pjBodyDir, pjBodyFile, pjForeshadowDB, pjStepDir, pjVolumeOutlineFile, SUBDIR_STEP_ROOT } from '@/shared/paths';
import { resolveBodyFilePath } from '@/engine/chapter-utils';
import { CHARACTER_DISPLAY_KEYS } from '@/shared/format-constants';
import { buildStepFrontmatter } from '@/shared/step-frontmatter';
import { BodyWriter } from '@/engine/body-writer';
import { createLogger } from '@/shared/logger';
import { getExecutionLedger, summarizeSettlement } from '@/services/execution-ledger';


const log = createLogger('WriteChapterModal');
/**
 * 写入章节弹窗。
 */
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

    /**
     * onOpen 方法。
     */
    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        // ═══ v3.4.8: 两层CSS规则 — 见 docs/CSS变量注入与两层规则_全插件避坑指南.md ═══
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal-form');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.empty();
        contentEl.addClass('nw-form-stack');

        contentEl.createEl('h2', {
            text: '✍️ AI写正文〔旧〕',
            attr: { style: 'margin:0; font-size:18px;' },
        });

        // Rev 184：上下文统一走「工作台上下文 > activeFile 正文 > activeFile 步骤目录」
        const target: ActiveChapterTarget | null = this.plugin.getActiveChapterTarget();
        if (!target) {
            contentEl.createEl('p', {
                text: '❌ 未定位到章节。请在「项目与章节」工作台选中章节，或打开本章正文 / 步骤结果文件后重试。',
                attr: { style: 'color:var(--text-error); margin:0; line-height:1.6;' },
            });
            return;
        }

        const summary = contentEl.createDiv({ cls: 'nw-form-summary' });
        summary.createDiv({ text: `项目：${target.project}` });
        summary.createDiv({ text: `章节：${target.volume} · ${target.chapterName}` });

        contentEl.createEl('p', {
            text: '将依次执行：信息规划 → 大纲摘要 → 正文（流式续写）→ 分析报告 → 结算表 → 连贯性审查。已有且完整的步骤会自动跳过。',
            attr: { style: 'color:var(--text-muted); font-size:12px; line-height:1.6; margin:0;' },
        });

        const actions = contentEl.createDiv({ cls: 'nw-form-actions' });
        const cancelBtn = actions.createEl('button', { text: '取消', cls: 'nw-btn' });
        cancelBtn.onclick = () => this.close();
        const startBtn = actions.createEl('button', { text: '开始生成整章', cls: 'nw-btn nw-btn-primary' });
        startBtn.onclick = async () => {
            startBtn.disabled = true;
            startBtn.setText('生成中…');
            const volN = parseInt(target.volume.match(/第(\d+)卷/)?.[1] || '0', 10) || 1;
            await WriteChapterModal.doWriteChapter(
                this.app, this.plugin, this.aiEngine, this.reviewAgent,
                target.project, target.volume, target.chapterName, target.chapterNum,
                pjStepDir(target.project, volN, target.chapterNum), true
            );
            this.close();
        };
    }

    /**
     * runBackground 方法。
     * @param app - Obsidian 应用实例
     * @param plugin - 插件实例
     */
    static async runBackground(app: App, plugin: NovelWriterPlugin): Promise<void> {
        const target = plugin.getActiveChapterTarget();
        if (!target) {
            showError('未定位到章节：请在「项目与章节」选中章节，或打开本章正文 / 步骤结果文件');
            return;
        }

        const volN = parseInt(target.volume.match(/第(\d+)卷/)?.[1] || '0', 10) || 1;
        const aiEngine = plugin.aiEngine;
        const reviewAgent = plugin.reviewAgent;

        // 后台整章由命令层 fire-and-forget 触发，异常若不上报就会「跑满 15 分钟毫无反应」
        // （实测：模型返回空内容时正是如此）。这里兜住并把失败写进执行登记表 + 提示。
        const ledger = getExecutionLedger();
        const runId = ledger.begin({
            commandId: 'novel-writer-write-chapter',
            project: target.project,
            source: 'agent',
            label: `${target.chapterName} 后台整章`,
        });
        try {
            await WriteChapterModal.doWriteChapter(
                app, plugin, aiEngine, reviewAgent,
                target.project, target.volume, target.chapterName, target.chapterNum,
                pjStepDir(target.project, volN, target.chapterNum), false
            );
            // 成功时由 doWriteChapter 内部登记「已生成正文并完成结算」；
            // 这里只在没有结算记录时补一条完成态，避免重复。
            const already = ledger.getRecent(5).some(record =>
                record.commandId === 'novel-writer-write-chapter' && record.status === 'done');
            if (!already) {
                ledger.finish(runId, { status: 'done', detail: `${target.chapterName} 后台整章完成` });
            } else {
                ledger.finish(runId, { status: 'done', detail: `${target.chapterName} 后台整章完成（结算已单独登记）` });
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            log.error('[写章] 后台整章失败:', e);
            ledger.finish(runId, { status: 'failed', failure: message });
            showError(`后台整章失败：${message.slice(0, 120)}`);
        }
    }

    /**
     * 统一的整章生成流水线。Rev 184 起被三个旧版章节生成工具共用，
     * 保证 prompt 装配（buildChapterPrompts）、正文落盘（BodyWriter）与步骤产物完全一致。
     * @param opts.signal 中止信号：批量入口关闭弹窗时传入，已落盘章节保留
     * @param app - Obsidian 应用实例
     * @param plugin - 插件实例
     * @param aiEngine - AI 引擎
     * @param reviewAgent - 审校 Agent
     * @param project - 项目（路径或对象）
     * @param volName - 卷名称
     * @param chapName - 章节名
     * @param chapNum - 章号
     * @param chapDir - 章节目录
     * @param showStepProgress - 是否显示步骤进度
     */
    public static async doWriteChapter(
        app: App, plugin: NovelWriterPlugin, aiEngine: AIEngine, reviewAgent: ReviewAgent,
        project: string, volName: string, chapName: string, chapNum: number, chapDir: string,
        showStepProgress: boolean,
        opts?: { signal?: AbortSignal }
    ): Promise<void> {
        const aborted = () => opts?.signal?.aborted === true;
        if (aborted()) return;
        if (!plugin.hasAiCredentials) {
            showError('请先配置 API 密钥或本地模型端点');
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
        // G6-9：一次快照 + 只取最近 N 章。旧实现每章调用 3-4 次 getFiles()，
        // 写第 200 章时约 800 次全库数组重建 + 数百次串行读盘。
        const allFiles = app.vault.getFiles();
        const PREV_SUMMARY_WINDOW = 40;
        const summaryStart = Math.max(1, chapNum - PREV_SUMMARY_WINDOW);
        for (let n = summaryStart; n < chapNum; n++) {
            // v4.0：步骤结果按 步骤结果/第V卷/第N章/ 归档；正文则在 正文/第V卷/ 下
            const prevDir = pjStepDir(project, volN, n);
            const prevOutline = findChapterFile(allFiles, prevDir, '大纲摘要');
            if (prevOutline) {
                const c = stripFrontmatter(await app.vault.read(prevOutline));
                if (c.length > 50) prevChaptersSummary += `\n【第${n}章摘要】${c.slice(0, 300)}`;
            }
            if (prevChaptersSummary.length > 12000) {
                log.info('[WriteChapter] 前文摘要达到 12000 字预算，停止收集更早章节');
                break;
            }
            if (n === chapNum - 1) {
                // v4.0：上一章正文文件位于 正文/第V卷/ 而非步骤结果目录
                const prevBodyPath = resolveBodyFilePath(app, project, volN, n);
                let prevBody: TFile | undefined;
                const pbf = app.vault.getAbstractFileByPath(prevBodyPath);
                if (pbf instanceof TFile) prevBody = pbf;
                if (!prevBody) {
                    // 兜底：在卷正文目录里寻找 "第n章...正文.md" 形态
                    const bodyDir = pjBodyDir(project, volN);
                    prevBody = allFiles.find(f =>
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
                    const reportFile = findChapterFile(allFiles, prevDir, '分析报告');
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
                    const reviewFile = findChapterFile(allFiles, prevDir, '连贯性审查');
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
                    const cols = splitTableCells(line);
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
        const outlineFile = findChapterFile(allFiles, chapDir, '大纲摘要');
        if (outlineFile) outlineContent = stripFrontmatter(await app.vault.read(outlineFile));

        let infoPlan = '';
        const infoFile = findChapterFile(allFiles, chapDir, '信息规划');
        if (infoFile) infoPlan = stripFrontmatter(await app.vault.read(infoFile));

        // Rev 186：关联索引（时间线/伏笔 ↔ 设定库/全书规划）。有值时替代平铺注入，避免重复占用预算。
        let storyLinkageText = '';
        try {
            const linkage = await cm.buildStoryLinkage(project, `第${chapNum}章`);
            storyLinkageText = linkage?.promptText ?? '';
        } catch (e) { log.warn('[小说工坊] 关联索引生成失败:', e); }

        if (showStepProgress) showProgress('📖 读取人物状态...');

        // v4.0：正文文件位于 正文/第V卷/，与 chapDir（步骤结果）分离
        const bodyPath = pjBodyFile(project, volN, chapNum);
        let bodyFile: TFile | undefined;
        {
            const direct = app.vault.getAbstractFileByPath(bodyPath);
            if (direct instanceof TFile) bodyFile = direct;
            if (!bodyFile) {
                const bodyDir = pjBodyDir(project, volN);
                bodyFile = allFiles.find(f =>
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
            showError(`未找到 ${chapName}_正文.md：请先用「批量建章」创建章节骨架`);
            return;
        }

        hideProgress();

        if (aborted()) return;
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
        if (aborted()) return;
        if (!isOutlineComplete(outlineContent) && infoPlan.length > 50 && outlineFile) {
            showProgress(`⏳ 正在生成 ${chapName} 大纲摘要...`);
            const olResult = await aiEngine.callAI(
                '你是一个小说大纲规划师。',
                `根据本章信息规划，生成详细的大纲摘要，包含：全书定位、关键场景（3-5个）、需要呈现的信息、情感基调、结尾钩子。

【信息规划】
${infoPlan.slice(0, 800)}

输出 Markdown。`,
                undefined, 0.7, plugin.settings.maxOutput
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

        if (aborted()) return;
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
                            const cols = splitTableCells(line);
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
            unrevealedCount: unrevealedCount,
            storyLinkage: storyLinkageText
        };

        const result = await aiEngine.generateChapterStream(
            context,
            (text, done) => {
                if (!done) {
                    showProgress(`⏳ 正在撰写第${chapNum}章（${text.length} 字）...`);
                }
            },
            opts?.signal
        );

        hideProgress();

        // 被取消时丢弃本次结果，不落盘
        if (aborted()) return;

        if (result.error) {
            showError(result.error);
            return;
        }

        const violations = WriteChapterModal.checkWritingRules(result.content, chapNum, plugin.settings.minWordCount);
        if (violations.length > 0) {
            showWarning(`${violations.slice(0, 3).join('；')}${violations.length > 3 ? `…等${violations.length}项` : ''}`);
        }

        // 统一落盘入口：保留旧 frontmatter、统一标题与缩进、状态不降级
        const writer = new BodyWriter({ app });
        const writeResult = await writer.write({
            path: bodyFile.path,
            raw: WriteChapterModal.fixQuotes(result.content),
            chapterNum: chapNum,
            chapterName: chapName,
            volume: volName,
            project,
            writingMode: 'pipeline',
            naturalize: plugin.settings.naturalParagraphMode !== false,
        });
        let bodyText = writeResult.body;
        showSuccess(`第${chapNum}章正文已生成`);

        if (aborted()) return;
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

            if (aborted()) return;
            // 幂等守卫：本章已 settled 就不重复回写（一键成文可能已经结算过这一章）
            if (await WriteChapterModal.isBodySettledOnDisk(app, { project, volume: volName, chapterName: chapName })) {
                log.info('[写章] 本章正文已是 settled，跳过重复结算:', chapName);
                hideProgress();
                showSuccess('本章已结算过，跳过重复回写');
                return;
            }
            showProgress('⏳ 正在执行章节结算...');
            const settleResult = await WriteChapterModal.executeSettlement(plugin, project, chapDir, chapName, reportResult.content, bodyText, selectedToReveal);
            hideProgress();
            showSuccess(`结算：更新${settleResult.updated}项 / 新建${settleResult.created}项`, 8000);
            // 执行登记表：Agent 事后可通过 get_execution_status 读取本次成文+结算结果
            getExecutionLedger().recordCompleted({
                commandId: 'novel-writer-write-chapter',
                project,
                source: 'ui',
                label: `${chapName} 一键成文`,
                detail: '已生成正文并完成结算',
                settlement: summarizeSettlement(settleResult),
            });


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

            if (writeResult.title) {
                try {
                    const baseName = getChapterFileName(chapName, '正文');
                    const newName = baseName.replace(`_${CHAPTER_FILE_TYPES.body}.md`, `_${writeResult.title.slice(0, 15)}_${CHAPTER_FILE_TYPES.body}.md`);
                    const oldPath = bodyFile.path;
                    const newPath = oldPath.replace(/\/[^/]+$/, '/' + newName);
                    if (oldPath !== newPath && !app.vault.getAbstractFileByPath(newPath)) {
                        await app.vault.adapter.rename(oldPath, newPath);
                    }
                } catch (e) { log.warn('正文文件重命名失败:', e); }
            }

            // v4.0: 结算表统一由 settlement-artifacts 生成（与章节结算弹窗同模板）
            const settleSummary = buildSettlementTable({
                chapterName: chapName,
                volume: volName,
                result: settleResult,
                timestamp: new Date().toISOString(),
                model: plugin.settings.flashModel,
            });
            const artifactReport = await writeSettlementArtifacts({
                chapterName: chapName,
                volume: volName,
                mode: 'full',
                result: settleResult,
                tableText: settleSummary,
            }, {
                writeSettlementTable: async text => {
                    const sp = `${chapDir}/${getChapterFileName(chapName, '结算表')}`;
                    const existingSettleFile = app.vault.getAbstractFileByPath(sp);
                    if (existingSettleFile) await app.vault.delete(existingSettleFile);
                    await app.vault.create(sp, text);
                },
                writeSnapshot: async () => {
                    // 正文 frontmatter 已在上方更新；快照读取最终正文，避免 status 仍是旧值
                    const finalBody = await app.vault.read(bodyFile);
                    const scenePath = `${chapDir}/${getChapterFileName(chapName, CHAPTER_FILE_TYPES.sceneExpand)}`;
                    const sceneFile = app.vault.getAbstractFileByPath(scenePath);
                    const sceneExpansion = sceneFile instanceof TFile ? await app.vault.read(sceneFile) : '';
                    await writeChapterStateSnapshot(app, {
                        project,
                        chapterNum: parseInt(chapName.match(/第(\d+)章/)?.[1] || '0', 10),
                        chapterName: chapName,
                        bodyText: finalBody,
                        sceneExpansion,
                        updatedChars: settleResult.chars,
                    });
                },
                refreshNarrativeOverview: async () => {
                    const engine = plugin.engineRegistry.get(ENGINE_NAMES.SETTLEMENT_ENGINE);
                    const overview = await engine.generateNarrativeOverview(project);
                    if (overview.trim()) {
                        await writeVaultText(app, pjNarrativeOverview(project), overview);
                    }
                },
            });
            const artifactWarning = settlementArtifactNotice(artifactReport);
            // settlementArtifactNotice 文案自带「⚠️ 」前缀，助手标题行会再渲染一次，这里去掉避免重复
            if (artifactWarning) showWarningNotice(artifactWarning.replace(/^⚠️\s*/u, ''), { timeout: 8000 });
            if (aborted()) return;
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
                            const fixWrite = await writer.write({
                                path: bodyFile.path,
                                raw: fixResult.content,
                                chapterNum: chapNum,
                                chapterName: chapName,
                                volume: volName,
                                project,
                                writingMode: 'pipeline',
                                naturalize: plugin.settings.naturalParagraphMode !== false,
                            });
                            bodyText = fixWrite.body;
                            showSuccess('审查问题已自动修正');
                        }
                    }
                } catch (e) { log.warn('[小说工坊] 审查修正失败:', e); }
            }
        }
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
        const engine = plugin.engineRegistry.get(ENGINE_NAMES.SETTLEMENT_ENGINE);
        return engine.settle(project, chapDir, chapName, report, bodyText,
            { forceReveal: forceReveal.length > 0 ? forceReveal : undefined }
        );
    }

    /**
     * 正文磁盘上是否已 settled（幂等守卫用）。
     * 一键成文（StepRunner）与后台整章会先后跑到同一章；旧实现各自无条件 settle，
     * 实测同一章被结算两次（实体更新重复、status 在 settled/written 之间来回翻）。
     */
    private static async isBodySettledOnDisk(app: App, chapterTarget: { project: string; volume: string; chapterName: string }): Promise<boolean> {
        try {
            const volN = parseInt(chapterTarget.volume.match(/第(\d+)卷/)?.[1] || '0', 10) || 1;
            const bodyPath = resolveBodyFilePath(app, chapterTarget.project, volN, parseInt(chapterTarget.chapterName.match(/第(\d+)章/)?.[1] || '0', 10));
            const file = app.vault.getAbstractFileByPath(bodyPath);
            if (!(file instanceof TFile)) return false;
            const raw = await app.vault.read(file);
            return isChapterSettledText(raw);
        } catch {
            return false;
        }
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
