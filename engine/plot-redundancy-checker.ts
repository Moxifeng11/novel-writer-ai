/**
 * plot-redundancy-checker.ts — D3 跨章节剧情冗余度检查（同步核心 + 异步读前文）
 *
 * 只读取当前项目/当前卷前 10 章正文，不扫全库。
 */

import { App, TFile } from 'obsidian';
import { findBodyFileV4 } from './chapter-utils';
import { pjBodyFile } from '../shared/paths';
import { FileSystemPort, VaultMetaPort, ObsidianFileSystem, ObsidianVaultMeta } from '../shared/file-system-port';
import { createLogger } from '../shared/logger';


const log = createLogger('PlotRedundancyChecker');
/**
 * 情节冗余问题结构定义。
 */
export interface PlotRedundancyIssue {
    type: 'repeated_phrase' | 'repeated_scene_word' | 'repeated_conflict_word';
    message: string;
    sample: string;
    count: number;
}

/**
 * 情节冗余报告结构定义。
 */
export interface PlotRedundancyReport {
    issues: PlotRedundancyIssue[];
    comparedChapters: number;
    checkedAt: number;
}

const SCENE_WORDS = ['破庙', '山洞', '街道', '院子', '客栈', '密室', '森林', '城门', '战场', '大殿'];
const CONFLICT_WORDS = ['争吵', '追杀', '背叛', '误会', '试探', '威胁', '逃亡', '对峙', '审问', '突袭'];

function normalize(text: string): string {
    return (text || '').replace(/[\s　，。、！？；“”‘’（）—…]/g, '').trim();
}

function topRepeatedPhrases(current: string, previous: string): PlotRedundancyIssue[] {
    const cur = normalize(current).slice(-1800);
    const prev = normalize(previous).slice(-12000);
    const counts = new Map<string, number>();
    for (let i = 0; i + 6 <= cur.length; i++) {
        const gram = cur.slice(i, i + 6);
        if (/^[一-龥]{6}$/.test(gram) && prev.includes(gram)) {
            counts.set(gram, (counts.get(gram) || 0) + 1);
        }
    }
    return [...counts.entries()]
        .filter(([, c]) => c >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([sample, count]) => ({
            type: 'repeated_phrase' as const,
            message: `当前章节短语「${sample}」与前文重复 ${count} 次，检查是否在复演旧桥段`,
            sample,
            count
        }));
}

function repeatedWordIssues(current: string, previous: string, words: string[], type: 'repeated_scene_word' | 'repeated_conflict_word'): PlotRedundancyIssue[] {
    const issues: PlotRedundancyIssue[] = [];
    for (const word of words) {
        const curCount = (current.match(new RegExp(word, 'g')) || []).length;
        const prevCount = (previous.match(new RegExp(word, 'g')) || []).length;
        if (curCount >= 2 && prevCount >= 3) {
            issues.push({
                type,
                message: `${type === 'repeated_scene_word' ? '场景词' : '冲突词'}「${word}」在当前章节出现 ${curCount} 次，前 10 章出现 ${prevCount} 次，注意桥段重复`,
                sample: word,
                count: curCount + prevCount
            });
        }
    }
    return issues.slice(0, 3);
}

/**
 * 分析情节冗余。
 * @param currentBody - 当前正文
 * @param previousBodies - 前文正文列表
  * @returns PlotRedundancyReport 实例
 */
export function analyzePlotRedundancy(currentBody: string, previousBodies: string[]): PlotRedundancyReport {
    const previous = previousBodies.join('\n\n').slice(-20000);
    const issues: PlotRedundancyIssue[] = [
        ...topRepeatedPhrases(currentBody, previous),
        ...repeatedWordIssues(currentBody, previous, SCENE_WORDS, 'repeated_scene_word'),
        ...repeatedWordIssues(currentBody, previous, CONFLICT_WORDS, 'repeated_conflict_word')
    ];
    return { issues: issues.slice(0, 8), comparedChapters: previousBodies.length, checkedAt: Date.now() };
}

/**
 * loadPreviousChapterBodies 函数。
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param volume - 卷
 * @param chapterNum - 章号
 * @param limit - 上限
 * @returns 结果数组
 */
export async function loadPreviousChapterBodies(app: App, project: string, volume: string, chapterNum: number, limit = 10): Promise<string[]> {
    const bodies: string[] = [];
    const start = Math.max(1, chapterNum - limit);
    const volN = parseInt(volume.match(/第(\d+)卷/)?.[1] || '0', 10);
    const vaultMeta = new ObsidianVaultMeta(app);
    const fs = new ObsidianFileSystem(app);
    for (let n = start; n < chapterNum; n++) {
        const path = pjBodyFile(project, volN, n);
        // 标准命名优先，再用 findBodyFileV4 兜底带标题正文
        let file: TFile | undefined;
        const direct = vaultMeta.getAbstractFileByPath(path);
        if (direct instanceof TFile) file = direct;
        else if (volN > 0) file = findBodyFileV4(app, project, volN, n);
        if (file instanceof TFile) {
            try {
                bodies.push(await fs.read(file.path));
            } catch (e) {
                log.warn('[PlotRedundancyChecker] 读取前文失败:', path, e);
            }
        }
    }
    return bodies;
}
