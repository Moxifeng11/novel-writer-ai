import { App, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine } from './ai-engine';
import { findChapterFile, getChapterFileName, CHAPTER_FILE_TYPES } from './chapter-utils';
import { pjBodyDir, pjBodyFile, pjStepDir, pjStepFile, pjSettingLib, pjWorldview, pjCharsDir, pjForeshadowDB, pjLocsDir, pjFactionsDir, pjItemsDir, isInCharsDir } from '../shared/paths';
import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';
import { FileSystemPort, VaultMetaPort, ObsidianFileSystem, ObsidianVaultMeta } from '../shared/file-system-port';
import { NOTICE_ERROR, NOTICE_WARNING, NOTICE_CRITICAL, NOTICE_SUCCESS } from '../shared/thresholds';

export class ReviewAgent {
    private plugin: NovelWriterPlugin;
    private app: App;
    private aiEngine: AIEngine;
    private notifier: Notifier;
    private fs: FileSystemPort | null = null;
    private vaultMeta: VaultMetaPort | null = null;

    constructor(plugin: NovelWriterPlugin, notifier?: Notifier) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.aiEngine = plugin.aiEngine;
        this.notifier = notifier || NOOP_NOTIFIER;
    }

    /** 获取 FileSystemPort 实例（懒加载） */
    private getFS(): FileSystemPort {
        if (!this.fs) {
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

    /** 获取 VaultMetaPort 实例（懒加载） */
    private getVaultMeta(): VaultMetaPort {
        if (!this.vaultMeta) {
            this.vaultMeta = new ObsidianVaultMeta(this.app);
        }
        return this.vaultMeta;
    }

    async reviewChapter(project: string, chapterPath: string): Promise<void> {
        const activeFile = this.getVaultMeta().getAbstractFileByPath(chapterPath);
        if (!(activeFile instanceof TFile)) {
            this.notifier.showNotice('❌ 未找到章节文件', NOTICE_ERROR);
            return;
        }

        const hideProgress = this.notifier.showProgress?.('⏳ 收集上下文数据...');

        const bodyText = await this.getFS().read(chapterPath);

        let settingLib = '';
        try {
            // v4.0: 设定库已迁移到 01-世界架构/
            const sf = this.getVaultMeta().getAbstractFileByPath(pjSettingLib(project));
            if (sf instanceof TFile) settingLib = await this.getFS().read(pjSettingLib(project));
        } catch (e) { console.warn('[小说工坊] 操作失败:', e); }

        let worldView = '';
        try {
            const wf = this.getVaultMeta().getAbstractFileByPath(pjWorldview(project));
            if (wf instanceof TFile) worldView = await this.getFS().read(pjWorldview(project));
        } catch (e) { console.warn('[小说工坊] 操作失败:', e); }

        let allChars = '';
        for (const f of this.getVaultMeta().getFiles()) {
            if (isInCharsDir(project, f.path) && f.name !== '人物模板.md') {
                try {
                    const c = await this.getFS().read(f.path);
                    const fm = c.match(/^---\n([\s\S]*?)\n---/);
                    if (fm) {
                        const g = (k: string) => {
                            const x = fm[1].match(new RegExp(`${k}:\\s*["']?(.+?)["']?(\n|$)`));
                            return x ? x[1].trim() : '—';
                        };
                        allChars += `\n- ${f.name.replace('.md', '')}：状态=${g('当前状态')}，动机=${g('核心动机')}，能力=${g('金手指/特殊能力')}`;
                    }
                } catch (e) { console.warn('[小说工坊] 操作失败:', e); }
            }
        }

        let foreshadows = '';
        try {
            const ff = this.getVaultMeta().getAbstractFileByPath(pjForeshadowDB(project));
            if (ff instanceof TFile) {
                const fc = await this.getFS().read(pjForeshadowDB(project));
                const unrevealedSection = fc.match(/## 未回收伏笔[\s\S]*?(?=##|$)/)?.[0] || fc;
                foreshadows = unrevealedSection.slice(0, 2000);
            }
        } catch (e) { console.warn('[小说工坊] 操作失败:', e); }

        let previousChapter = '';
        try {
            // v4.0: 路径形如 .../03-大纲与章节/正文/第X卷/第Y章_正文.md
            const pathMatch = activeFile.path.match(/^(.*?)\/03-大纲与章节\/正文\/(第\d+卷)\/第(\d+)章_正文\.md$/);
            if (pathMatch) {
                const proj = pathMatch[1];
                const volume = pathMatch[2];
                const currentChapterNum = parseInt(pathMatch[3], 10);
                const volMatch = volume.match(/第(\d+)卷/);
                const volN = volMatch ? parseInt(volMatch[1], 10) : 0;
                if (currentChapterNum > 1 && volN > 0) {
                    const prevBodyDir = pjBodyDir(proj, volN);
                    const prevChapterFile = findChapterFile(this.getVaultMeta().getFiles(), prevBodyDir, CHAPTER_FILE_TYPES.body, this.app);
                    if (prevChapterFile && prevChapterFile.path.includes(`第${currentChapterNum - 1}章`)) {
                        previousChapter = await this.getFS().read(prevChapterFile.path);
                    } else {
                        // 精确按文件名查找上一章正文
                        const prevPath = pjBodyFile(proj, volN, currentChapterNum - 1);
                        const prevFile = this.getVaultMeta().getAbstractFileByPath(prevPath);
                        if (prevFile instanceof TFile) previousChapter = await this.getFS().read(prevPath);
                    }
                }
            }
        } catch (e) { console.warn('[小说工坊] 操作失败:', e); }

        hideProgress?.();

        if (!this.plugin.settings.apiKey) {
            this.notifier.showNotice('❌ 请先配置API密钥', NOTICE_ERROR);
            return;
        }

        const hideCheck = this.notifier.showProgress?.('⏳ 审查 Agent 正在分析...');

        const result = await this.aiEngine.reviewChapter(bodyText, {
            characters: allChars,
            settingLib: settingLib,
            previousChapter: previousChapter || undefined
        });

        hideCheck?.();

        if (result.error) {
            this.notifier.showNotice(`❌ 审查失败: ${result.error}`, NOTICE_CRITICAL);
            return;
        }

        // v4.0: 单章审查报告写入 03-大纲与章节/步骤结果/第N卷/第M章/
        const v4Match = activeFile.path.match(/^(.*?)\/03-大纲与章节\/正文\/第(\d+)卷\/第(\d+)章_正文\.md$/);
        if (!v4Match) {
            this.notifier.showNotice('❌ 无法确定章节目录（需在正文文件中执行审查）', NOTICE_ERROR);
            return;
        }

        const proj = v4Match[1];
        const volN = parseInt(v4Match[2], 10);
        const chapN = parseInt(v4Match[3], 10);
        const chapName = `第${chapN}章`;

        // 确保步骤结果目录存在
        const stepDir = pjStepDir(proj, volN, chapN);
        if (!this.getVaultMeta().getAbstractFileByPath(stepDir)) {
            try { await this.getFS().mkdir(stepDir); }
            catch (e) { console.warn('[小说工坊] 创建步骤目录失败:', stepDir, e); }
        }

        const reportPath = pjStepFile(proj, volN, chapN, CHAPTER_FILE_TYPES.continuityReview);
        const reportContent = `---
tags: [审查报告]
审查时间: ${new Date().toLocaleString()}
审查范围: 单章
---

# ${chapName} 连贯性审查报告

${result.content}

---

> ⚠️ 本报告由独立的审查 Agent 生成，不修改任何文件。
> 问题仅供参考，是否修改由作者决定。
`;

        let writeFailed = false;
        try {
            const existingReport = this.getVaultMeta().getAbstractFileByPath(reportPath);
            if (existingReport) {
                await this.getFS().delete(reportPath);
            }
            await this.getFS().write(reportPath, reportContent);
        } catch (e) {
            writeFailed = true;
            console.warn('[小说工坊] 审查报告写入失败:', e);
            this.notifier.showNotice('❌ 审查报告保存失败，请检查磁盘空间或文件权限', NOTICE_WARNING);
        }

        if (!writeFailed) {
            const savedFile = this.getVaultMeta().getAbstractFileByPath(reportPath);
            if (savedFile instanceof TFile) {
                await this.plugin.safeOpenFile(savedFile);
            }
            this.notifier.showNotice(`✅ 审查完成 → ${getChapterFileName(chapName, CHAPTER_FILE_TYPES.continuityReview)}`, NOTICE_WARNING);
        }
    }

    /**
     * 智能章节取样：开头 + 结尾，避免只看开头漏掉中后段问题
     */
    private sampleChapterContent(content: string, headChars = 1000, tailChars = 1000): { sampled: string; totalChars: number; isSampled: boolean } {
        const total = content.length;
        if (total <= headChars + tailChars + 200) {
            return { sampled: content, totalChars: total, isSampled: false };
        }
        const head = content.slice(0, headChars);
        const tail = content.slice(-tailChars);
        return {
            sampled: `${head}\n\n……【中间 ${total - headChars - tailChars} 字已省略】……\n\n${tail}`,
            totalChars: total,
            isSampled: true,
        };
    }

    /**
     * 整卷章节智能选样：章节多时分层抽样（首+尾+中间均匀），避免超长 prompt
     */
    private selectVolumeChapters(chapters: { path: string; content: string }[], maxChapters = 12): { selected: typeof chapters; skipped: number; isSampled: boolean } {
        if (chapters.length <= maxChapters) {
            return { selected: chapters, skipped: 0, isSampled: false };
        }
        const headCount = Math.ceil(maxChapters * 0.3);
        const tailCount = Math.ceil(maxChapters * 0.3);
        const middleCount = maxChapters - headCount - tailCount;
        const head = chapters.slice(0, headCount);
        const tail = chapters.slice(-tailCount);
        const middleStart = headCount;
        const middleEnd = chapters.length - tailCount;
        const middleChapters: typeof chapters = [];
        if (middleEnd > middleStart && middleCount > 0) {
            const step = (middleEnd - middleStart) / (middleCount + 1);
            for (let i = 1; i <= middleCount; i++) {
                const idx = Math.floor(middleStart + step * i);
                if (idx >= middleStart && idx < middleEnd) {
                    middleChapters.push(chapters[idx]);
                }
            }
        }
        const selected = [...head, ...middleChapters, ...tail];
        return { selected, skipped: chapters.length - selected.length, isSampled: true };
    }

    async reviewVolume(project: string, volume: string): Promise<void> {
        const hideProgressVol = this.notifier.showProgress?.('⏳ 收集整卷上下文数据...');

        // v4.0: 整卷正文位于 03-大纲与章节/正文/第X卷/
        const volMatchN = volume.match(/第(\d+)卷/);
        const volN = volMatchN ? parseInt(volMatchN[1], 10) : 0;
        const volBodyDir = volN > 0 ? pjBodyDir(project, volN) : `${project}/03-大纲与章节/正文/${volume}`;
        const chapterFiles = this.getVaultMeta().getFiles().filter(f =>
            f.path.startsWith(`${volBodyDir}/`) &&
            f.name.includes(CHAPTER_FILE_TYPES.body) &&
            f.name.endsWith('.md')
        );

        if (chapterFiles.length === 0) {
            this.notifier.showNotice('❌ 未找到该卷的章节文件', NOTICE_ERROR);
            return;
        }

        const chapterContents: { path: string; content: string }[] = [];
        let readFailed = 0;
        for (const file of chapterFiles) {
            try {
                const content = await this.getFS().read(file.path);
                chapterContents.push({ path: file.path, content });
            } catch (e) {
                console.warn('[ReviewAgent] 章节读取失败:', file.path, e);
                readFailed++;
            }
        }
        if (readFailed > 0) {
            this.notifier.showNotice(`⚠️ 整卷审查：${readFailed}/${chapterFiles.length} 章读取失败，结果可能不完整`, NOTICE_CRITICAL);
        }

        const { selected: selectedChapters, skipped: skippedChapters, isSampled: chapterSampled } = this.selectVolumeChapters(chapterContents);
        if (chapterSampled) {
            this.notifier.showNotice(`ℹ️ 该卷共 ${chapterContents.length} 章，已分层抽样 ${selectedChapters.length} 章进行审查（首+中+尾）`, NOTICE_WARNING);
        }

        const perChapterChars = selectedChapters.length <= 6 ? 1000 : selectedChapters.length <= 10 ? 700 : 500;

        let settingLib = '';
        try {
            const sf = this.getVaultMeta().getAbstractFileByPath(pjSettingLib(project));
            if (sf instanceof TFile) settingLib = await this.getFS().read(sf.path);
        } catch (e) { console.warn('[小说工坊] 操作失败:', e); }

        let worldView = '';
        try {
            const wf = this.getVaultMeta().getAbstractFileByPath(pjWorldview(project));
            if (wf instanceof TFile) worldView = await this.getFS().read(wf.path);
        } catch (e) { console.warn('[小说工坊] 操作失败:', e); }

        let allChars = '';
        for (const f of this.getVaultMeta().getFiles()) {
            if (isInCharsDir(project, f.path) && f.name !== '人物模板.md') {
                try {
                    const c = await this.getFS().read(f.path);
                    const fm = c.match(/^---\n([\s\S]*?)\n---/);
                    if (fm) {
                        const g = (k: string) => {
                            const x = fm[1].match(new RegExp(`${k}:\\s*["']?(.+?)["']?(\n|$)`));
                            return x ? x[1].trim() : '—';
                        };
                        allChars += `\n- ${f.name.replace('.md', '')}：状态=${g('当前状态')}，动机=${g('核心动机')}`;
                    }
                } catch (e) { console.warn('[小说工坊] 操作失败:', e); }
            }
        }

        hideProgressVol?.();

        if (!this.plugin.settings.apiKey) {
            this.notifier.showNotice('❌ 请先配置API密钥', NOTICE_ERROR);
            return;
        }

        const hideCheckVol = this.notifier.showProgress?.('⏳ 审查 Agent 正在分析整卷连贯性...');

        const systemPrompt = `你是一位严谨的小说连贯性审查员，专门审查整卷的连贯性。

审查维度：
1. 设定一致性：整卷中的设定是否前后一致
2. 人物成长弧线：人物发展是否合理
3. 剧情连贯性：章节之间是否衔接
4. 伏笔逻辑：伏笔的埋设和回收是否合理

注意：
- 章节内容为「开头 + 结尾」智能取样（中间省略），请重点关注章节首尾的承接、收束、伏笔回收
${chapterSampled ? '- 章节较多时采用分层抽样（首章+尾章+中间均匀分布），请重点关注整体趋势和关键节点' : ''}

输出格式：使用Markdown格式，分章节列出问题`;

        const userPrompt = `请审查以下整卷的连贯性。

【卷名】${volume}
【总章节数】${chapterContents.length}
【参与审查章节】${selectedChapters.length}${chapterSampled ? '（分层抽样）' : '（全量）'}

【设定库】${settingLib.slice(0, 2000)}
【世界观】${worldView.slice(0, 1000)}
【人物状态】${allChars.slice(0, 2000)}

【章节内容】
${selectedChapters.map((c, i) => {
    const s = this.sampleChapterContent(c.content, perChapterChars, perChapterChars);
    const realIdx = chapterContents.findIndex(cc => cc.path === c.path) + 1;
    return `## 第${realIdx}章（约${s.totalChars}字${s.isSampled ? '，首尾取样' : ''}）\n${s.sampled}`;
}).join('\n\n')}`;

        const result = await this.aiEngine.callAI(systemPrompt, userPrompt, undefined, 0.3, 8192);

        hideCheckVol?.();

        if (result.error) {
            this.notifier.showNotice(`❌ 审查失败: ${result.error}`, NOTICE_CRITICAL);
            return;
        }

        // v4.0: 整卷审查报告写入正文卷目录下，避免污染根目录
        const volBodyRoot = volN > 0 ? pjBodyDir(project, volN) : `${project}/03-大纲与章节/正文/${volume}`;
        const reportPath = `${volBodyRoot}/${getChapterFileName(volume, CHAPTER_FILE_TYPES.continuityReview)}`;
        if (!this.getVaultMeta().getAbstractFileByPath(volBodyRoot)) {
            try { await this.getFS().mkdir(volBodyRoot); }
            catch (e) { console.warn('[小说工坊] 创建卷正文目录失败:', volBodyRoot, e); }
        }
        const reportContent = `---
tags: [审查报告]
审查时间: ${new Date().toLocaleString()}
审查范围: ${volume}（${selectedChapters.length}/${chapterContents.length} 章${chapterSampled ? '，分层抽样' : '，全量'}）
---

# ${volume} 整卷连贯性审查报告

${result.content}

---

> ⚠️ 本报告由独立的审查 Agent 生成，不修改任何文件。
> ${chapterSampled ? '⚠️ 章节较多时采用分层抽样（首+中+尾），结果仅供趋势参考，建议对存疑章节做单章详查。' : ''}
> 问题仅供参考，是否修改由作者决定。
`;

        let writeFailed = false;
        try {
            const existingVolumeReport = this.getVaultMeta().getAbstractFileByPath(reportPath);
            if (existingVolumeReport) {
                await this.getFS().delete(reportPath);
            }
            await this.getFS().write(reportPath, reportContent);
        } catch (e) {
            writeFailed = true;
            console.warn('[小说工坊] 分卷审查报告写入失败:', e);
            this.notifier.showNotice('❌ 分卷审查报告保存失败，请检查磁盘空间', NOTICE_WARNING);
        }

        if (!writeFailed) {
            const savedFile = this.getVaultMeta().getAbstractFileByPath(reportPath);
            if (savedFile instanceof TFile) {
                await this.plugin.safeOpenFile(savedFile);
            }
            this.notifier.showNotice(`✅ 整卷审查完成 → ${getChapterFileName(volume, CHAPTER_FILE_TYPES.continuityReview)}`, NOTICE_WARNING);
        }
    }
}
