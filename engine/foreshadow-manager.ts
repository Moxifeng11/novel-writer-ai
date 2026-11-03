import { App, TFile, Vault } from 'obsidian';
import { splitTableCells } from '@/shared/chapter-table';
import { entityDir } from '@/shared/entity-reader';
import NovelWriterPlugin from '@/main';
import { getNextRowNum, hasTableSeparator, appendAfterSeparator, moveForeshadowToRevealed, mkdirp, showSuccess, showError } from '@/utils/helpers';
import { detectProjects } from './context-manager';
import { CHAPTER_FILE_TYPES } from './chapter-utils';
import { getInfoDebtMax, FORCED_REVEAL_OVER_20, FORCED_REVEAL_OVER_15, FORCED_REVEAL_OVER_10, FORCED_REVEAL_OVER_5, FORCED_REVEAL_WINDOW_FORWARD, FORCED_REVEAL_WINDOW_BACKWARD, FORESHADOW_APPROACHING_CHAPTERS, NOTICE_ERROR, NOTICE_SUCCESS } from '@/shared/thresholds';
import { pjForeshadowDB, pjForeshadowTracker, pjTimelineDir, pjInfoDebtBoard, pjControlDir, isInCharsDir } from '@/shared/paths';
import type { Notifier } from '@/shared/types';
import { withWriteLock } from '@/shared/write-lock';
import { NOOP_NOTIFIER } from '@/shared/types';
import { FileSystemPort, VaultMetaPort, ObsidianFileSystem, ObsidianVaultMeta } from '@/shared/file-system-port';
import { VectorEnhancer } from './vector-enhancer';
import { createLogger } from '@/shared/logger';
import { getDegradationNotifier } from '@/shared/degradation-notifier';


const log = createLogger('ForeshadowManager');
/**
 * 伏笔管理器：登记、追踪与回收提示。
 */
export class ForeshadowManager {
    private plugin: NovelWriterPlugin;
    private notifier: Notifier;
    private app: App;
    private fs: FileSystemPort | null = null;
    private vaultMeta: VaultMetaPort | null = null;
    public vectorEnhancer: VectorEnhancer | null = null;
    private tracker: ForeshadowTracker | null = null;

    constructor(plugin: NovelWriterPlugin, notifier?: Notifier, vectorEnhancer?: VectorEnhancer) {
        this.notifier = notifier || NOOP_NOTIFIER;
        this.plugin = plugin;
        this.app = plugin.app;
        if (vectorEnhancer) {
            this.vectorEnhancer = vectorEnhancer;
        }
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

    /**
     * 健壮解析伏笔表格：自动检测表头，兼容列顺序和数量变化
     */
    private parseForeshadowTable(content: string): ForeshadowItem[] {
        return parseForeshadowTableContent(content);
    }

    /** 旧格式回退解析（兼容无表头的表格） */
    private parseForeshadowTableFallback(content: string): ForeshadowItem[] {
        return parseForeshadowTableFallbackLegacy(content);
    }

    /**
     * 刷新信息债。
     */
    async refreshInfoDebt(): Promise<void> {
        const projects = await this.detectProjects();
        
        for (const project of projects) {
            await this.generateInfoDebtBoard(project);
        }
    }

    /**
     * 扫描可识别项目。
     * @returns 项目数组
     */
    async detectProjects(): Promise<string[]> {
        return detectProjects(this.app);
    }

    /**
     * 生成信息债看板。
     *
     * @param project - 项目（路径或对象）
     */
    async generateInfoDebtBoard(project: string): Promise<void> {
        let unrevealed = 0, revealed = 0, abandoned = 0;
        
        try {
            const fp = pjForeshadowDB(project);
            const ff = this.getVaultMeta().getAbstractFileByPath(fp);
            
            if (ff instanceof TFile) {
                const content = await this.getFS().read(fp);
                const items = this.parseForeshadowTable(content);
                for (const item of items) {
                    const s = item.status || '';
                    if (s.includes('未揭示') || s === '') unrevealed++;
                    else if (s.includes('已揭示') || s.includes('揭示')) revealed++;
                    else abandoned++;
                }
            }
        } catch (e) {
            log.warn('Failed to parse foreshadow file:', e);
        }

        const chapFiles = this.getVaultMeta().getFiles().filter(f => 
            f.path.startsWith(project + '/') && 
            f.path.includes(CHAPTER_FILE_TYPES.body) && 
            f.name.endsWith('.md')
        );
        
        const completedChaps = new Set<string>();
        for (const f of chapFiles) {
            try {
                const cache = this.app.metadataCache.getFileCache(f);
                const fm = cache?.frontmatter;
                const status = fm?.status;
                if (status === 'written' || status === 'settled') {
                    completedChaps.add(f.name);
                }
            } catch (e) { log.warn('[小说工坊] 操作失败:', e); }
        }

        const charFiles = this.getVaultMeta().getFiles().filter(f => 
            f.path.startsWith(entityDir(project, 'characters')) && 
            f.name.endsWith('.md') && 
            f.name !== '人物模板.md'
        );
        
        let charStateOk = 0, charStateMissing = 0;
        for (const f of charFiles) {
            try {
                const c = await this.getFS().read(f.path);
                const fm = c.match(/^---\n([\s\S]*?)\n---/);
                if (fm && /当前状态:\s*\S/m.test(fm[1])) charStateOk++;
                else charStateMissing++;
            } catch (e) {
                log.warn('[ForeshadowManager] 读取人物状态失败:', e);
                this.notifier.showNotice('[ForeshadowManager] 数据读取失败，部分功能可能受限');
                charStateMissing++;
            }
        }

        const debtRatio = Math.min(getInfoDebtMax(), unrevealed);

        const debtContent = `---
tags: [看板]
---

# 📊 信息债看板

> 自动刷新时间：${new Date().toLocaleString()}

## 章节进度
- 总章节文件：${chapFiles.length}
- 已完成正文：${completedChaps.size}

## 伏笔态势
- 未揭示伏笔：${unrevealed} ${unrevealed > 5 ? '⚠️ 偏高（建议尽快回收）' : '✅ 正常'}
- 已揭示伏笔：${revealed}
- 已废弃：${abandoned}

## 健康度
- 信息债等级：${'🟢'.repeat(Math.max(0, 15 - debtRatio))}${'🔴'.repeat(debtRatio)} (${debtRatio}/15)
  - 未揭示 ≤ 5: 🟢 健康
  - 未揭示 6-10: 🟡 需注意
  - 未揭示 ≥ 11: 🔴 信息债过高

## 人物卡状态
- 已填写当前状态：${charStateOk}
- 状态待更新：${charStateMissing}

## 提醒
${unrevealed > 10 ? '- ⚠️ 未揭示伏笔过多（信息债 🔴），建议优先回收' : unrevealed > 5 ? '- ⚡ 未揭示伏笔中等（信息债 🟡），注意穿插回收' : '- ✅ 伏笔生态健康'}
${charStateMissing > 0 ? `- ⚠️ ${charStateMissing}个人物未填写当前状态` : ''}
`;

        const debtPath = pjInfoDebtBoard(project);
        
        try {
            const dir = pjControlDir(project);
            if (!this.getVaultMeta().getAbstractFileByPath(dir)) {
                await this.getFS().mkdir(dir);
            }
            
            const existingDebt = this.getVaultMeta().getAbstractFileByPath(debtPath);
            if (existingDebt) {
                await this.getFS().delete(debtPath);
            }
            
            await this.getFS().write(debtPath, debtContent);
        } catch (e) {
            log.warn('Failed to write info debt board:', e);
            this.notifier.showNotice('⚠️ 信息债看板更新失败', NOTICE_ERROR);
        }
    }

    /**
     * 读取未揭示伏笔。
     *
     * @param project - 项目（路径或对象）
     * @returns {items,count}
     */
    async getUnrevealedForeshadows(project: string): Promise<{ items: ForeshadowItem[], count: number }> {
        const items: ForeshadowItem[] = [];
        
        try {
            const fp = pjForeshadowDB(project);
            const ff = this.getVaultMeta().getAbstractFileByPath(fp);
            
            if (ff instanceof TFile) {
                const content = await this.getFS().read(fp);
                const all = this.parseForeshadowTable(content);
                for (const item of all) {
                    const s = item.status || '';
                    if (s.includes('未揭示') || s === '') {
                        items.push(item);
                    }
                }
            }
        } catch (e) {
            log.warn('Failed to get unrevealed foreshadows:', e);
        }
        
        return { items, count: items.length };
    }

    /**
     * 计算强制揭示项。
     *
     * @param project - 项目（路径或对象）
     * @param currentChapter - 参数
     * @returns 名称数组
     */
    async calculateForceReveal(project: string, currentChapter?: number): Promise<string[]> {
        const { items, count } = await this.getUnrevealedForeshadows(project);

        const isInRevealWindow = (f: ForeshadowItem): boolean => {
            if (currentChapter === undefined || currentChapter <= 0) return true;
            const plannedMatch = (f.plannedReveal || '').match(/第(\d+)章/);
            if (!plannedMatch) return false;
            const plannedChap = parseInt(plannedMatch[1], 10);
            const diff = plannedChap - currentChapter;
            return diff >= -FORCED_REVEAL_WINDOW_BACKWARD && diff <= FORCED_REVEAL_WINDOW_FORWARD;
        };

        const score = (f: ForeshadowItem): number => {
            let impScore = 2;
            const imp = (f.importance || '中').toString();
            if (imp.includes('高') || imp.includes('重要') || imp.includes('关键')) impScore = 3;
            else if (imp.includes('低') || imp.includes('一般')) impScore = 1;

            let urgencyScore = 1;
            if (currentChapter !== undefined && currentChapter > 0) {
                const plannedMatch = (f.plannedReveal || '').match(/第(\d+)章/);
                if (plannedMatch) {
                    const plannedChap = parseInt(plannedMatch[1], 10);
                    const diff = plannedChap - currentChapter;
                    if (diff < 0) urgencyScore = 10;
                    else if (diff <= 2) urgencyScore = 8;
                    else if (diff <= 5) urgencyScore = 5;
                    else if (diff <= 10) urgencyScore = 3;
                    else urgencyScore = 1;
                } else if (!f.plannedReveal || f.plannedReveal.includes('待定')) {
                    urgencyScore = 2;
                }
            }

            return impScore * 3 + urgencyScore * 2;
        };

        const candidates = items.filter(isInRevealWindow);
        const sorted = [...candidates].sort((a, b) => score(b) - score(a));

        let maxReveal = 0;
        if (count > 20) maxReveal = FORCED_REVEAL_OVER_20;
        else if (count > 15) maxReveal = FORCED_REVEAL_OVER_15;
        else if (count > 10) maxReveal = FORCED_REVEAL_OVER_10;
        else if (count > 5) maxReveal = FORCED_REVEAL_OVER_5;

        const revealCount = Math.min(maxReveal, sorted.length);
        return sorted.slice(0, revealCount).map(i => i.name);
    }

    /**
     * 揭示伏笔：将伏笔库中指定伏笔的状态改为"已揭示"
     * v4.27 修订：单线程不等于无竞态——多个入口（结算/分析报告/协同）在 await 处交错
     * 会对同一文件做读-改-写。本方法已接入 withWriteLock。
     * @param project - 项目（路径或对象）
     * @param foreshadowNames - 伏笔名称列表
     * @param chapterName - 章节名
     */
    async revealForeshadows(project: string, foreshadowNames: string[], chapterName: string): Promise<void> {
        try {
            const fp = pjForeshadowDB(project);
            const ff = this.getVaultMeta().getAbstractFileByPath(fp);

            if (!(ff instanceof TFile)) return;

            // P1-1（v4.27）：整段读-改-写进锁，避免与结算/分析报告互相覆盖
            let changed = false;
            await withWriteLock(fp, async () => {
                let content = await this.getFS().read(fp);
                for (const name of foreshadowNames) {
                    const newContent = this.moveForeshadowToRevealed(content, name, chapterName);
                    if (newContent !== content) {
                        content = newContent;
                        changed = true;
                    }
                }
                if (changed) await this.getFS().write(fp, content);
            });

            if (changed) {
                this.notifier.showNotice(`✅ 已揭示 ${foreshadowNames.length} 个伏笔`, NOTICE_SUCCESS);
                await this.refreshInfoDebt();
            }
        } catch (e) {
            log.warn('Failed to reveal foreshadows:', e);
        }
    }

    /**
     * 新增伏笔。
     *
     * @param project - 项目（路径或对象）
     * @param name - 名称
     * @param chapter - 章节
     * @param importance - 重要度
     * @param plannedReveal - 计划揭示位置
     */
    async addForeshadow(project: string, name: string, chapter: string, importance: string = '中', plannedReveal: string = '待定'): Promise<void> {
        try {
            const fp = pjForeshadowDB(project);
            const ffRaw = this.getVaultMeta().getAbstractFileByPath(fp);
            const ff = ffRaw instanceof TFile ? ffRaw : null;
            let content = '';
            
            if (ff) {
                content = await this.getFS().read(fp);
            }

            const newRow = `| ${getNextRowNum(content)} | ${name} | ${importance} | ${chapter} | ${plannedReveal} | 未揭示 |`;

            if (ff && hasTableSeparator(content)) {
                content = appendAfterSeparator(content, newRow);
                // P1-1：锁内重读后再追加，避免 await 期间伏笔库被结算改动后整篇覆盖
                await withWriteLock(fp, async () => {
                    const fresh = await this.getFS().read(fp);
                    const next = hasTableSeparator(fresh)
                        ? appendAfterSeparator(fresh, newRow)
                        : fresh;
                    await this.getFS().write(fp, next);
                    content = next;
                });
            } else {
                await mkdirp(this.app, pjTimelineDir(project));
                content = `# 伏笔库\n\n| # | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 当前状态 |\n|---|---------|---------|---------|---------|---------|\n${newRow}\n`;
                await withWriteLock(fp, async () => {
                    await this.getFS().write(fp, content);
                });
            }
            
            await this.refreshInfoDebt();
        } catch (e) {
            log.warn('Failed to add foreshadow:', e);
        }
    }

    private moveForeshadowToRevealed(content: string, name: string, revealChapter: string): string {
        const result = moveForeshadowToRevealed(content, name, revealChapter);
        return result !== null ? result : content;
    }

    // ==================== 增强：伏笔追踪器 ====================

    /**
     * 自动识别伏笔。
     *
     * @param text - 文本内容
     * @param chapterIndex - 章节索引
     * @param options - 配置项
     * @returns 识别结果
     */
    async autoDetect(
        text: string,
        chapterIndex: number,
        options?: { useVector?: boolean; existingItems?: TrackedForeshadowItem[] }
    ): Promise<TrackedForeshadowItem[]> {
        if (!text || text.length === 0) return [];

        const useVector = options?.useVector !== false;
        const existingItems = options?.existingItems || [];

        const candidates: TrackedForeshadowItem[] = [];
        const paragraphs = text.split(/\r?\n\r?\n/).map(p => p.trim()).filter(p => p.length > 0);

        for (let i = 0; i < paragraphs.length; i++) {
            const para = paragraphs[i];
            const detected = this.detectForeshadowInParagraph(para, chapterIndex, i);
            candidates.push(...detected);
        }

        const uniqueCandidates = await this.deduplicateCandidates(candidates, existingItems, useVector);

        if (useVector && this.vectorEnhancer) {
            try {
                const available = await this.vectorEnhancer.isAvailable();
                if (available) {
                    return await this.enhanceWithVector(uniqueCandidates);
                }
                // A3: 已开启向量增强但模型不可用，原先静默回退为纯关键词结果。
                // 用 info 级上报（不弹 Notice，避免逐章噪音），保留可追溯的降级痕迹。
                getDegradationNotifier().notify({
                    source: 'vector',
                    dimension: 'foreshadow',
                    from: 'vector',
                    to: 'keyword_stats',
                    reason: this.vectorEnhancer.getUnavailableReason() || '向量模型不可用',
                    severity: 'info',
                    recoverable: true,
                });
            } catch (e) {
                log.warn('[ForeshadowManager] 向量增强失败，使用纯关键词结果', e);
            }
        }

        return uniqueCandidates;
    }

    private detectForeshadowInParagraph(
        para: string,
        chapterIndex: number,
        paragraphIndex: number
    ): TrackedForeshadowItem[] {
        const results: TrackedForeshadowItem[] = [];
        const seen = new Set<string>();

        const objectPatterns = [
            /那东西/g, /这枚[^，。；！？\s]{1,6}/g, /那把[^，。；！？\s]{1,6}/g,
            /此物/g, /这物件/g, /那块[^，。；！？\s]{1,6}/g, /这个[^，。；！？\s]{1,4}/g,
        ];
        for (const pattern of objectPatterns) {
            let match;
            while ((match = pattern.exec(para)) !== null) {
                const content = match[0];
                if (!seen.has(content)) {
                    seen.add(content);
                    const excerpt = this.extractExcerpt(para, content);
                    results.push({
                        id: `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                        content: excerpt,
                        category: 'object',
                        importance: 'medium',
                        plantedChapter: chapterIndex,
                        plantedLocation: `第${paragraphIndex + 1}段`,
                        status: 'planted',
                        confidence: 0.6,
                        autoDetected: true,
                    });
                }
            }
        }

        const charPatterns = [
            /神秘人/g, /黑衣人/g, /白衣人/g, /面具人/g, /斗篷人/g,
            /传说中的[^，。；！？\s]{1,6}/g, /身份不明的[^，。；！？\s]{1,4}/g,
            /来历不明/g, /身份成谜/g, /不知来历/g,
        ];
        for (const pattern of charPatterns) {
            let match;
            while ((match = pattern.exec(para)) !== null) {
                const content = match[0];
                if (!seen.has(content)) {
                    seen.add(content);
                    const excerpt = this.extractExcerpt(para, content);
                    results.push({
                        id: `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                        content: excerpt,
                        category: 'character',
                        importance: 'medium',
                        plantedChapter: chapterIndex,
                        plantedLocation: `第${paragraphIndex + 1}段`,
                        status: 'planted',
                        confidence: 0.7,
                        autoDetected: true,
                    });
                }
            }
        }

        const settingPatterns = [
            /据说/g, /传闻/g, /没有人知道/g, /传说/g, /老一辈常说/g,
            /世人皆知/g, /无人知晓/g, /谁也不知道/g,
        ];
        for (const pattern of settingPatterns) {
            let match;
            while ((match = pattern.exec(para)) !== null) {
                const content = match[0];
                if (!seen.has(content)) {
                    seen.add(content);
                    const excerpt = this.extractExcerpt(para, content);
                    results.push({
                        id: `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                        content: excerpt,
                        category: 'setting',
                        importance: 'medium',
                        plantedChapter: chapterIndex,
                        plantedLocation: `第${paragraphIndex + 1}段`,
                        status: 'planted',
                        confidence: 0.5,
                        autoDetected: true,
                    });
                }
            }
        }

        const eventPatterns = [
            /总有一天/g, /到时候/g, /三年后/g, /五年后/g, /十年后/g,
            /那件事/g, /当年的事/g, /那件秘密/g, /那个约定/g,
        ];
        for (const pattern of eventPatterns) {
            let match;
            while ((match = pattern.exec(para)) !== null) {
                const content = match[0];
                if (!seen.has(content)) {
                    seen.add(content);
                    const excerpt = this.extractExcerpt(para, content);
                    results.push({
                        id: `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                        content: excerpt,
                        category: 'event',
                        importance: 'high',
                        plantedChapter: chapterIndex,
                        plantedLocation: `第${paragraphIndex + 1}段`,
                        status: 'planted',
                        confidence: 0.65,
                        autoDetected: true,
                    });
                }
            }
        }

        return results;
    }

    private extractExcerpt(paragraph: string, keyword: string): string {
        const idx = paragraph.indexOf(keyword);
        if (idx === -1) return paragraph.slice(0, 100);
        const start = Math.max(0, idx - 25);
        const end = Math.min(paragraph.length, idx + keyword.length + 35);
        let excerpt = paragraph.slice(start, end);
        if (start > 0) excerpt = '...' + excerpt;
        if (end < paragraph.length) excerpt = excerpt + '...';
        return excerpt;
    }

    private async deduplicateCandidates(
        candidates: TrackedForeshadowItem[],
        existingItems: TrackedForeshadowItem[],
        useVector: boolean
    ): Promise<TrackedForeshadowItem[]> {
        if (candidates.length === 0) return [];
        if (existingItems.length === 0) return candidates;

        const result: TrackedForeshadowItem[] = [];

        if (useVector && this.vectorEnhancer) {
            try {
                const available = await this.vectorEnhancer.isAvailable();
                if (available) {
                    for (const candidate of candidates) {
                        let isDuplicate = false;
                        const candidateVec = await this.vectorEnhancer.embedText(candidate.content);
                        for (const existing of existingItems) {
                            if (!existing.vector) continue;
                            const sim = this.vectorEnhancer.cosineSimilarity(candidateVec, existing.vector);
                            if (sim > 0.8) {
                                isDuplicate = true;
                                break;
                            }
                        }
                        if (!isDuplicate) {
                            candidate.vector = candidateVec;
                            result.push(candidate);
                        }
                    }
                    return result;
                }
                // A3: 向量去重不可用 → 静默降级为文本去重，同样补 info 级降级痕迹。
                getDegradationNotifier().notify({
                    source: 'vector',
                    dimension: 'foreshadow',
                    from: 'vector',
                    to: 'text_similarity',
                    reason: this.vectorEnhancer.getUnavailableReason() || '向量模型不可用',
                    severity: 'info',
                    recoverable: true,
                });
            } catch (e) {
                log.warn('[ForeshadowManager] 向量去重失败，降级为文本去重', e);
            }
        }

        for (const candidate of candidates) {
            let isDuplicate = false;
            for (const existing of existingItems) {
                if (candidate.content === existing.content) {
                    isDuplicate = true;
                    break;
                }
                if (this.textSimilarity(candidate.content, existing.content) > 0.7) {
                    isDuplicate = true;
                    break;
                }
            }
            if (!isDuplicate) {
                result.push(candidate);
            }
        }

        return result;
    }

    /**
     * v6.3: 伏笔去重相似度。
     * 原实现为「单字符集合 Jaccard」——中文短句因共用「的/了/他」等高频字而虚高，
     * 配合 0.7 阈值易把不同伏笔误判为重复而丢弃（例如同一组字不同语序会被判为 1.0）。
     * 改为「字符 bigram 集合的 Dice 系数」：bigram 保留局部词序；Dice 的分母是两侧集合大小之和，
     * 等价于长度归一化——既能命中「仅个别字之差」的近重复，又能压低「长度悬殊但共享字多」的虚高
     * （相比 bigram Jaccard，Dice 对个别字差异更宽容，不至于让近重复跌破 0.7 阈值）。
     */
    private textSimilarity(a: string, b: string): number {
        if (!a || !b) return 0;
        const A = a.replace(/\s+/g, '');
        const B = b.replace(/\s+/g, '');
        if (!A || !B) return 0;

        const bigrams = (s: string): Set<string> => {
            const set = new Set<string>();
            if (s.length === 1) {
                set.add(s);
                return set;
            }
            for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
            return set;
        };

        const setA = bigrams(A);
        const setB = bigrams(B);
        let intersection = 0;
        for (const gram of setA) {
            if (setB.has(gram)) intersection++;
        }
        const denominator = setA.size + setB.size;
        return denominator > 0 ? (2 * intersection) / denominator : 0;
    }

    private async enhanceWithVector(candidates: TrackedForeshadowItem[]): Promise<TrackedForeshadowItem[]> {
        if (!this.vectorEnhancer || candidates.length === 0) return candidates;

        const foreshadowReference = [
            '这是一处伏笔，暗示后续剧情发展',
            '神秘的物件，将来会发挥重要作用',
            '人物身份不明，后续会揭示真相',
            '传说中的秘密，终将被揭开',
            '暗示未来发生的重大事件',
            '隐晦的铺垫，为后续剧情埋伏笔',
            '这件东西不简单，以后会有用',
        ];

        const result: TrackedForeshadowItem[] = [];

        for (const candidate of candidates) {
            try {
                let maxSim = 0;
                const candidateVec = await this.vectorEnhancer.embedText(candidate.content);
                for (const ref of foreshadowReference) {
                    const refVec = await this.vectorEnhancer.embedText(ref);
                    const sim = this.vectorEnhancer.cosineSimilarity(candidateVec, refVec);
                    if (sim > maxSim) maxSim = sim;
                }
                candidate.vector = candidateVec;
                candidate.confidence = Math.min(0.95, candidate.confidence + maxSim * 0.2);
                result.push(candidate);
            } catch (e) {
                result.push(candidate);
            }
        }

        return result.filter(c => c.confidence >= 0.4);
    }

    /**
     * 取待回收伏笔。
     *
     * @param currentChapter - 当前章节
     * @param options - 配置项
     * @returns 伏笔列表
     */
    getPendingResolutions(
        currentChapter: number,
        options?: { minImportance?: 'low' | 'medium' | 'high'; overdueOnly?: boolean }
    ): TrackedForeshadowItem[] {
        if (!this.tracker) return [];

        const minImportance = options?.minImportance || 'low';
        const overdueOnly = options?.overdueOnly || false;

        const importanceRank: Record<string, number> = { low: 1, medium: 2, high: 3 };
        const minRank = importanceRank[minImportance];

        return this.tracker.items.filter(item => {
            if (item.status === 'resolved') return false;
            if (importanceRank[item.importance] < minRank) return false;
            if (overdueOnly) {
                const chaptersPassed = currentChapter - item.plantedChapter;
                if (chaptersPassed < 10) return false;
            }
            return true;
        }).sort((a, b) => {
            const impDiff = importanceRank[b.importance] - importanceRank[a.importance];
            if (impDiff !== 0) return impDiff;
            return a.plantedChapter - b.plantedChapter;
        });
    }

    /**
     * 读取逾期伏笔。
     *
     * @param currentChapter - 当前章节
     * @param thresholdChapters - 阈值章数
     * @returns 伏笔数组
     */
    getOverdueForeshadows(currentChapter: number, thresholdChapters: number = 15): TrackedForeshadowItem[] {
        if (!this.tracker) return [];

        return this.tracker.items.filter(item => {
            if (item.status === 'resolved') return false;
            const chaptersPassed = currentChapter - item.plantedChapter;
            return chaptersPassed >= thresholdChapters;
        }).sort((a, b) => {
            const aOverdue = currentChapter - a.plantedChapter;
            const bOverdue = currentChapter - b.plantedChapter;
            return bOverdue - aOverdue;
        });
    }

    /**
     * 标记伏笔已回收。
     *
     * @param id - 标识
     * @param chapter - 章节
     * @param way - 参数
     */
    markResolved(id: string, chapter: number, way?: string): void {
        if (!this.tracker) return;
        const item = this.tracker.items.find(i => i.id === id);
        if (item) {
            item.status = 'resolved';
            item.resolvedChapter = chapter;
            if (way) item.resolvedWay = way;
            this.tracker.lastUpdated = new Date().toISOString();
            this.tracker.version++;
        }
    }

    /**
     * 新增追踪项。
     *
     * @param item - 条目
     * @returns 追踪项
     */
    addItem(item: Omit<TrackedForeshadowItem, 'id' | 'autoDetected' | 'confidence'>): TrackedForeshadowItem {
        if (!this.tracker) {
            this.tracker = {
                items: [],
                lastUpdated: new Date().toISOString(),
                version: 1,
            };
        }

        const newItem: TrackedForeshadowItem = {
            ...item,
            id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            autoDetected: false,
            confidence: 1.0,
        };

        this.tracker.items.push(newItem);
        this.tracker.lastUpdated = new Date().toISOString();
        this.tracker.version++;

        return newItem;
    }

    /**
     * 移除追踪项。
     *
     * @param id - 标识
     */
    removeItem(id: string): void {
        if (!this.tracker) return;
        const idx = this.tracker.items.findIndex(i => i.id === id);
        if (idx !== -1) {
            this.tracker.items.splice(idx, 1);
            this.tracker.lastUpdated = new Date().toISOString();
            this.tracker.version++;
        }
    }

    /**
     * 更新追踪项。
     *
     * @param id - 标识
     * @param updates - 更新字段
     */
    updateItem(id: string, updates: Partial<TrackedForeshadowItem>): void {
        if (!this.tracker) return;
        const item = this.tracker.items.find(i => i.id === id);
        if (item) {
            Object.assign(item, updates);
            this.tracker.lastUpdated = new Date().toISOString();
            this.tracker.version++;
        }
    }

    /**
     * 加载追踪器。
     *
     * @param projectPath - 项目路径
     * @returns 追踪器
     */
    async loadTracker(projectPath: string): Promise<ForeshadowTracker> {
        try {
            const fp = pjForeshadowTracker(projectPath);
            const ff = this.getVaultMeta().getAbstractFileByPath(fp);

            if (!(ff instanceof TFile)) {
                this.tracker = {
                    items: [],
                    lastUpdated: new Date().toISOString(),
                    version: 1,
                };
                return this.tracker;
            }

            const content = await this.getFS().read(fp);
            const parsed = this.parseTrackerFromMarkdown(content);
            this.tracker = parsed;
            return parsed;
        } catch (e) {
            log.warn('[ForeshadowManager] 加载伏笔追踪失败', e);
            this.tracker = {
                items: [],
                lastUpdated: new Date().toISOString(),
                version: 1,
            };
            return this.tracker;
        }
    }

    /**
     * 保存追踪器。
     *
     * @param projectPath - 项目路径
     * @param tracker - 参数
     */
    async saveTracker(projectPath: string, tracker?: ForeshadowTracker): Promise<void> {
        try {
            const data = tracker || this.tracker;
            if (!data) return;

            const fp = pjForeshadowTracker(projectPath);
            const dir = pjControlDir(projectPath);

            if (!this.getVaultMeta().getAbstractFileByPath(dir)) {
                await this.getFS().mkdir(dir);
            }

            const content = this.serializeTrackerToMarkdown(data);
            await this.getFS().write(fp, content);
            this.tracker = data;
        } catch (e) {
            log.warn('[ForeshadowManager] 保存伏笔追踪失败', e);
        }
    }

    private parseTrackerFromMarkdown(content: string): ForeshadowTracker {
        const items: TrackedForeshadowItem[] = [];
        let lastUpdated = new Date().toISOString();
        let version = 1;

        const metaMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (metaMatch) {
            const meta = metaMatch[1];
            const updatedMatch = meta.match(/lastUpdated:\s*(.+)/);
            if (updatedMatch) lastUpdated = updatedMatch[1].trim();
            const verMatch = meta.match(/version:\s*(\d+)/);
            if (verMatch) version = parseInt(verMatch[1], 10);
        }

        const lines = content.split('\n');
        let inTable = false;
        let headerIdx = -1;
        const colMap: Record<string, number> = {};

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line.match(/^\|.*\|$/)) continue;
            const cols = splitTableCells(line);
            if (cols.length < 2) continue;

            if (!inTable) {
                const lowerCols = cols.map(c => c.toLowerCase());
                const hasContent = lowerCols.some(c => c.includes('内容') || c.includes('描述') || c === 'content');
                const hasStatus = lowerCols.some(c => c.includes('状态') || c === 'status');
                if (hasContent && hasStatus) {
                    inTable = true;
                    headerIdx = i;
                    for (let j = 0; j < cols.length; j++) {
                        const col = lowerCols[j];
                        if (col === '#' || col === 'id' || col === '编号') colMap['id'] = j;
                        else if (col.includes('内容') || col.includes('描述') || col === 'content') colMap['content'] = j;
                        else if (col.includes('分类') || col === 'category') colMap['category'] = j;
                        else if (col.includes('重要') || col === 'importance') colMap['importance'] = j;
                        else if (col.includes('埋设') && col.includes('章')) colMap['plantedChapter'] = j;
                        else if (col.includes('位置') || col.includes('location')) colMap['plantedLocation'] = j;
                        else if (col.includes('状态') || col === 'status') colMap['status'] = j;
                        else if (col.includes('回收') && col.includes('章')) colMap['resolvedChapter'] = j;
                        else if (col.includes('回收') && col.includes('方式')) colMap['resolvedWay'] = j;
                        else if (col.includes('置信') || col === 'confidence') colMap['confidence'] = j;
                        else if (col.includes('自动') || col === 'auto') colMap['autoDetected'] = j;
                        else if (col.includes('备注') || col === 'notes') colMap['notes'] = j;
                    }
                }
                continue;
            }

            if (cols[0].includes('---')) continue;

            const getCol = (key: string, def: string = ''): string => {
                if (colMap[key] !== undefined && cols[colMap[key]] !== undefined) {
                    return cols[colMap[key]] || def;
                }
                return def;
            };

            const id = getCol('id', `item_${items.length + 1}`);
            const contentCol = getCol('content');
            const category = getCol('category', 'object') as ForeshadowCategory;
            const importanceStr = getCol('importance', 'medium');
            let importance: 'low' | 'medium' | 'high' = 'medium';
            if (importanceStr.includes('高') || importanceStr === 'high') importance = 'high';
            else if (importanceStr.includes('低') || importanceStr === 'low') importance = 'low';
            const plantedChapterStr = getCol('plantedChapter', '0');
            const plantedChapter = parseInt(plantedChapterStr.replace(/[^\d]/g, ''), 10) || 0;
            const plantedLocation = getCol('plantedLocation');
            const statusStr = getCol('status', 'planted');
            let status: 'planted' | 'partial' | 'resolved' = 'planted';
            if (statusStr.includes('已回收') || statusStr === 'resolved') status = 'resolved';
            else if (statusStr.includes('部分') || statusStr === 'partial') status = 'partial';
            const resolvedChapterStr = getCol('resolvedChapter', '');
            // 无数字（如「见第X章末」）必须落 undefined，NaN 会让后续 <= / 排序比较恒 false
            const resolvedDigits = resolvedChapterStr.replace(/[^\d]/g, '');
            const resolvedChapter = resolvedDigits ? parseInt(resolvedDigits, 10) : undefined;
            const resolvedWay = getCol('resolvedWay');
            const confidenceStr = getCol('confidence', '0.8');
            const confidence = parseFloat(confidenceStr) || 0.8;
            const autoDetectedStr = getCol('autoDetected', '否');
            const autoDetected = autoDetectedStr.includes('是') || autoDetectedStr === 'true';
            const notes = getCol('notes');

            items.push({
                id,
                content: contentCol,
                category,
                importance,
                plantedChapter,
                plantedLocation,
                status,
                resolvedChapter,
                resolvedWay,
                confidence,
                autoDetected,
                notes: notes || undefined,
            });
        }

        return { items, lastUpdated, version };
    }

    private serializeTrackerToMarkdown(tracker: ForeshadowTracker): string {
        const categoryLabels: Record<ForeshadowCategory, string> = {
            object: '物件',
            character: '人物',
            setting: '设定',
            event: '事件',
        };

        const importanceLabels: Record<string, string> = {
            low: '低',
            medium: '中',
            high: '高',
        };

        const statusLabels: Record<string, string> = {
            planted: '已埋',
            partial: '部分回收',
            resolved: '已回收',
        };

        const lines: string[] = [];

        lines.push('---');
        lines.push(`lastUpdated: ${tracker.lastUpdated}`);
        lines.push(`version: ${tracker.version}`);
        lines.push(`tags: [伏笔追踪]`);
        lines.push('---');
        lines.push('');
        lines.push('# 🎯 伏笔追踪器');
        lines.push('');
        lines.push(`> 最后更新：${new Date(tracker.lastUpdated).toLocaleString()}`);
        lines.push('');

        const stats = {
            total: tracker.items.length,
            planted: tracker.items.filter(i => i.status === 'planted').length,
            partial: tracker.items.filter(i => i.status === 'partial').length,
            resolved: tracker.items.filter(i => i.status === 'resolved').length,
        };

        lines.push('## 统计概览');
        lines.push('');
        lines.push(`- 伏笔总数：**${stats.total}**`);
        lines.push(`- 已埋设：${stats.planted}`);
        lines.push(`- 部分回收：${stats.partial}`);
        lines.push(`- 已回收：${stats.resolved}`);
        lines.push('');

        lines.push('## 伏笔清单');
        lines.push('');
        lines.push('| # | 内容 | 分类 | 重要度 | 埋设章节 | 状态 | 回收章节 | 置信度 | 自动检测 | 备注 |');
        lines.push('|---|------|------|--------|----------|------|----------|--------|----------|------|');

        tracker.items.forEach((item, idx) => {
            lines.push(`| ${idx + 1} | ${item.content} | ${categoryLabels[item.category]} | ${importanceLabels[item.importance]} | 第${item.plantedChapter}章 | ${statusLabels[item.status]} | ${item.resolvedChapter ? `第${item.resolvedChapter}章` : '-'} | ${(item.confidence * 100).toFixed(0)}% | ${item.autoDetected ? '是' : '否'} | ${item.notes || '-'} |`);
        });

        lines.push('');

        if (tracker.items.length === 0) {
            lines.push('> 暂无伏笔数据，使用自动识别或手动添加来开始追踪。');
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * 取当前追踪器。
     * @returns 追踪器或 null
     */
    getTracker(): ForeshadowTracker | null {
        return this.tracker;
    }

    /**
     * 设置当前追踪器。
     *
     * @param tracker - 追踪器
     */
    setTracker(tracker: ForeshadowTracker): void {
        this.tracker = tracker;
    }
}

/**
 * 伏笔条目。
 */
export interface ForeshadowItem {
    id: string;
    name: string;
    importance: string;
    buryChapter: string;
    plannedReveal: string;
    relatedChars?: string;
    relatedMainline?: string;
    status: string;
}

/**
 * 伏笔预警。
 */
export interface ForeshadowWarning {
    level: 'warning' | 'critical';
    msg: string;
    plannedChapter: number;
    foreshadowId: string;
    foreshadowName: string;
}

/**
 * 基于 plannedReveal 字段，生成伏笔生命周期预警
 * @param app Obsidian App 实例
 * @param project 项目名
 * @param currentChapter 当前章号
 * @returns 预警列表（按紧急度排序：critical 在前，warning 在后）
 */
export async function getForeshadowWarnings(
    app: App,
    project: string,
    currentChapter: number
): Promise<ForeshadowWarning[]> {
    const warnings: ForeshadowWarning[] = [];

    try {
        const fp = pjForeshadowDB(project);
        const vaultMeta = new ObsidianVaultMeta(app);
        const fs = new ObsidianFileSystem(app);
        const ff = vaultMeta.getAbstractFileByPath(fp);

        if (!ff || !(ff instanceof TFile)) return [];

        const content = await fs.read(fp);
        const items = parseForeshadowTableContent(content);

        for (const item of items) {
            const status = item.status || '';
            if (status.includes('已揭示') || status.includes('揭示')) continue;

            const plannedChapter = parseChapterNumber(item.plannedReveal || '');
            if (plannedChapter === null) continue;

            if (currentChapter >= plannedChapter) {
                warnings.push({
                    level: 'critical',
                    msg: `${item.name}应在第${plannedChapter}章揭示，已过期${currentChapter - plannedChapter}章，请立即处理`,
                    plannedChapter,
                    foreshadowId: item.id,
                    foreshadowName: item.name
                });
            } else if (plannedChapter - currentChapter <= FORESHADOW_APPROACHING_CHAPTERS && plannedChapter - currentChapter > 0) {
                warnings.push({
                    level: 'warning',
                    msg: `${item.name}计划在第${plannedChapter}章揭示，距现在仅剩${plannedChapter - currentChapter}章，当前是否有铺垫？`,
                    plannedChapter,
                    foreshadowId: item.id,
                    foreshadowName: item.name
                });
            }
        }
    } catch (e) {
        log.warn('Failed to get foreshadow warnings:', e);
    }

    // 按 level 排序：critical 在前
    warnings.sort((a, b) => {
        if (a.level === 'critical' && b.level !== 'critical') return -1;
        if (a.level !== 'critical' && b.level === 'critical') return 1;
        return a.plannedChapter - b.plannedChapter;
    });

    return warnings;
}

/**
 * 模块级：健壮解析伏笔表格（自动检测表头，兼容列顺序变化）
 *
 * @param content - 内容
 * @returns 结果数组
 */
export function parseForeshadowTableContent(content: string): ForeshadowItem[] {
    const lines = content.split('\n');
    let headerIdx = -1;
    const colMap: Record<string, number> = {};

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.match(/^\|.*\|$/)) continue;
        const cols = splitTableCells(line);
        if (cols.length < 2) continue;
        const lowerCols = cols.map(c => c.toLowerCase());
        const hasId = lowerCols.some(c => c === '#' || c === '编号' || c === 'id' || c === '序号');
        const hasName = lowerCols.some(c => c.includes('伏笔') || c === '名称' || c === '名字' || c === '内容');
        if (hasId && hasName) {
            headerIdx = i;
            for (let j = 0; j < cols.length; j++) {
                const col = lowerCols[j];
                if (col === '#' || col === '编号' || col === 'id' || col === '序号') colMap['id'] = j;
                else if (col.includes('伏笔') || col === '名称' || col === '名字' || col === '内容') colMap['name'] = j;
                else if (col.includes('重要') || col === '级别' || col === 'priority' || col === 'importance') colMap['importance'] = j;
                else if (col.includes('埋设') || col.includes('埋入') || col.includes('出现') || col === '章节') {
                    if (!colMap['buryChapter']) colMap['buryChapter'] = j;
                }
                else if (col.includes('揭示') && !col.includes('状态') && !col.includes('实际')) colMap['plannedReveal'] = j;
                else if (col.includes('人物') || col.includes('角色')) colMap['relatedChars'] = j;
                else if (col.includes('主线') || col.includes('剧情') || col.includes('情节')) colMap['relatedMainline'] = j;
                else if (col.includes('状态') || col === 'status') colMap['status'] = j;
            }
            if (!colMap['status']) colMap['status'] = cols.length - 1;
            break;
        }
    }

    if (headerIdx === -1) {
        return parseForeshadowTableFallbackLegacy(content);
    }

    const items: ForeshadowItem[] = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.match(/^\|.*\|$/)) continue;
        const cols = splitTableCells(line);
        if (cols.length < 2) continue;
        if (cols[0].includes('---')) continue;

        const status = colMap['status'] !== undefined ? (cols[colMap['status']] || '') : (cols[cols.length - 1] || '');
        items.push({
            id: colMap['id'] !== undefined ? (cols[colMap['id']] || String(items.length + 1)) : String(items.length + 1),
            name: colMap['name'] !== undefined ? (cols[colMap['name']] || '') : (cols[1] || ''),
            importance: colMap['importance'] !== undefined ? (cols[colMap['importance']] || '') : (cols[2] || ''),
            buryChapter: colMap['buryChapter'] !== undefined ? (cols[colMap['buryChapter']] || '') : (cols[3] || ''),
            plannedReveal: colMap['plannedReveal'] !== undefined ? (cols[colMap['plannedReveal']] || '') : (cols[4] || ''),
            relatedChars: colMap['relatedChars'] !== undefined ? (cols[colMap['relatedChars']] || '') : (cols.length >= 7 ? cols[5] : ''),
            relatedMainline: colMap['relatedMainline'] !== undefined ? (cols[colMap['relatedMainline']] || '') : (cols.length >= 7 ? cols[6] : ''),
            status: status || '未揭示',
        });
    }
    return items;
}

/**
 * 模块级：旧格式回退解析（兼容无表头的表格）
 *
 * @param content - 内容
 * @returns 结果数组
 */
function parseForeshadowTableFallbackLegacy(content: string): ForeshadowItem[] {
    const items: ForeshadowItem[] = [];
    for (const line of content.split('\n')) {
        if (!line.match(/^\|.*\|$/)) continue;
        const cols = splitTableCells(line);
        if (cols.length < 2) continue;
        if (cols[0] === '#' || cols[0].includes('---') || cols[0] === '伏笔') continue;
        const status = cols.length >= 8 ? (cols[7] || '') : (cols.length >= 6 ? cols[5] : (cols[1] || ''));
        items.push({
            id: cols[0] || String(items.length + 1),
            name: cols[1] || '',
            importance: cols[2] || '',
            buryChapter: cols[3] || '',
            plannedReveal: cols.length >= 5 ? cols[4] : '',
            relatedChars: cols.length >= 8 ? cols[5] : '',
            relatedMainline: cols.length >= 8 ? cols[6] : '',
            status: status || '未揭示',
        });
    }
    return items;
}

/**
 * 从 plannedReveal 字段中解析章号
 * 支持"第N章"格式，跳过"第N卷"格式
 * @param plannedReveal - 计划揭示位置
  * @returns 数值结果 或 null
 */
function parseChapterNumber(plannedReveal: string): number | null {
    if (!plannedReveal) return null;

    // 跳过卷级别的（如"第3卷"）
    if (plannedReveal.includes('卷')) return null;

    // 匹配"第N章"格式
    const match = plannedReveal.match(/第(\d+)章/);
    if (match) {
        return parseInt(match[1], 10);
    }

    return null;
}

// ==================== 增强：伏笔追踪器类型 ====================

/**
 * 伏笔分类。
 */
export type ForeshadowCategory = 'object' | 'character' | 'setting' | 'event';

/**
 * 追踪中的伏笔条目。
 */
export interface TrackedForeshadowItem {
    id: string;
    content: string;
    category: ForeshadowCategory;
    importance: 'low' | 'medium' | 'high';
    plantedChapter: number;
    plantedLocation?: string;
    status: 'planted' | 'partial' | 'resolved';
    resolvedChapter?: number;
    resolvedWay?: string;
    vector?: number[];
    confidence: number;
    autoDetected: boolean;
    notes?: string;
}

/**
 * 伏笔追踪状态。
 */
export interface ForeshadowTracker {
    items: TrackedForeshadowItem[];
    lastUpdated: string;
    version: number;
}
