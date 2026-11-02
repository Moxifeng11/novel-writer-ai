import type { StoryBeat } from './story-state-types';

/**
 * StoryBeatExtractor — 剧情任务卡提取器
 * 对应 spec: story-quality-closed-loop-optimization 第 2.2 节。
 *
 * 纯程序解析：从章节规划文本提取结构化 StoryBeat[]。
 * 无网络、无副作用；输入非法或无可解析条目时回退为空数组。
 */
export class StoryBeatExtractor {
    private static readonly TYPE_MARKERS: Array<{ keys: string[]; type: StoryBeat['type'] }> = [
        { keys: ['事件'], type: 'event' },
        { keys: ['冲突'], type: 'conflict' },
        { keys: ['揭示', '伏笔'], type: 'reveal' },
        { keys: ['情绪'], type: 'emotion' },
        { keys: ['关系'], type: 'relationship' },
        { keys: ['钩子', '悬念'], type: 'hook' },
    ];

    /**
     * 从章节规划文本提取剧情任务卡。
     * @param chapterPlan 章节规划文本
     * @returns 结果数组
     */
    extract(chapterPlan: string): StoryBeat[] {
        if (typeof chapterPlan !== 'string' || chapterPlan.trim() === '') return [];

        const beats: StoryBeat[] = [];
        const lines = chapterPlan.split(/\r?\n/);
        let seq = 0;

        for (const rawLine of lines) {
            const line = rawLine.trim();
            const item = this.stripListMarker(line);
            if (item === null || item === '') continue;

            const { type, description } = this.classify(item);
            if (description === '') continue;

            beats.push({
                id: `beat-${++seq}`,
                description,
                type,
                required: this.isRequired(item),
            });
        }

        return beats;
    }

    private stripListMarker(line: string): string | null {
        const m = line.match(/^[-*]\s+(.*)$/);
        return m ? m[1].trim() : null;
    }

    private classify(item: string): { type: StoryBeat['type']; description: string } {
        for (const { keys, type } of StoryBeatExtractor.TYPE_MARKERS) {
            for (const key of keys) {
                const re = new RegExp(`^${key}(?:（[^）]*）)?[:：]\\s*(.*)$`);
                const m = item.match(re);
                if (m) {
                    return { type, description: m[1].trim() };
                }
            }
        }
        return { type: 'event', description: item };
    }

    private isRequired(item: string): boolean {
        return /必须|必需/.test(item);
    }
}
