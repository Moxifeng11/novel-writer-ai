/**
 * long-term-memory.ts — 长篇记忆层（已确认事实）
 *
 * 长篇小说写到后期，模型往往只看得到上一章，早期章节沉淀的人物/世界观/剧情事实会丢失。
 * 这里把「事实索引」中用户已确认的事实整理成稳定的 prompt 块，供协同写作等入口注入。
 *
 * 只读 `confirmed`：`pending` 事实未经用户确认，绝不进入 prompt。
 */

import type { TFile } from 'obsidian';
import type { FileSystemPort } from '../shared/file-system-port';
import { pjVolumeOutlineDir } from '../shared/paths';
import { projectFactIndexPath, VaultFactStorage } from './fact-index-vault';
import type { ConfirmedFact, FactCategory } from './fact-index-manager';
import { VolumeOutlineSummarizer, type VolumeSummary } from './volume-outline-summarizer';
import { dedupeFacts, rankFacts } from '../shared/memory-rank';
import { activeContextQuotas } from '../shared/context-budget-policy';

/** 每个类别默认最多注入的事实条数（控制本地小窗口预算） */
export const LONG_TERM_MEMORY_MAX_PER_CATEGORY = 12;

/** 注入块整体上限（字符） */
export const LONG_TERM_MEMORY_MAX_CHARS = 1500;

const CATEGORY_ORDER: FactCategory[] = ['character', 'world', 'plot'];

const CATEGORY_LABELS: Record<FactCategory, string> = {
    character: '人物',
    world: '世界观',
    plot: '剧情',
};

/**
 * 把已确认事实格式化为 prompt 块；无事实时返回空串。
 * @param facts - 事实
 * @param maxPerCategory - 单类上限
 * @param options - 配置项
 * @returns 文本结果
 */
export function formatConfirmedFacts(
    facts: readonly ConfirmedFact[],
    maxPerCategory?: number,
    query = '',
    options?: { maxChars?: number },
): string {
    if (facts.length === 0) return '';

    const lines: string[] = ['【长篇记忆：已确认事实（来自早期章节，续写不得与之矛盾）】'];
    // v4.22：条数上限同样跟预算走（旧值 12 条/类）
    const quotas = activeContextQuotas();
    // 显式传参优先（测试/特殊调用），否则按当前预算配额
    const limit = Math.max(1, maxPerCategory ?? quotas.longTermMemoryPerCategory);
    // v4.20：同一条事实跨章反复确认会产生多条近似记录，先合并；
    // 再按「与当前章纲的相关度 + 新近度」排序，最后才截前 N 条。
    const deduped = dedupeFacts([...facts]);
    const ranked = rankFacts(deduped, { query });

    for (const category of CATEGORY_ORDER) {
        const items = ranked.filter((fact) => fact.category === category).slice(0, limit);
        if (items.length === 0) continue;
        lines.push(`### ${CATEGORY_LABELS[category]}`);
        for (const fact of items) {
            const content = (fact.content || '').trim();
            const detail = content && content !== fact.name ? `：${content}` : '';
            lines.push(`- ${fact.name}${detail}`);
        }
    }

    if (lines.length <= 1) return '';
    const text = lines.join('\n');
    // v4.22：上限随真实输入预算放大（旧值 1500 字是 32K 窗口时代的常量）
    const maxChars = options?.maxChars ?? Math.max(LONG_TERM_MEMORY_MAX_CHARS, quotas.longTermMemoryChars);
    return text.length > maxChars
        ? `${text.slice(0, maxChars)}\n（已截断，可调高单步输入上限以保留全部事实）`
        : text;
}

/** 跨卷摘要压缩后的默认上限（字符） */
export const VOLUME_SUMMARY_MAX_CHARS = 2000;

/**
 * 读取「当前卷之前」各卷的分卷大纲，提取并渐进压缩为前情提要。
 * 单卷损坏跳过；无前卷/无大纲时返回空串。
 * @param fs - 文件系统端口
 * @param project - 项目（路径或对象）
 * @param options - 配置项
 * @returns 文本结果
 */
export async function loadVolumeSummaries(
    fs: FileSystemPort,
    project: string,
    options?: { beforeVolume?: number; maxChars?: number },
): Promise<string> {
    const maxChars = options?.maxChars ?? VOLUME_SUMMARY_MAX_CHARS;
    let files: TFile[];
    try {
        files = await fs.listFiles(pjVolumeOutlineDir(project));
    } catch {
        return '';
    }

    const summarizer = new VolumeOutlineSummarizer();
    const summaries: VolumeSummary[] = [];

    for (const file of files) {
        const match = file.name.match(/^第(\d+)卷_分卷大纲\.md$/);
        if (!match) continue;
        const volumeNumber = parseInt(match[1], 10);
        if (!Number.isFinite(volumeNumber)) continue;
        if (options?.beforeVolume && volumeNumber >= options.beforeVolume) continue;
        try {
            const content = await fs.read(file.path);
            summaries.push(summarizer.extract(content, volumeNumber));
        } catch {
            // 单卷大纲损坏不影响其他卷
        }
    }

    if (summaries.length === 0) return '';
    summaries.sort((a, b) => a.volumeNumber - b.volumeNumber);
    const compressed = summarizer.compress(summaries, maxChars).trim();
    if (!compressed) return '';

    return `【前情提要：前 ${summaries.length} 卷摘要（续写需保持事件与伏笔连续）】\n${compressed}`;
}

/**
 * 读取项目事实索引中的已确认事实并格式化。
 * 传入 `beforeVolume` 时同时注入前序卷摘要。
 * 索引缺失/损坏/无已确认事实时返回空串，调用方按「无长篇记忆」降级。
 * @param fs - 文件系统端口
 * @param project - 项目（路径或对象）
 * @param options - 配置项
 * @returns 文本结果
 */
export async function loadLongTermMemory(
    fs: FileSystemPort,
    project: string,
    options?: { maxPerCategory?: number; beforeVolume?: number; query?: string },
): Promise<string> {
    const storage = new VaultFactStorage(fs, projectFactIndexPath(project));
    const data = await storage.load();
    const factsText = data && Array.isArray(data.confirmed)
        ? formatConfirmedFacts(data.confirmed, options?.maxPerCategory, options?.query)
        : '';

    const volumeText = options?.beforeVolume && options.beforeVolume > 1
        ? await loadVolumeSummaries(fs, project, { beforeVolume: options.beforeVolume })
        : '';

    return [volumeText, factsText].filter(Boolean).join('\n\n');
}
