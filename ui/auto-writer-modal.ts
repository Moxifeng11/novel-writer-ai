/**
 * @deprecated Legacy 自动写作器 Modal（命令 ID: novel-writer-auto-writer, 显示名带"〔旧〕"）。
 *
 * 当前推荐入口：完整写作工作台（FullWriterView，含批量与自动模式）。
 *
 * 计划：在下个大版本（v5.x）评估完全移除。维护原则：仅修 Bug，不再加新特性。
 */
import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine } from '../engine/ai-engine';
import { ContextManager } from '../engine/context-manager';
import { scoreAndFilterEntities, ScoredEntity } from '../engine/entity-scorer';
import { mkdirp, showSuccess, showError, stripFrontmatter } from '../utils/helpers';
import { getChapterFileName, findChapterFile } from '../engine/chapter-utils';
import { SettlementEngine } from '../engine/settlement-engine';
import { ENGINE_NAMES } from '../engine/engine-registry';
import { pjBodyDir, pjBodyFile, pjStepDir, pjStepFile, pjCharsDir, SUBDIR_BODY_ROOT, SUBDIR_STEP_ROOT } from '../shared/paths';
import { CHARACTER_DISPLAY_KEYS } from '../shared/format-constants';
import { TemplateService } from '../services/template-service';
import { buildStepFrontmatter } from '../shared/step-frontmatter';
import { createLogger } from '../shared/logger';


const log = createLogger('AutoWriterModal');
export class AutoWriterModal extends Modal {
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;
    private contextManager: ContextManager;
    private settlementEngine: SettlementEngine;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.aiEngine = plugin.aiEngine;
        this.contextManager = plugin.ctxManager;
        this.settlementEngine = plugin.engineRegistry.get<SettlementEngine>(ENGINE_NAMES.SETTLEMENT_ENGINE);
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
        contentEl.createEl('h2', { text: '🤖 自动写作器' });

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

            const startButton = contentEl.createEl('button', { text: '开始自动写作', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
            startButton.onclick = async () => {
                const project = projectSelect.value;
                const volume = volSelect.value;
                const startNum = parseInt(startInput.value);
                const endNum = parseInt(endInput.value);

                if (!startNum || !endNum || startNum > endNum) {
                    showError('请输入有效的起止章号');
                    return;
                }

                await this.runAutoWriter(project, volume, startNum, endNum);
            };
        };

        populateProjects();
    }

    private async populateVolumes(project: string, selectEl: HTMLSelectElement): Promise<void> {
        selectEl.innerHTML = '';
        const volDirs: string[] = [];
        for (const f of this.app.vault.getFiles()) {
            // v4.0: 正文位于 03-大纲与章节/正文/第X卷/...
            const m = f.path.match(new RegExp(`${project}/(?:${SUBDIR_BODY_ROOT}|${SUBDIR_STEP_ROOT})/(第\d+卷)/`));
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

    private async runAutoWriter(project: string, volume: string, startNum: number, endNum: number): Promise<void> {
        if (!this.plugin.settings.apiKey) {
            showError('请先配置API密钥');
            return;
        }

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
        const targetNums = chapNums.filter(n => n >= startNum && n <= endNum);
        const total = targetNums.length;

        if (total === 0) {
            showError('未找到目标章节');
            return;
        }

        let mainNotice = new Notice(`⏳ 自动写作: 0/${total}`, 0);
        let done = 0;

        for (let idx = 0; idx < targetNums.length; idx++) {
            const n = targetNums[idx];
            const chapName = `第${n}章`;
            // v4.0: basePath 改为步骤结果目录；正文走 pjBodyFile
            const volMatchN = volume.match(/第(\d+)卷/);
            const volN = volMatchN ? parseInt(volMatchN[1], 10) : 0;
            const basePath = volN > 0 ? pjStepDir(project, volN, n) : `${project}/${SUBDIR_STEP_ROOT}/${volume}/${chapName}`;

            mainNotice.hide();
            mainNotice = new Notice(`⏳ 自动写作: ${chapName}（${done}/${total}）`, 0);

            try {
                await this.writeChapter(project, volume, n, basePath);
                done++;
                new Notice(`✅ ${chapName} 完成（${done}/${total}）`, 5000);
            } catch (e) {
                new Notice(`❌ ${chapName} 失败: ${(e as Error).message}`, 5000);
            }
        }

        mainNotice.hide();
        showSuccess(`自动写作完成：${done}/${total} 章`);
        this.close();
    }

    private async writeChapter(project: string, volume: string, n: number, basePath: string): Promise<void> {
        const chapName = `第${n}章`;
        // v4.0: basePath = 步骤结果目录；正文写到 pjBodyFile
        const volMatchN = volume.match(/第(\d+)卷/);
        const volN = volMatchN ? parseInt(volMatchN[1], 10) : 0;
        const bodyDir = volN > 0 ? pjBodyDir(project, volN) : `${project}/${SUBDIR_BODY_ROOT}/${volume}`;
        const bodyTargetPath = volN > 0 ? pjBodyFile(project, volN, n) : `${bodyDir}/${chapName}_正文.md`;

        const templateService = this.plugin.engineRegistry.get<TemplateService>(ENGINE_NAMES.TEMPLATE_SERVICE);
        const vars = { project, volume, chapterName: chapName, chapterNumber: n };

        let infoPlan = '';
        const infoFile = findChapterFile(this.app.vault.getFiles(), basePath, '信息规划');
        if (infoFile) {
            infoPlan = stripFrontmatter(await this.app.vault.read(infoFile));
        } else {
            infoPlan = await this.generateInfoPlan(project, volume, n);
            const infoPath = `${basePath}/${getChapterFileName(chapName, '信息规划')}`;
            await mkdirp(this.app, basePath);
            const infoTemplate = await templateService.getInfoPlanTemplate(vars);
            const infoFm = buildStepFrontmatter({
                tag: '信息规划',
                volume,
                chapter: chapName,
                model: this.plugin.settings.defaultModel,
            });
            await this.app.vault.create(infoPath, infoTemplate.replace(/---[\s\S]*?---\n/, `${infoFm}\n\n${infoPlan}\n`));
        }

        let outline = '';
        const outlineFile = findChapterFile(this.app.vault.getFiles(), basePath, '大纲摘要');
        if (outlineFile) {
            outline = stripFrontmatter(await this.app.vault.read(outlineFile));
        } else {
            outline = await this.generateOutline(project, volume, n, infoPlan);
            const outlinePath = `${basePath}/${getChapterFileName(chapName, '大纲摘要')}`;
            await mkdirp(this.app, basePath);
            const outlineTemplate = await templateService.getOutlineTemplate(vars);
            const outlineFm = buildStepFrontmatter({
                tag: '大纲摘要',
                volume,
                chapter: chapName,
                model: this.plugin.settings.defaultModel,
            });
            await this.app.vault.create(outlinePath, outlineTemplate.replace(/---[\s\S]*?---\n/, `${outlineFm}\n\n${outline}\n`));
        }

        const body = await this.generateBody(project, volume, n, infoPlan, outline);

        // v4.0: 正文文件位于 pjBodyDir 而非步骤结果目录
        const bodyPath = bodyTargetPath;
        let bodyFile = findChapterFile(this.app.vault.getFiles(), bodyDir, '正文', this.app);

        if (bodyFile) {
            await this.app.vault.modify(bodyFile, body);
        } else {
            await mkdirp(this.app, bodyDir);
            bodyFile = await this.app.vault.create(bodyPath, body);
        }

        const report = await this.generateAnalysis(project, volume, n, body);
        const reportPath = `${basePath}/${getChapterFileName(chapName, '分析报告')}`;
        const existingReport = this.app.vault.getAbstractFileByPath(reportPath);
        if (existingReport) {
            await this.app.vault.delete(existingReport);
        }
        await mkdirp(this.app, basePath);
        const reportFm = buildStepFrontmatter({
            tag: '分析报告',
            volume,
            chapter: chapName,
            model: this.plugin.settings.defaultModel,
        });
        await this.app.vault.create(reportPath, `${reportFm}\n\n${report}\n`);

        await this.executeSettlement(project, basePath, chapName, report, body);
    }

    private async generateInfoPlan(project: string, volume: string, n: number): Promise<string> {
        const chapName = `第${n}章`;

        let prevOutline = '';
        if (n > 1) {
            for (const vol of this.getVolumes(project)) {
                const vmN = vol.match(/第(\d+)卷/);
                const vN = vmN ? parseInt(vmN[1], 10) : 0;
                const prevDir = vN > 0 ? pjStepDir(project, vN, n - 1) : `${project}/${SUBDIR_STEP_ROOT}/${vol}/第${n - 1}章`;
                const prevFile = findChapterFile(this.app.vault.getFiles(), prevDir, '大纲摘要');
                if (prevFile) {
                    prevOutline = stripFrontmatter(await this.app.vault.read(prevFile)).slice(0, 500);
                    break;
                }
            }
        }

        // 读取项目已有角色
        let allChars = '';
        try {
            const charFolder = pjCharsDir(project);
            for (const f of this.app.vault.getFiles()) {
                if (f.path.startsWith(charFolder) && f.name.endsWith('.md') && !f.name.includes('模板')) {
                    const content = await this.app.vault.read(f);
                    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
                    if (fmMatch) {
                        const fm = fmMatch[1];
                        const getName = () => { const m = fm.match(/姓名:\s*(.+)/); return m ? m[1].trim() : ''; };
                        const getId = () => { const m = fm.match(/身份:\s*(.+)/); return m ? m[1].trim() : ''; };
                        const name = getName();
                        const identity = getId();
                        if (name) {
                            const tag = identity.includes('主角') ? '【主角】' : '【角色】';
                            allChars += `\n${tag} ${name}`;
                        }
                    }
                }
            }
        } catch (e) { log.warn('[小说工坊] 操作失败:', e); }

        const sysPrompt = '你是一个小说信息规划师。根据前文和分卷大纲，规划本章需要呈现的信息。严禁规划与已有角色列表无关的新主角出场。';
        const userPrompt = `【前文摘要】${prevOutline || '无'}

【章节】第${n}章（${volume}）
【已有角色】${allChars || '未找到角色文件'}
【规划原则】本章的信息点必须围绕已有角色展开，严禁引入全新主角。

请规划本章的信息点，输出格式：

## 本章信息点
- 必须呈现的核心信息
- 次要信息

## 需要调用的设定
- 设定名称

## 伏笔管理
- 需要回收的伏笔
- 需要埋设的伏笔

## 人物状态变化
- 人物名：变化描述`;

        const result = await this.aiEngine.callAI(sysPrompt, userPrompt);
        return result.content || '';
    }

    private async generateOutline(project: string, volume: string, n: number, infoPlan: string): Promise<string> {
        const chapName = `第${n}章`;

        const sysPrompt = '你是一个小说章节规划师。根据信息规划生成详细大纲摘要。';
        const userPrompt = `【本章信息规划】
${infoPlan.slice(0, 800)}

生成大纲摘要，包含：
1. 本章在全书的定位
2. 关键场景（按顺序，3-5个）
3. 需要呈现的信息
4. 情感基调
5. 结尾钩子

输出 Markdown，不要解释。`;

        const result = await this.aiEngine.callAI(sysPrompt, userPrompt);
        return result.content || '';
    }

    private async generateBody(project: string, volume: string, n: number, infoPlan: string, outline: string): Promise<string> {
        const chapName = `第${n}章`;

        const cm = this.plugin.ctxManager;
        const promptCtx = await cm.buildPromptSection(project);
        let worldView = promptCtx.worldView;
        let settingLib = promptCtx.settingLib.slice(0, 2000);
        let writingStyle = promptCtx.writingStyle.slice(0, 1500);

        let prevSummary = '';
        if (n > 1) {
            for (const vol of this.getVolumes(project)) {
                const vmN = vol.match(/第(\d+)卷/);
                const vN = vmN ? parseInt(vmN[1], 10) : 0;
                const prevBodyDir = vN > 0 ? pjBodyDir(project, vN) : `${project}/${SUBDIR_BODY_ROOT}/${vol}`;
                // v4.0: 在 pjBodyDir 中按文件名定位上一章
                const targetPrevBody = vN > 0 ? pjBodyFile(project, vN, n - 1) : '';
                let prevBody: TFile | null = targetPrevBody ? (this.app.vault.getAbstractFileByPath(targetPrevBody) as TFile | null) : null;
                if (!prevBody) prevBody = findChapterFile(this.app.vault.getFiles(), prevBodyDir, '正文', this.app) ?? null;
                if (prevBody) {
                    const bc = await this.app.vault.read(prevBody);
                    const paragraphs = bc.split('\n').filter(para => para.trim().length > 20);
                    const lastPara = paragraphs.length > 0 ? paragraphs[paragraphs.length - 1].trim().slice(0, 500) : '';
                    if (lastPara.length > 10) prevSummary += `【上一章结束场景】${lastPara}……`;
                    const firstPara = paragraphs.length > 1 ? paragraphs[0].trim().slice(0, 200) : '';
                    if (firstPara.length > 20) prevSummary += `\n【上一章开局】${firstPara}……`;
                }
            }
        }

        // 读取前文分析报告和审查结果
        if (n > 1) {
            for (const vol of this.getVolumes(project)) {
                const vmN = vol.match(/第(\d+)卷/);
                const vN = vmN ? parseInt(vmN[1], 10) : 0;
                const prevChapDir = vN > 0 ? pjStepDir(project, vN, n - 1) : `${project}/${SUBDIR_STEP_ROOT}/${vol}/第${n - 1}章`;
                // 尝试读取分析报告
                const analysisFile = findChapterFile(this.app.vault.getFiles(), prevChapDir, '分析报告');
                if (analysisFile) {
                    try {
                        const analysisContent = stripFrontmatter(await this.app.vault.read(analysisFile));
                        const nextPlan = analysisContent.match(/续写建议[：:][\s\S]*?(?=\n##|\n---|$)/);
                        if (nextPlan) prevSummary += `\n【前文续写建议】${nextPlan[0].slice(0, 300)}`;
                    } catch (e) { log.warn('[小说工坊] 操作失败:', e); }
                }
                // 尝试读取审查问题
                const reviewFile = findChapterFile(this.app.vault.getFiles(), prevChapDir, '审查');
                if (reviewFile) {
                    try {
                        const reviewContent = stripFrontmatter(await this.app.vault.read(reviewFile));
                        const issues = reviewContent.match(/问题[：:][\s\S]*?(?=\n##|\n---|$)/);
                        if (issues) prevSummary += `\n【前文审查问题】${issues[0].slice(0, 200)}`;
                    } catch (e) { log.warn('[小说工坊] 操作失败:', e); }
                }
                break; // 只取最近一章
            }
        }

        const allEntities: ScoredEntity[] = [];
        const charFieldKeys = CHARACTER_DISPLAY_KEYS as unknown as string[];

        // 从统一上下文构建人物
        for (const ch of promptCtx.rawCharacters) {
            const name = ch.name || ch.姓名 || '';
            if (!name) continue;
            const fields: Record<string, string> = {};
            for (const k of charFieldKeys) {
                const v = ch[k] || '—';
                if (v !== '—') fields[k] = v;
            }
            const formatText = `\n- ${name}：年龄=${ch['年龄'] || '—'}，身份=${ch['身份'] || '—'}，性格=${ch['性格标签'] || '—'}，动机=${ch['核心动机'] || '—'}，软肋=${ch['核心驱动力_软肋'] || '—'}，习惯=${ch['习惯性小动作'] || '—'}，状态=${ch['当前状态'] || '—'}，情绪=${ch['当前情绪'] || '—'}，能力=${ch['金手指/特殊能力'] || '—'}，功法=${ch['功法/技能树'] || '—'}，势力=${ch['所属势力'] || '—'}，背景=${ch['人物背景'] || '—'}，外貌=${ch['外貌特征'] || '—'}，目标=${ch['当前目标'] || '—'}`;
            allEntities.push({ name, fields, type: 'character', formatText });
        }

        // 从统一上下文构建势力/地点/物品
        for (const e of promptCtx.rawFactions) {
            const name = e.name || '';
            if (!name) continue;
            const type = e['类型'] || ''; const leader = e['领袖'] || ''; const rank = e['地位/排名'] || '';
            const fields: Record<string, string> = {};
            if (type) fields['类型'] = type;
            if (leader) fields['领袖'] = leader;
            if (rank) fields['地位/排名'] = rank;
            const formatText = `\n- ${name}：类型=${type || '—'}，领袖=${leader || '—'}，地位=${rank || '—'}`;
            allEntities.push({ name, fields, type: 'faction', formatText });
        }
        for (const e of promptCtx.rawLocations) {
            const name = e.name || '';
            if (!name) continue;
            const type = e['类型'] || ''; const features = e['地理特征'] || ''; const importance = e['重要程度'] || '';
            const fields: Record<string, string> = {};
            if (type) fields['类型'] = type;
            if (features) fields['地理特征'] = features;
            if (importance) fields['重要程度'] = importance;
            const formatText = `\n- ${name}：类型=${type || '—'}，特征=${features || '—'}，重要程度=${importance || '—'}`;
            allEntities.push({ name, fields, type: 'location', formatText });
        }
        for (const e of promptCtx.rawItems) {
            const name = e.name || '';
            if (!name) continue;
            const type = e['类型'] || ''; const level = e['品阶/等级'] || ''; const effect = e['效果'] || '';
            const fields: Record<string, string> = {};
            if (type) fields['类型'] = type;
            if (level) fields['品阶/等级'] = level;
            if (effect) fields['效果'] = effect;
            const formatText = `\n- ${name}：类型=${type || '—'}，品阶=${level || '—'}，效果=${effect || '—'}`;
            allEntities.push({ name, fields, type: 'item', formatText });
        }

        // 打分过滤
        const entityContextText = (infoPlan || '') + '\n' + (outline || '');
        const filteredEntities = scoreAndFilterEntities(allEntities, entityContextText);
        const allChars = filteredEntities.filter(e => e.type === 'character').map(e => e.text).join('');
        const allFactions = filteredEntities.filter(e => e.type === 'faction').map(e => e.text).join('');
        const allLocs = filteredEntities.filter(e => e.type === 'location').map(e => e.text).join('');
        const allItems = filteredEntities.filter(e => e.type === 'item').map(e => e.text).join('');

        const sysPrompt = `你是一个网络小说作家。严格按照以下规则写作：

1. 每章≥2500字
2. 段落开头空两格
3. 对话驱动剧情
4. 禁止AI文：无排比、无抒情升华、无过度心理描写
5. 标点：破折号≤3处，感叹号≤3个，禁分号/省略号
6. 角色锁定：必须使用以下已有角色，严禁自创全新主角或核心配角`;

        let userContent = `【本章信息规划】${infoPlan.slice(0, 800)}\n`;
        userContent += `\n【本章大纲】${outline.slice(0, 800)}\n`;
        if (worldView) userContent += `\n【世界观】${worldView.slice(0, 500)}\n`;
        if (settingLib) userContent += `\n【设定库】${settingLib.slice(0, 1500)}\n`;
        if (writingStyle) userContent += `\n【文笔风格】${writingStyle.slice(0, 1000)}\n`;
        if (prevSummary) userContent += `\n【前文摘要】${prevSummary}\n`;
        userContent += `\n【人物状态】${allChars.slice(0, 2000)}\n`;
        if (allFactions) userContent += `\n【势力设定】${allFactions.slice(0, 500)}\n`;
        if (allLocs) userContent += `\n【地点设定】${allLocs.slice(0, 500)}\n`;
        if (allItems) userContent += `\n【物品功法】${allItems.slice(0, 500)}\n`;

        userContent += `\n请撰写第${n}章正文，输出完整 .md 格式。`;

        const result = await this.aiEngine.callAI(sysPrompt, userContent, undefined, 0.7, this.plugin.settings.maxOutput);
        return result.content || '';
    }

    private async generateAnalysis(project: string, volume: string, n: number, body: string): Promise<string> {
        const sysPrompt = `你是一位小说信息论分析师兼元素提取器。

1. **新元素提取**：逐段扫描正文，提取所有首次出现的专有名词级别新元素。
2. **信息论分析**：互信息断裂检测、自信息事件评估。

【输出格式】
UPDATE_CHARACTER: [[角色]] | 当前状态 | 新值
UPDATE_FORESHADOW: [[伏笔]] | 状态 | 已揭示
NEW_CHARACTER: 名 | 描述
NEW_LOCATION: 名 | 描述
NEW_FACTION: 名 | 描述
NEW_ITEM: 功法/物品/法宝名 | 描述
NEW_FORESHADOW: 内容 | 埋入章节 | 预期揭示
NEW_TIMELINE: 时间点 | 事件

【分析要求】
- 互信息断裂检测
- 自信息事件评估`;

        const userPrompt = `【正文】${body.slice(0, 5000)}\n\n请完成新元素提取和信息论分析。`;

        const result = await this.aiEngine.callAI(sysPrompt, userPrompt);
        return result.content || '';
    }

    private async executeSettlement(project: string, basePath: string, chapName: string, report: string, bodyText: string): Promise<void> {
        await this.settlementEngine.settle(project, basePath, chapName, report, bodyText);
    }

    private getVolumes(project: string): string[] {
        const volumes: string[] = [];
        const visited = new Set<string>();
        for (const f of this.app.vault.getFiles()) {
            const m = f.path.match(new RegExp(`${project}/(?:${SUBDIR_BODY_ROOT}|${SUBDIR_STEP_ROOT})/(第\d+卷)/`));
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

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
