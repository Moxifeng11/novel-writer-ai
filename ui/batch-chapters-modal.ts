/**
 * @deprecated Legacy 批量写正文 Modal（命令 ID: novel-writer-batch-chapters, 显示名带"〔旧〕"）。
 *
 * 当前推荐入口：完整写作工作台（FullWriterView）+ 续写规划（ContinueChaptersModal）。
 *
 * 计划：在下个大版本（v5.x）评估完全移除。维护原则：仅修 Bug，不再加新特性。
 */
import { App, Modal, Notice, TFile, TFolder } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine } from '../engine/ai-engine';
import { ContextManager } from '../engine/context-manager';
import { mkdirp, showSuccess, showError, showWarning, stripFrontmatter } from '../utils/helpers';
import { getChapterFileName, findChapterFile, normalizeChapterFiles, getChapterFile, CHAPTER_FILE_TYPES } from '../engine/chapter-utils';
import { SettlementEngine, SettlementResult } from '../engine/settlement-engine';
import { scoreAndFilterEntities } from '../engine/entity-scorer';
import { isOutlineComplete } from '../shared/info-debt';
import { getInvolvedEntities, getEntityStatusLine } from '../engine/chapter-context-builder';
import { extractWorldviewMeta } from './utils/worldview-utils';
import { pjBodyDir, pjBodyFile, pjStepDir, pjControlDir, pjForeshadowDB, pjInfoDebtBoard, pjCharsDir, SUBDIR_WORLD_ARCH, SUBDIR_BODY_ROOT, SUBDIR_STEP_ROOT, WRITING_RULES_PATH_PROJECT, WRITING_RULES_PATH_TEMPLATE } from '../shared/paths';

export class BatchChaptersModal extends Modal {
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;
    private contextManager: ContextManager;
    private settlementEngine: SettlementEngine;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.aiEngine = plugin.aiEngine;
        this.contextManager = plugin.ctxManager;
        this.settlementEngine = new SettlementEngine(app);
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
        contentEl.createEl('h2', { text: '📝 批量写正文' });

        const projectSelect = contentEl.createEl('select', { cls: 'nw-select novel-writer-select' });
        const volSelect = contentEl.createEl('select', { cls: 'nw-select novel-writer-select' });
        const startInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: '起始章号',
            cls: 'nw-input novel-writer-input'
        });
        const endInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: '结束章号',
            cls: 'nw-input novel-writer-input'
        });

        const populateProjects = async () => {
            const projects = await this.contextManager.detectProjects();
            if (projects.length === 0) {
                contentEl.createEl('p', { text: '❌ 未找到项目，请先创建新项目' });
                return;
            }

            projects.forEach(project => {
                projectSelect.createEl('option', { value: project, text: project });
            });

            await this.populateVolumes(projectSelect.value, volSelect);
            await this.populateChapterRange(projectSelect.value, volSelect.value, startInput, endInput);

            projectSelect.onchange = async () => {
                await this.populateVolumes(projectSelect.value, volSelect);
                await this.populateChapterRange(projectSelect.value, volSelect.value, startInput, endInput);
            };

            volSelect.onchange = async () => {
                await this.populateChapterRange(projectSelect.value, volSelect.value, startInput, endInput);
            };

            const generateButton = contentEl.createEl('button', { text: '开始批量写作', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
            generateButton.onclick = async () => {
                const project = projectSelect.value;
                const volume = volSelect.value;
                const startNum = parseInt(startInput.value);
                const endNum = parseInt(endInput.value);

                if (!startNum || !endNum || startNum > endNum) {
                    showError('请输入有效的起止章号');
                    return;
                }

                await this.batchWrite(project, volume, startNum, endNum);
            };
        };

        populateProjects();
    }

    private async populateVolumes(project: string, selectEl: HTMLSelectElement): Promise<void> {
        selectEl.innerHTML = '';
        const volDirs: string[] = [];
        for (const f of this.app.vault.getFiles()) {
            const m = f.path.match(new RegExp(`${project}/(?:${SUBDIR_BODY_ROOT}|${SUBDIR_STEP_ROOT})/(第\\d+卷)/`));
            if (m && !volDirs.includes(m[1])) volDirs.push(m[1]);
        }
        volDirs.sort((a, b) => {
            const numA = parseInt(a.match(/\d+/)?.[0] || '0');
            const numB = parseInt(b.match(/\d+/)?.[0] || '0');
            return numA - numB;
        });
        if (volDirs.length === 0) {
            selectEl.createEl('option', { value: '', text: '未找到卷目录' });
        } else {
            volDirs.forEach(vol => {
                selectEl.createEl('option', { value: vol, text: vol });
            });
        }
    }

    private async populateChapterRange(project: string, volume: string, startInput: HTMLInputElement, endInput: HTMLInputElement): Promise<void> {
        const existChaps = new Set<number>();
        const volMatchN = volume.match(/第(\d+)卷/);
        const volN = volMatchN ? parseInt(volMatchN[1], 10) : 0;
        if (volN > 0) {
            const bodyPrefix = `${pjBodyDir(project, volN)}/`;
            for (const f of this.app.vault.getFiles()) {
                if (!f.path.startsWith(bodyPrefix)) continue;
                const m = f.name.match(/^第(\d+)章.*正文\.md$/);
                if (m) existChaps.add(parseInt(m[1], 10));
            }
        }
        const chapNums = Array.from(existChaps).sort((a, b) => a - b);
        if (chapNums.length > 0) {
            startInput.value = String(chapNums[0]);
            endInput.value = String(chapNums[chapNums.length - 1]);
        } else {
            startInput.value = '';
            endInput.value = '';
        }
    }

    private async batchWrite(project: string, volume: string, startNum: number, endNum: number): Promise<void> {
        if (!this.plugin.settings.apiKey) {
            showError('请先配置API密钥');
            return;
        }

        const existChaps = new Set<number>();
        const volMatchNAll = volume.match(/第(\d+)卷/);
        const volNAll = volMatchNAll ? parseInt(volMatchNAll[1], 10) : 0;
        if (volNAll > 0) {
            const bodyPrefix2 = `${pjBodyDir(project, volNAll)}/`;
            for (const f of this.app.vault.getFiles()) {
                if (!f.path.startsWith(bodyPrefix2)) continue;
                const m = f.name.match(/^第(\d+)章.*正文\.md$/);
                if (m) existChaps.add(parseInt(m[1], 10));
            }
        }
        const chapNums = Array.from(existChaps).sort((a, b) => a - b);
        const targetNums = chapNums.filter(n => n >= startNum && n <= endNum);
        const total = targetNums.length;

        if (total === 0) {
            showError('未找到目标章节');
            return;
        }

        const unrevealedCount = await this.getUnrevealedForeshadowCount(project);
        const allUnrevealedNames = await this.getUnrevealedForeshadowNames(project);
        const needPerChapter = unrevealedCount > 10 ? 2 : unrevealedCount > 5 ? 1 : 0;
        const totalNeed = total * needPerChapter;
        let remainingToReveal = needPerChapter > 0
            ? allUnrevealedNames.slice(0, Math.min(totalNeed, allUnrevealedNames.length))
            : [];

        if (remainingToReveal.length > 0) {
            new Notice(`🔴 信息债 ${unrevealedCount} 个，本批 ${total} 章 × ${needPerChapter}/章，滚动揭示 ${remainingToReveal.length}/${allUnrevealedNames.length} 个伏笔`, 8000);
        }

        let worldView = '';
        let settingLib = '';
        let writingStyle = '';
        let timelineEvents = '';

        const cm = this.plugin.ctxManager;
        const promptCtx = await cm.buildPromptSection(project);
        worldView = promptCtx.worldView;
        timelineEvents = promptCtx.timeline;
        settingLib = promptCtx.settingLib;
        if (settingLib) {
            const isSlEmpty = !settingLib.trim() || (settingLib.includes('<!--') && !settingLib.replace(/<!--[\s\S]*?-->/g, '').trim());
            if (isSlEmpty && worldView) {
                const meta = extractWorldviewMeta(worldView);
                settingLib = meta.fallbackSettingLib.slice(0, 2000);
            } else {
                settingLib = settingLib.slice(0, 2000);
            }
        }
        writingStyle = promptCtx.writingStyle;

        let mainNotice = new Notice(`⏳ 批量写正文: 0/${total}`, 0);
        let done = 0;

        for (let idx = 0; idx < targetNums.length; idx++) {
            const n = targetNums[idx];
            const chapName = `第${n}章`;
            // v4.0: basePath 改为步骤结果目录；正文写入 pjBodyFile
            const volMatchInner = volume.match(/第(\d+)卷/);
            const volNInner = volMatchInner ? parseInt(volMatchInner[1], 10) : 0;
            const basePath = volNInner > 0
                ? pjStepDir(project, volNInner, n)
                : `${project}/${SUBDIR_STEP_ROOT}/${volume}/${chapName}`;
            const bodyDir = volNInner > 0
                ? pjBodyDir(project, volNInner)
                : `${project}/${SUBDIR_BODY_ROOT}/${volume}`;
            const bodyPath = volNInner > 0
                ? pjBodyFile(project, volNInner, n)
                : `${bodyDir}/${chapName}_正文.md`;

            mainNotice.hide();
            mainNotice = new Notice(`⏳ 批量写作: ${chapName}（${done}/${total}）`, 0);

            // 【规范化】将旧格式文件统一迁移为标准格式
            // v4.0: 步骤结果目录可能尚未创建，normalize 仅处理已存在的目录
            const chapFolder = this.app.vault.getAbstractFileByPath(basePath);
            if (chapFolder instanceof TFolder) {
                await normalizeChapterFiles(this.app, chapFolder, chapName);
            }

            let infoPlan = '';
            const infoFile = findChapterFile(this.app.vault.getFiles(), basePath, '信息规划');
            if (infoFile) infoPlan = stripFrontmatter(await this.app.vault.read(infoFile));

            let outline = '';
            const outlineFile = findChapterFile(this.app.vault.getFiles(), basePath, '大纲摘要');
            if (outlineFile) outline = stripFrontmatter(await this.app.vault.read(outlineFile));

            if (!isOutlineComplete(outline) && infoPlan.length > 50) {
                const olNotice = new Notice(`⏳ 正在生成 ${chapName} 大纲摘要...`, 0);
                const olPrompt = `你是一个小说章节规划师。根据本章信息规划，生成详细的大纲摘要。

【本章信息规划】
${infoPlan.slice(0, 800)}

生成大纲摘要，包含：
1. 本章在全书的定位
2. 关键场景（按顺序，3-5个）
3. 需要呈现的信息
4. 情感基调
5. 结尾钩子

输出 Markdown，不要解释。`;
                const olResult = await this.aiEngine.callAI('你是一个小说大纲规划师。', olPrompt);
                olNotice.hide();
                if (olResult.content) {
                    const fullOutline = `---
tags: [大纲摘要]
卷: ${volume}
章: ${chapName}
---

# ${chapName} · 大纲摘要

> 核心冲突：（待定）

${olResult.content.trim()}
`;
                    try { if (outlineFile) await this.app.vault.modify(outlineFile, fullOutline); } catch (e) { console.warn('[小说工坊] 操作失败:', e); }
                    outline = stripFrontmatter(olResult.content);
                }
            }

            // 尝试读取当前章节正文的 frontmatter 涉及人物列表（仅 compact 模式）
            // 使用模糊匹配查找正文文件（兼容带标题的文件名如 第1章_棋手落子_正文.md）
            // v4.0: 正文已迁移至 pjBodyDir
            const bodyFile = findChapterFile(this.app.vault.getFiles(), bodyDir, '正文', this.app);
            let involvedSet: Set<string> = new Set();
            if (this.plugin.settings.contextScope === 'compact') {
                const { chars } = await getInvolvedEntities(this.app, bodyFile instanceof TFile ? bodyFile : null);
                involvedSet = new Set(chars);
            }

            interface CharEntry { name: string; data: string; }
            const allCharsRaw: CharEntry[] = [];
            for (const ch of promptCtx.rawCharacters) {
                const name = ch.name || ch.姓名 || '';
                if (!name) continue;
                if (involvedSet.size > 0 && !involvedSet.has(name)) {
                    // 非涉及实体 → 精简状态摘要
                    const statusLine = getEntityStatusLine(`---\n姓名: ${name}\n当前状态: ${ch['当前状态'] || '—'}\n---`, name);
                    allCharsRaw.push({ name, data: statusLine });
                } else {
                    // 涉及实体 或 无索引 → 完整解析
                    const data = `${name}：年龄=${ch['年龄'] || '—'}，身份=${ch['身份'] || '—'}，性格=${ch['性格标签'] || '—'}，动机=${ch['核心动机'] || '—'}，软肋=${ch['核心驱动力_软肋'] || '—'}，习惯=${ch['习惯性小动作'] || '—'}，状态=${ch['当前状态'] || '—'}，情绪=${ch['当前情绪'] || '—'}，能力=${ch['金手指/特殊能力'] || '—'}，功法=${ch['功法/技能树'] || '—'}，势力=${ch['所属势力'] || '—'}，背景=${ch['人物背景'] || '—'}，外貌=${ch['外貌特征'] || '—'}，目标=${ch['当前目标'] || '—'}`;
                    allCharsRaw.push({ name, data });
                }
            }

            // 智能检索过滤：只注入与当前大纲最相关的 Top-8 角色
            let allChars = '';
            const outlineText = outline || infoPlan || '';
            if (allCharsRaw.length > 8 && outlineText) {
                const filtered = scoreAndFilterEntities(allCharsRaw.map(c => ({
                    name: c.name,
                    fields: { raw: c.data },
                    type: 'character' as const,
                    formatText: c.data
                })), outlineText, 8);
                allChars = filtered.map(c => `\n- ${c.text}`).join('');
                if (filtered.length < 3 && allCharsRaw.length > 3) {
                    // 匹配不足3个时回退全量（最多前20个，防止 token 爆炸）
                    allChars = allCharsRaw.slice(0, 20).map(c => `\n- ${c.data}`).join('');
                }
            } else {
                allChars = allCharsRaw.map(c => `\n- ${c.data}`).join('');
            }

            let prevSummary = '';
            for (let p = 1; p < n; p++) {
                const prevStepDir = volNInner > 0 ? pjStepDir(project, volNInner, p) : `${project}/${SUBDIR_STEP_ROOT}/${volume}/第${p}章`;
                const prevOutline = findChapterFile(this.app.vault.getFiles(), prevStepDir, '大纲摘要');
                if (prevOutline) {
                    const c = stripFrontmatter(await this.app.vault.read(prevOutline));
                    if (c.length > 50) prevSummary += `\n【第${p}章摘要】${c.slice(0, 200)}`;
                }
                if (p === n - 1) {
                    const prevBodyPath = volNInner > 0 ? pjBodyFile(project, volNInner, p) : '';
                    let prevBody: TFile | null = prevBodyPath ? (this.app.vault.getAbstractFileByPath(prevBodyPath) as TFile | null) : null;
                    if (!prevBody) prevBody = findChapterFile(this.app.vault.getFiles(), bodyDir, '正文', this.app) ?? null;
                    if (prevBody) {
                        const bc = await this.app.vault.read(prevBody);
                        const paragraphs = bc.split('\n').filter(para => para.trim().length > 20);
                        const lastPara = paragraphs.length > 0 ? paragraphs[paragraphs.length - 1].trim().slice(0, 80) : '';
                        if (lastPara.length > 10) prevSummary += `\n【上一章结束场景】${lastPara}……`;
                    }
                    const prevDir = prevStepDir;
                    try {
                        const reportFile = findChapterFile(this.app.vault.getFiles(), prevDir, '分析报告');
                        if (reportFile) {
                            const reportText = await this.app.vault.read(reportFile);
                            const sm = reportText.match(/(?:续写建议|写作建议|建议)[：:]\s*([^#]+)/);
                            if (sm) prevSummary += `\n【上章分析·续写建议】${sm[1].trim().slice(0, 500)}`;
                        }
                    } catch (e) { console.warn('[小说工坊] 操作失败:', e); }
                }
            }

            const volNum = parseInt(volume.match(/\d+/)?.[0] ?? '') || 1;
            let snapshot = '';
            if (volNum > 1 && n === 1) {
                const prevVolName = `第${volNum - 1}卷`;
                // v4.0：状态快照权威位置统一到 04-项目总控/
                const snapFile = this.app.vault.getAbstractFileByPath(`${pjControlDir(project)}/${prevVolName}_状态快照.md`);
                if (snapFile instanceof TFile) snapshot = stripFrontmatter(await this.app.vault.read(snapFile)).slice(0, 1000);
            }

            let selectedToReveal: string[] = [];
            if (remainingToReveal.length > 0) {
                const take = unrevealedCount > 10 ? 2 : 1;
                selectedToReveal = remainingToReveal.splice(0, take);
            }

            let fsRule = '7. 每章至少回收1个旧伏笔、埋下1个新伏笔';
            if (selectedToReveal.length > 0) {
                fsRule = `7. 信息债${unrevealedCount > 10 ? '过高' : '中等'}（当前未揭示${unrevealedCount}个），本章必须揭示：${selectedToReveal.join('、')}`;
            }

            let writingRulesFromFile = '';
            try {
                const ruleFile = this.app.vault.getAbstractFileByPath(`${WRITING_RULES_PATH_PROJECT}`);
                if (!ruleFile) {
                    const ruleFileAlt = this.app.vault.getAbstractFileByPath(WRITING_RULES_PATH_TEMPLATE);
                    if (ruleFileAlt instanceof TFile) {
                        const raw = await this.app.vault.read(ruleFileAlt);
                        const match = raw.match(/##\s*一、?强制写作规则[\s\S]*?(?=##|\n---|$)/);
                        if (match) {
                            writingRulesFromFile = match[0]
                                .replace(/^---[\s\S]*?---\n*/, '')
                                .replace(/^##.*$/m, '')
                                .replace(/^###\s*\d+\..*/gm, '')
                                .replace(/检查方法[：:].*(\n|$)/g, '')
                                .replace(/^- /gm, '• ')
                                .replace(/\n{3,}/g, '\n\n')
                                .trim().slice(0, 1500);
                        }
                    }
                }
            } catch (e) { console.warn('[小说工坊] 操作失败:', e); }

            const rulesBody = writingRulesFromFile ? `${writingRulesFromFile}

【补充规则】
${fsRule}
- **OOC 防护**：角色行为必须严格符合核心动机和性格标签，偏离需剧情铺垫
- **番茄小说格式**：每段开头空两格（两个全角空格  ），段落间空行，对话独立成段
- **标题写法**：章节标题行 '# 第X章' 后面只写标题（2-15字），正文从下一行开始` : `1. 连续性：本章首句无缝承接前一章结尾，时间跳跃须开头50字交代
2. 字数：每章≥2500字
3. 故事驱动：对话和动作推动剧情，情感通过动作和对话体现
4. 禁止AI文：无排比、无抒情升华、无过度心理描写、无成语堆砌
5. 标点：破折号≤3处，感叹号≤3个，禁分号/省略号，禁一逗到底
6. 信息密度：每章1-2个有效信息点，禁用无效填充
${fsRule}
8. OOC 防护：角色行为必须严格符合核心动机和性格标签，偏离需剧情铺垫
9. **番茄小说格式**：每段开头空两格（两个全角空格  ），段落间空行，对话独立成段
10. **标题写法**：章节标题行 '# 第X章' 后面只写标题（2-15字），标题行下一行才是正文`;

            const sysPrompt = `你是一个网络小说作家。你在收到全部上下文后，必须先确认理解了以下<writing_rules>中的规则，然后严格按照规则执笔写作。

<writing_rules>
${rulesBody}
</writing_rules>

【写作范文——参考其对话格式和标点用法】
徐凤年靠在马车边上，嘴里叼着一根草茎，懒洋洋地问道："老黄，你说那北凉王府的厨子，是不是又在偷懒？"

老黄蹲在路边，头也不抬："少爷，您这话说的，厨子昨儿个才被您骂了一顿，今儿哪还敢偷懒。"

"哦？"徐凤年吐出草茎，拍了拍手，"那他今天做的红烧肉，怎么比我前天吃的差了三分味道？"

"这……"老黄抬起头，一脸为难，"少爷，那您前天吃的那碗，是我偷着加了半勺糖的。厨子不知道您的口味。"

徐凤年愣了愣，随即笑骂道："你个老东西，背着厨子改配方，也不怕他知道了跟你翻脸。"

老黄嘿嘿一笑："只要少爷吃得开心，老黄挨顿骂也值了。"

"行，那今天的晚饭，你再去厨房给我加半勺糖。"徐凤年翻身上马，"要是被厨子逮着了，就说是我让加的。"

"得嘞！"老黄站起身，拍了拍膝盖上的土，咧嘴笑了起来。

确认你理解了以上所有规则后，开始写作。`;

            let userContent = `【本章信息规划】${infoPlan.slice(0, 800)}\n`;
            userContent += `\n【本章大纲】${outline.slice(0, 800)}\n`;
            if (worldView) userContent += `\n【世界观】${worldView.slice(0, 500)}\n`;
            if (settingLib) userContent += `\n【设定库】${settingLib.slice(0, 1500)}\n`;
            if (writingStyle) userContent += `\n【文笔风格要求】${writingStyle.slice(0, 1000)}\n`;
            if (snapshot) userContent += `\n【上一卷状态快照】${snapshot}\n`;
            if (prevSummary) userContent += `\n【前文摘要】${prevSummary.slice(0, 1500)}\n`;
            if (timelineEvents) userContent += `\n【时间线事件】${timelineEvents.slice(0, 500)}\n`;
            userContent += `\n【人物状态】${allChars.slice(0, 2000)}\n`;

            userContent += `\n请撰写第${n}章正文，输出完整 .md 格式，标题为 # 第${n}章。

【最后指令——必须遵守】
- 字数 ≥ 2500 字
- 段落开头空两格
- 标题行 '# 第X章' 后面只写标题（2-15字）
- 不使用破折号、分号、省略号
- 对话驱动，${selectedToReveal.length > 0 ? `本章必须揭示以下伏笔：${selectedToReveal.join('、')}` : '每章至少回收1个旧伏笔、埋下1个新伏笔'}
- 首句必须自然衔接前一章结尾
- 时间跳跃须在开头50字内明确交代

【⚠️ 输出前自查——逐条核对，违者重写】
① 全文对话必须加引号"" ② 破折号≤3处 ③ 感叹号≤3个 ④ 禁分号、省略号 ⑤ 无一逗到底（连续3逗号后必须句号）
⑥ 每段开头空两格 ⑦ 字数≥2500字 ⑧ 标题行'# 第X章'后跟2-15字标题`;

            let result = await this.aiEngine.callAI(sysPrompt, userContent, undefined, 0.7, this.plugin.settings.maxOutput);

            if (!result.error) {
                let bodyText = result.content;

                let maxCont = 3;
                while (maxCont > 0) {
                    const tail = bodyText.trim().slice(-60);
                    const isComplete = /[。！？"\n]\s*$/.test(tail) || /^#/.test(tail) || bodyText.length < 500;
                    const hasClosing = bodyText.includes('# 第') && (bodyText.match(/第\d+章/g)?.length ?? 0) >= 1;
                    if (isComplete && hasClosing) break;
                    maxCont--;
                    const contResult = await this.aiEngine.callAI(
                        '你是一个小说续写助手。根据已有正文，继续输出后续内容，不要重复已有内容。直接输出续写内容。',
                        `【已有正文】\n${bodyText.slice(-1000)}\n\n请从断点处继续输出，完成本章剩余内容。`);
                    if (contResult.content && !contResult.error) {
                        bodyText += '\n' + contResult.content;
                    } else break;
                }

                let violations = this.checkWritingRules(bodyText, n);
                let fixAttempts = 0;
                while (violations.length > 0 && fixAttempts < 2) {
                    fixAttempts++;
                    const msg = violations.slice(0, 4).join('；') + (violations.length > 4 ? `…等${violations.length}项` : '');
                    mainNotice.hide();
                    mainNotice = new Notice(`⚠️ 第${n}章违规，正在修正（第${fixAttempts}次）：${msg}`, 8000);

                    const ruleRef = writingRulesFromFile ? `\n【写作规则参考】\n${writingRulesFromFile}` : '';
                    const fixPrompt = `你是一位文字编辑。以下正文存在写作违规，请直接输出修正后的完整正文，只修改违规部分，不要改变剧情和人物。${ruleRef}

【违规列表】
${violations.map((v, i) => `${i+1}. ${v}`).join('\n')}

【正文】
${bodyText}

请输出修正后的完整正文。`;
                    const fixResult = await this.aiEngine.callAI(
                        '你是一位严格的文字编辑，根据违规列表修正正文。直接输出修正后的完整正文。', fixPrompt);
                    if (fixResult.content) {
                        bodyText = fixResult.content;
                        bodyText = bodyText.replace(/^---[\s\S]*?\n---\n?/, '').trim();
                    }
                    violations = this.checkWritingRules(bodyText, n);
                }
                if (violations.length > 0) {
                    new Notice(`⚠️ 第${n}章仍有${violations.length}项违规未能自动修正`, 8000);
                }
                bodyText = bodyText.replace(/^---[\s\S]*?\n---\n?/, '').trim();

                bodyText = bodyText.split('\n').map(line => {
                    const t = line.trim();
                    if (!t || t.startsWith('#') || t.startsWith('```') || t.startsWith('|') || t.startsWith('- ') || t.startsWith('* ')) return line;
                    if (!t.startsWith('  ')) return '  ' + line.trimStart();
                    return line;
                }).join('\n');

                let title = '';
                const titleMatch = bodyText.match(/^#\s*第\d+章[\s：:]+(.+)/m);
                if (titleMatch) title = titleMatch[1].trim();

                const fmFull = `---
tags: [正文]
卷: ${volume}
章: ${chapName}
${title ? `标题: ${title}` : ''}
---

`;
                const merged = fmFull + `# ${chapName}${title ? ' ' + title : ''}\n\n` + bodyText.replace(/^#\s+第\d+章\s+.*/m, '').trim();

                // v4.0: 正文位于 pjBodyDir
                let bf = findChapterFile(this.app.vault.getFiles(), bodyDir, '正文', this.app);
                if (bf) {
                    await this.app.vault.modify(bf, merged);
                } else {
                    // 不存在 → 在 pjBodyDir 下新建
                    await mkdirp(this.app, bodyDir);
                    bf = await this.app.vault.create(bodyPath, merged);
                }

                if (title && bf) {
                    try {
                        // v3.4.9 起正文文件名固定为「第X章_正文.md」，不再嵌入标题
                        // 此处保留 if 框架但不重命名，避免新结构下不必要的 rename 竞态
                    } catch (e) { console.warn('[小说工坊] 操作失败:', e); }
                }

                const reportNotice = new Notice(`⏳ 正在分析 ${chapName}...`, 0);
                const reportSys = `你是一位小说信息论分析师兼元素提取器。

1. **新元素提取（优先）**：逐段扫描正文，提取所有首次出现的专有名词级别新元素。
2. **信息论分析**：互信息断裂检测、自信息事件评估。

【元素提取规则】
- 只提取专有名词（如"炼体诀""青云宗"），常见词不提取
- 功法名、法宝名、武技名必须提取

【输出格式——严格遵循】
UPDATE_CHARACTER: [[角色]] | 当前状态 | 新值
UPDATE_FORESHADOW: [[伏笔]] | 状态 | 已揭示
NEW_CHARACTER: 名 | 描述
NEW_LOCATION: 名 | 描述
NEW_FACTION: 名 | 描述
NEW_ITEM: 功法/物品/法宝名 | 描述
NEW_FORESHADOW: 内容 | 埋入章节 | 预期揭示
NEW_TIMELINE: 时间点 | 事件

【分析要求（在提取指令之后输出）】
- 互信息断裂检测
- 自信息事件评估`;
                const reportUser = `【正文】${bodyText.slice(0, 5000)}\n\n请完成新元素提取和信息论分析。提取指令放在前面。`;
                const reportResult = await this.aiEngine.callAI(reportSys, reportUser);
                reportNotice.hide();

                let reportContent = '';
                if (reportResult.content) {
                    reportContent = reportResult.content;
                } else {
                    if (selectedToReveal.length > 0) {
                        reportContent = selectedToReveal.map(n => `UPDATE_FORESHADOW: [[${n}]] | 状态 | 已揭示`).join('\n');
                    }
                    new Notice(`⚠️ ${chapName} 分析报告 API 失败，人物/地点/势力/物品本轮不会更新`, 8000);
                }

                if (reportContent) {
                    const rp = `${basePath}/${getChapterFileName(chapName, '分析报告')}`;
                    const rpFile = this.app.vault.getAbstractFileByPath(rp);
                    if (rpFile) await this.app.vault.delete(rpFile);
                    await mkdirp(this.app, basePath);
                    await this.app.vault.create(rp, `---\ntags: [分析报告]\n---\n\n# ${chapName} 分析报告\n\n${reportContent}\n`);
                }

                if (reportContent) {
                    try {
                        const sr = await this.executeSettlement(project, basePath, chapName, reportContent, bodyText, selectedToReveal);

                        const sp = `${basePath}/${getChapterFileName(chapName, '结算表')}`;
                        // v4.0: 结算表带 frontmatter（与 元文件/00-系统模板/结算表模板.md 对齐）
                        const bcVolMatch = basePath.match(/\/步骤结果\/(第\d+卷)\//);
                        const bcVol = bcVolMatch ? bcVolMatch[1] : '';
                        const bcNow = new Date().toISOString();
                        const bcFm = `---\ntags: [结算表]\n卷: "${bcVol}"\n章: "${chapName}"\nstep_status: generated\nstep_model: ""\nstep_timestamp: ${bcNow}\n结算时间: ${bcNow}\n结算状态: completed\n---\n\n`;
                        const ss = `${bcFm}# ${chapName} 结算表\n\n## 更新状态\n- 人物状态更新：${sr.updatedChars} 人\n- 伏笔状态更新：${sr.updatedForeshadows} 个\n\n## 新建元素\n- 新建人物：${sr.createdChars} 个\n- 新建地点：${sr.createdLocs} 个\n- 新建势力：${sr.createdFactions} 个\n- 新建物品功法：${sr.createdItems} 个\n- 新建伏笔：${sr.createdForeshadows} 个\n- 新建时间线事件：${sr.createdTimelines} 个\n`;
                        const spFile = this.app.vault.getAbstractFileByPath(sp);
                        if (spFile) await this.app.vault.delete(spFile);
                        await this.app.vault.create(sp, ss);

                        if (bf) {
                        let cb = await this.app.vault.read(bf);
                        let nf = cb.match(/^---\n[\s\S]*?\n---\n/)?.[0] || '';
                        if (nf) {
                            nf = nf.includes('status:') ? nf.replace(/status:.*/, 'status: written') : nf.replace(/^---\n/, '---\nstatus: written\n');
                            const links = reportContent.match(/\[\[(.*?)\]\]/g) || [];
                            const an = [...new Set(links.map(l => l.replace(/[\[\]]/g, '').trim()))];
                            nf = this.addFieldToFrontmatter(nf, '涉及人物', an);
                            const extr = (prefix: string) => {
                                const r: string[] = [];
                                for (const l of reportContent.split('\n')) {
                                    const m = l.match(new RegExp(prefix + ':\\s*(.*?)\\s*\\|'));
                                    if (m) r.push(m[1].trim());
                                }
                                return r;
                            };
                            nf = this.addFieldToFrontmatter(nf, '涉及地点', extr('NEW_LOCATION'));
                            nf = this.addFieldToFrontmatter(nf, '涉及势力', extr('NEW_FACTION'));
                            nf = this.addFieldToFrontmatter(nf, '涉及物品功法', extr('NEW_ITEM'));
                            const upd = nf + cb.replace(/^---\n[\s\S]*?\n---\n/, '');
                            await this.app.vault.modify(bf, upd);
                        }
                        }
                    } catch (e) { console.warn(`${chapName} 结算失败:`, e); }
                }

                done++;
                new Notice(`✅ ${chapName} 完成（${done}/${total}）`, 8000);
            } else {
                new Notice(`❌ 第${n}章生成失败: ${result.error}`, 8000);
            }
        }

        mainNotice.hide();
        await this.refreshInfoDebt(project);
        showSuccess(`批量写正文完成：${done}/${total} 章`);
        this.close();
    }

    private async getUnrevealedForeshadowCount(project: string): Promise<number> {
        let count = 0;
        try {
            const ff = this.app.vault.getAbstractFileByPath(pjForeshadowDB(project));
            if (ff instanceof TFile) {
                const content = await this.app.vault.read(ff);
                for (const line of content.split('\n')) {
                    if (!line.match(/^\|.*\|/)) continue;
                    const cols = line.split('|').map(s => s.trim()).filter(Boolean);
                    if (cols.length === 0) continue;
                    if (cols[0] === '#' || cols[0].includes('---') || cols[0] === '伏笔') continue;
                    const status = cols.length >= 6 ? cols[5] : cols[1] || '';
                    if (status.includes('未揭示') || status === '') count++;
                }
            }
        } catch (e) { console.warn('[小说工坊] 操作失败:', e); }
        return count;
    }

    private async getUnrevealedForeshadowNames(project: string): Promise<string[]> {
        const names: string[] = [];
        try {
            const ff = this.app.vault.getAbstractFileByPath(pjForeshadowDB(project));
            if (ff instanceof TFile) {
                const content = await this.app.vault.read(ff);
                for (const line of content.split('\n')) {
                    if (!line.match(/^\|.*\|/)) continue;
                    const cols = line.split('|').map(s => s.trim()).filter(Boolean);
                    if (cols.length === 0) continue;
                    if (cols[0] === '#' || cols[0].includes('---') || cols[0] === '伏笔') continue;
                    const status = cols.length >= 6 ? cols[5] : cols[1] || '';
                    if (status.includes('未揭示') || status === '') {
                        names.push(cols.length >= 6 ? cols[1] : cols[0]);
                    }
                }
            }
        } catch (e) { console.warn('[小说工坊] 操作失败:', e); }
        return names;
    }

    private checkWritingRules(bodyText: string, chapterNum: number): string[] {
        const violations: string[] = [];
        const cleanBody = bodyText.replace(/^---[\s\S]*?\n---\n?/, '').trim();

        const dashCount = (cleanBody.match(/——/g) || []).length;
        if (dashCount > 3) violations.push(`破折号过多（${dashCount}处）`);

        const exclamationCount = (cleanBody.match(/！/g) || []).length;
        if (exclamationCount > 3) violations.push(`感叹号过多（${exclamationCount}个）`);

        if (cleanBody.includes('；')) violations.push('存在分号');
        if (cleanBody.includes('……')) violations.push('存在省略号');

        const commaCount = (cleanBody.match(/，，，/g) || []).length;
        if (commaCount > 0) violations.push('存在一逗到底（连续3个逗号）');

        const lines = cleanBody.split('\n');
        let shortParagraphs = 0;
        for (const line of lines) {
            const t = line.trim();
            if (t && !t.startsWith('#') && !t.startsWith('|') && !t.startsWith('-') && !t.startsWith('*') && !t.startsWith('```') && t.length < 15) {
                shortParagraphs++;
            }
        }
        if (shortParagraphs > 5) violations.push(`短段落过多（${shortParagraphs}段<15字）`);

        if (cleanBody.length < 2000) violations.push(`字数不足（${cleanBody.length}字 < 2500字）`);

        return violations;
    }

    private addFieldToFrontmatter(fm: string, fieldName: string, names: string[]): string {
        if (!names.length) return fm;
        const yl = names.map(n => `  - "[[${n}]]"`).join('\n');
        if (fm.includes(fieldName + ':')) {
            return fm.replace(new RegExp(fieldName + ':\\n(?:  .*\\n?)*'), `${fieldName}:\n${yl}\n`);
        }
        return fm.replace(/^---\n/, `---\n${fieldName}:\n${yl}\n`);
    }

    private async executeSettlement(project: string, basePath: string, chapName: string, report: string, bodyText: string, forceReveal: string[] = []): Promise<SettlementResult> {
        return this.settlementEngine.settle(project, basePath, chapName, report, bodyText,
            { forceReveal: forceReveal.length > 0 ? forceReveal : undefined }
        );
    }

    private async refreshInfoDebt(project: string): Promise<void> {
        const files = this.app.vault.getFiles().filter(f => f.path.startsWith(project + '/'));
        const charF = files.filter(f => f.path.startsWith(pjCharsDir(project) + '/') && f.name.endsWith('.md') && f.name !== '人物模板.md');
        const chapF = files.filter(f => f.path.includes('正文') && f.name.endsWith('.md'));

        let unrevealed = 0, revealed = 0;
        try {
            const fp = pjForeshadowDB(project);
            const ff = this.app.vault.getAbstractFileByPath(fp);
            if (ff instanceof TFile) {
                const content = await this.app.vault.read(ff);
                for (const line of content.split('\n')) {
                    if (!line.match(/^\|.*\|/)) continue;
                    const cols = line.split('|').map(s => s.trim()).filter(Boolean);
                    if (cols.length === 0) continue;
                    if (cols[0] === '#' || cols[0].includes('---') || cols[0] === '伏笔') continue;
                    const status = cols.length >= 6 ? cols[5] : cols[1] || '';
                    if (status.includes('未揭示') || status === '') unrevealed++;
                    else if (status.includes('已揭示') || status.includes('揭示')) revealed++;
                }
            }
        } catch (e) { console.warn('[小说工坊] 操作失败:', e); }

        const completedChaps = new Set<string>();
        for (const f of chapF) {
            try {
                const cache = this.app.metadataCache.getFileCache(f);
                const fm = cache?.frontmatter;
                const status = fm?.status;
                if (status === 'written' || status === 'settled') {
                    completedChaps.add(f.name);
                }
            } catch (e) { console.warn('[小说工坊] 操作失败:', e); }
        }

        let charOk = 0, charMiss = 0;
        for (const f of charF) { try { const c = await this.app.vault.read(f); if (c.match(/^---\n[\s\S]*?\n---/)?.[0].includes('当前状态:')) charOk++; else charMiss++; } catch { charMiss++; } }

        const debtR = Math.min(15, unrevealed);
        const debtContent = `---
tags: [看板]
---

# 📊 信息债看板

> 自动刷新时间：${new Date().toLocaleString()}

## 章节进度
- 总章节文件：${chapF.length}
- 已完成正文：${completedChaps.size}

## 伏笔态势
- 未揭示伏笔：${unrevealed} ${unrevealed > 5 ? '⚠️ 偏高' : '✅ 正常'}
- 已揭示伏笔：${revealed}

## 健康度
- 信息债等级：${'🟢'.repeat(Math.max(0, 15-debtR))}${'🔴'.repeat(debtR)} (${debtR}/15)

## 人物卡状态
- 已填写当前状态：${charOk}
- 状态待更新：${charMiss}

## 提醒
${unrevealed > 10 ? '- ⚠️ 未揭示伏笔过多（信息债 🔴），建议优先回收' : unrevealed > 5 ? '- ⚡ 未揭示伏笔中等（信息债 🟡），注意穿插回收' : '- ✅ 伏笔生态健康'}
${charMiss > 0 ? `- ⚠️ ${charMiss}个人物未填写当前状态` : ''}
`;

        const debtP = pjInfoDebtBoard(project);
        try {
            const dir = pjControlDir(project);
            if (!this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
            const existingDebtBoard = this.app.vault.getAbstractFileByPath(debtP);
            if (existingDebtBoard) await this.app.vault.delete(existingDebtBoard);
            await this.app.vault.create(debtP, debtContent);
        } catch (e) { console.warn('[小说工坊] 操作失败:', e); }
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
