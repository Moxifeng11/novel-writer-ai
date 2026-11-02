/**
 * volume-outline-summarizer.ts — 卷大纲摘要提取与压缩
 *
 * 从卷级 Markdown 大纲中提取结构化摘要，支持多卷累积摘要的渐进式压缩。
 */

export interface VolumeSummary {
    volumeNumber: number;
    characterChanges: string[];
    eventOutcomes: string[];
    newForeshadows: string[];
    resolvedForeshadows: string[];
    pendingForeshadows: string[];
    endingTransition: string;
    factionChanges: string[];
}

/**
 * 提取指定 Markdown 标题下的内容块，直到下一个同级或更高级标题
 *
 * @param content - 内容
 * @param headingText - 标题文本
 * @returns 文本结果
 */
function extractSection(content: string, headingText: string): string {
    const lines = content.split('\n');
    let startIdx = -1;
    let headingLevel = 0;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        const match = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (match && match[2].trim() === headingText) {
            headingLevel = match[1].length;
            startIdx = i + 1;
            break;
        }
    }

    if (startIdx < 0) return '';

    const sectionLines: string[] = [];
    for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const match = trimmed.match(/^(#{1,6})\s+/);
        if (match && match[1].length <= headingLevel) break;
        sectionLines.push(line);
    }

    return sectionLines.join('\n').trim();
}

/**
 * 从文本中提取 Markdown 列表项（- 或 * 开头）
 *
 * @param text - 文本内容
 * @returns 结果数组
 */
function extractListItems(text: string): string[] {
    if (!text) return [];
    return text
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('- ') || l.startsWith('* '))
        .map(l => l.substring(2).trim());
}

/**
 * 去除伏笔项中的「埋设/回收」前缀，用于比对
 *
 * @param text - 文本内容
 * @returns 文本结果
 */
function cleanForeshadow(text: string): string {
    return text.replace(/^(埋设|回收)[:：]\s*/, '').trim();
}

export class VolumeOutlineSummarizer {
    /**
     * 从单卷 Markdown 大纲中提取结构化摘要。
     * @param volumeContent - 卷内容
     * @param volumeNumber - 卷号
      * @returns VolumeSummary 实例
     */
    extract(volumeContent: string, volumeNumber: number): VolumeSummary {
        const characterSection = extractSection(volumeContent, '人物弧光');
        const eventSection = extractSection(volumeContent, '主要事件');
        const foreshadowSection = extractSection(volumeContent, '伏笔安排');
        const endingSection = extractSection(volumeContent, '结尾过渡');
        const factionSection = extractSection(volumeContent, '势力变动');

        const characterChanges = extractListItems(characterSection);
        const eventOutcomes = extractListItems(eventSection);
        const factionChanges = extractListItems(factionSection);

        const foreshadowItems = extractListItems(foreshadowSection);
        const newForeshadows = foreshadowItems.filter(item => item.includes('埋设'));
        const resolvedForeshadows = foreshadowItems.filter(item => item.includes('回收'));

        const resolvedSet = new Set(resolvedForeshadows.map(cleanForeshadow));
        const pendingForeshadows = newForeshadows.filter(
            nf => !resolvedSet.has(cleanForeshadow(nf))
        );

        return {
            volumeNumber,
            characterChanges,
            eventOutcomes,
            newForeshadows,
            resolvedForeshadows,
            pendingForeshadows,
            endingTransition: endingSection,
            factionChanges,
        };
    }

    /**
     * 将多卷累积摘要格式化为 Markdown 文本。
     * 若总长度超过 maxLength，按「越远越简」原则渐进压缩。
     * @param summaries - 摘要列表
     * @param maxLength - 最大长度
     * @returns 文本结果
     */
    compress(summaries: VolumeSummary[], maxLength: number = 6000): string {
        for (let level = 0; level <= 5; level++) {
            const text = this.formatSummaries(summaries, level);
            if (text.length <= maxLength) {
                return text;
            }
        }
        return this.formatSummaries(summaries, 5).slice(0, maxLength);
    }

    private formatSummaries(summaries: VolumeSummary[], level: number): string {
        return summaries
            .map((s, i) => {
                const distance = summaries.length - 1 - i;
                return this.formatOne(s, distance, level);
            })
            .join('\n\n');
    }

    private formatOne(s: VolumeSummary, distance: number, level: number): string {
        const lines: string[] = [];
        lines.push(`## 第${s.volumeNumber}卷摘要`);

        const full = distance === 0 || level === 0;

        // 人物弧光
        if (s.characterChanges.length > 0 && (full || level <= 3)) {
            const limit = full
                ? s.characterChanges.length
                : distance >= 2
                  ? Math.max(1, 3 - level)
                  : Math.max(1, 4 - level);
            lines.push('### 人物弧光');
            s.characterChanges.slice(0, limit).forEach(item => lines.push(`- ${item}`));
        }

        // 主要事件
        if (s.eventOutcomes.length > 0 && (full || level <= 4)) {
            const limit = full
                ? s.eventOutcomes.length
                : distance >= 2
                  ? Math.max(1, 4 - level)
                  : Math.max(1, 5 - level);
            lines.push('### 主要事件');
            s.eventOutcomes.slice(0, limit).forEach(item => lines.push(`- ${item}`));
        }

        // 待回收伏笔
        if (s.pendingForeshadows.length > 0 && (full || (distance <= 1 && level <= 2))) {
            const limit = full ? s.pendingForeshadows.length : Math.max(1, 3 - level);
            lines.push('### 待回收伏笔');
            s.pendingForeshadows.slice(0, limit).forEach(item => lines.push(`- ${item}`));
        }

        // 结尾过渡
        if (s.endingTransition && full) {
            lines.push('### 结尾过渡');
            lines.push(s.endingTransition);
        }

        // 势力变动
        if (s.factionChanges.length > 0 && full) {
            lines.push('### 势力变动');
            s.factionChanges.forEach(item => lines.push(`- ${item}`));
        }

        return lines.join('\n');
    }
}
