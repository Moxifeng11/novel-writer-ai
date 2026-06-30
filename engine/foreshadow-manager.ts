import { App, TFile, Vault } from 'obsidian';
import NovelWriterPlugin from '../main';
import { getNextRowNum, hasTableSeparator, appendAfterSeparator, moveForeshadowToRevealed, mkdirp, showSuccess, showError } from '../utils/helpers';
import { detectProjects } from './context-manager';
import { CHAPTER_FILE_TYPES } from './chapter-utils';
import { INFO_DEBT_MAX, FORCED_REVEAL_OVER_20, FORCED_REVEAL_OVER_15, FORCED_REVEAL_OVER_10, FORCED_REVEAL_OVER_5, FORCED_REVEAL_WINDOW_FORWARD, FORCED_REVEAL_WINDOW_BACKWARD, NOTICE_ERROR, NOTICE_SUCCESS } from '../shared/thresholds';
import { pjForeshadowDB, pjTimelineDir, pjInfoDebtBoard, pjControlDir, pjCharsDir, isInCharsDir } from '../shared/paths';
import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';
import { FileSystemPort, VaultMetaPort, ObsidianFileSystem, ObsidianVaultMeta } from '../shared/file-system-port';

export class ForeshadowManager {
    private plugin: NovelWriterPlugin;
    private notifier: Notifier;
    private app: App;
    private fs: FileSystemPort | null = null;
    private vaultMeta: VaultMetaPort | null = null;

    constructor(plugin: NovelWriterPlugin, notifier?: Notifier) {
        this.notifier = notifier || NOOP_NOTIFIER;
        this.plugin = plugin;
        this.app = plugin.app;
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

    async refreshInfoDebt(): Promise<void> {
        const projects = await this.detectProjects();
        
        for (const project of projects) {
            await this.generateInfoDebtBoard(project);
        }
    }

    async detectProjects(): Promise<string[]> {
        return detectProjects(this.app);
    }

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
            console.warn('Failed to parse foreshadow file:', e);
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
            } catch (e) { console.warn('[小说工坊] 操作失败:', e); }
        }

        const charFiles = this.getVaultMeta().getFiles().filter(f => 
            f.path.startsWith(pjCharsDir(project)) && 
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
                console.warn('[ForeshadowManager] 读取人物状态失败:', e);
                this.notifier.showNotice('[ForeshadowManager] 数据读取失败，部分功能可能受限');
                charStateMissing++;
            }
        }

        const debtRatio = Math.min(INFO_DEBT_MAX, unrevealed);

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
            console.warn('Failed to write info debt board:', e);
            this.notifier.showNotice('⚠️ 信息债看板更新失败', NOTICE_ERROR);
        }
    }

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
            console.warn('Failed to get unrevealed foreshadows:', e);
        }
        
        return { items, count: items.length };
    }

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
     * v3.4.8 线程安全评估: Obsidian 单线程运行环境 + 本类单例 → 无竞态风险。
     * 无需接入 withWriteLock。若未来引入 Web Worker 或并行写入请重新评估。
     */
    async revealForeshadows(project: string, foreshadowNames: string[], chapterName: string): Promise<void> {
        try {
            const fp = pjForeshadowDB(project);
            const ff = this.getVaultMeta().getAbstractFileByPath(fp);
            
            if (!(ff instanceof TFile)) return;
            
            let content = await this.getFS().read(fp);
            let changed = false;
            
            for (const name of foreshadowNames) {
                const newContent = this.moveForeshadowToRevealed(content, name, chapterName);
                if (newContent !== content) {
                    content = newContent;
                    changed = true;
                }
            }
            
            if (changed) {
                await this.getFS().write(fp, content);
                this.notifier.showNotice(`✅ 已揭示 ${foreshadowNames.length} 个伏笔`, NOTICE_SUCCESS);
                await this.refreshInfoDebt();
            }
        } catch (e) {
            console.warn('Failed to reveal foreshadows:', e);
        }
    }

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
                await this.getFS().write(fp, content);
            } else {
                await mkdirp(this.app, pjTimelineDir(project));
                content = `# 伏笔库\n\n| # | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 当前状态 |\n|---|---------|---------|---------|---------|---------|\n${newRow}\n`;
                if (ff) await this.getFS().write(fp, content);
                else await this.getFS().write(fp, content);
            }
            
            await this.refreshInfoDebt();
        } catch (e) {
            console.warn('Failed to add foreshadow:', e);
        }
    }

    private moveForeshadowToRevealed(content: string, name: string, revealChapter: string): string {
        const result = moveForeshadowToRevealed(content, name, revealChapter);
        return result !== null ? result : content;
    }
}

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
            } else if (plannedChapter - currentChapter <= 3 && plannedChapter - currentChapter > 0) {
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
        console.warn('Failed to get foreshadow warnings:', e);
    }

    // 按 level 排序：critical 在前
    warnings.sort((a, b) => {
        if (a.level === 'critical' && b.level !== 'critical') return -1;
        if (a.level !== 'critical' && b.level === 'critical') return 1;
        return a.plannedChapter - b.plannedChapter;
    });

    return warnings;
}

/** 模块级：健壮解析伏笔表格（自动检测表头，兼容列顺序变化） */
export function parseForeshadowTableContent(content: string): ForeshadowItem[] {
    const lines = content.split('\n');
    let headerIdx = -1;
    const colMap: Record<string, number> = {};

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.match(/^\|.*\|$/)) continue;
        const cols = line.split('|').map(s => s.trim()).filter(Boolean);
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
        const cols = line.split('|').map(s => s.trim()).filter(Boolean);
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

/** 模块级：旧格式回退解析（兼容无表头的表格） */
function parseForeshadowTableFallbackLegacy(content: string): ForeshadowItem[] {
    const items: ForeshadowItem[] = [];
    for (const line of content.split('\n')) {
        if (!line.match(/^\|.*\|$/)) continue;
        const cols = line.split('|').map(s => s.trim()).filter(Boolean);
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
