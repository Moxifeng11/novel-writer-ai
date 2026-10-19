import type { GatheredContext, CharacterData, ForeshadowItem, TimelineEvent } from './context/context-types';
import type { ChapterStateSnapshot, CharacterStateBrief } from './story-state-types';
import { StoryBeatExtractor } from './story-beat-extractor';

/** 章节规划选项：五字段（pov/mainGoal/coreConflict/requiredBeats/acceptanceCriteria）的解析数据源 */
export interface SnapshotPlanOptions {
    /** 章节规划文本（outline / plotDistill 产物），五字段从中程序解析 */
    chapterPlan?: string;
}

/**
 * ChapterSnapshotBuilder — 章节故事状态快照构造器
 * 对应 spec: story-quality-closed-loop-optimization 第 2.2 节。
 *
 * 纯转换器：输入 ContextManager 聚合出的 GatheredContext，输出结构化快照。
 * 无网络、无副作用；数据源缺失时字段留空（静默降级，同 KnowledgeInjector 模式）。
 *
 * 章节规划五字段（checklist 待补项，Task 1/2 联动）：povCharacter/mainGoal/coreConflict
 * 按行标签解析（视角：/目标：/冲突：），requiredBeats 复用 StoryBeatExtractor（仅 required=true），
 * acceptanceCriteria 取「验收(标准)：」小节的列表行或单行内联。
 */
export class ChapterSnapshotBuilder {
    /**
     * 从已聚合的上下文构建章节状态快照。
     * @param chapterNumber 目标章节号
     * @param gathered ContextManager.gatherAll 的产物
     * @param options 章节规划选项（五字段数据源）
     */
    buildFromContext(
        chapterNumber: number,
        gathered: GatheredContext,
        options: SnapshotPlanOptions = {},
    ): ChapterStateSnapshot {
        const data = gathered?.data ?? {};
        const plan = typeof options.chapterPlan === 'string' ? options.chapterPlan : '';

        return {
            chapterNumber,
            timeline: this.pickTimeline(chapterNumber, data.timeline),
            povCharacter: this.parsePlanLine(plan, /视角(?:人物)?|POV/),
            mainGoal: this.parsePlanLine(plan, /目标/),
            coreConflict: this.parsePlanLine(plan, /冲突/),
            requiredBeats: plan
                ? new StoryBeatExtractor().extract(plan)
                    .filter((b) => b.required)
                    .map((b) => b.description)
                : [],
            requiredReveals: this.pickRequiredReveals(chapterNumber, data.foreshadows?.unrevealed),
            forbiddenReveals: this.pickForbiddenReveals(chapterNumber, data.foreshadows?.unrevealed),
            characterStates: this.mapCharacterStates(data.character_state),
            previousEnding: this.mapPreviousEnding(data.previous_chapter),
            acceptanceCriteria: this.parseAcceptanceCriteria(plan),
        };
    }

    /** 按行标签解析单值字段：形如「视角：林晚」「本章目标：查清真相」 */
    private parsePlanLine(plan: string, label: RegExp): string {
        if (!plan) return '';
        // label.source 需非捕获组包裹：避免其内部 | 提升为全局分支
        const m = plan.match(new RegExp(`^[ \\t]*(?:本章)?(?:核心|主线|视角(?:人物)?)?(?:${label.source})[：:]\\s*(.+)$`, 'im'));
        return m && m[1] !== undefined ? m[1].trim() : '';
    }

    /** 解析验收标准：「验收(标准)：」后同行内联，或随后连续列表行 */
    private parseAcceptanceCriteria(plan: string): string[] {
        if (!plan) return [];
        const lines = plan.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const head = lines[i].match(/^[ \t]*验收(?:标准)?[：:]\s*(.*)$/);
            if (!head) continue;
            const inline = head[1].trim();
            if (inline) return [inline];
            const items: string[] = [];
            for (let j = i + 1; j < lines.length; j++) {
                const item = lines[j].match(/^[ \t]*[-*][ \t]+(.+)$/);
                if (!item) break;
                items.push(item[1].trim());
            }
            return items;
        }
        return [];
    }

    private mapCharacterStates(chars?: CharacterData[]): CharacterStateBrief[] {
        if (!Array.isArray(chars)) return [];
        return chars.map((c) => ({
            name: (c.姓名 ?? c.name ?? '').toString(),
            emotion: (c.当前情绪 ?? '').toString(),
            injury: (c.当前状态 ?? '').toString(),
            goal: (c.当前目标 ?? '').toString(),
            secret: (c.核心驱动力_软肋 ?? '').toString(),
            relationships: (c.所属势力 ?? '').toString(),
        }));
    }

    private pickTimeline(
        chapterNumber: number,
        events?: TimelineEvent[]
    ): { time: string; location: string } {
        const empty = { time: '', location: '' };
        if (!Array.isArray(events)) return empty;
        const match = events.find((e) => this.parseChapter(e.chapter) === chapterNumber);
        if (!match) return empty;
        return { time: match.time ?? '', location: match.location ?? '' };
    }

    private pickRequiredReveals(chapterNumber: number, items?: ForeshadowItem[]): string[] {
        if (!Array.isArray(items)) return [];
        return items
            .filter((it) => this.parseChapter(it.plannedReveal) === chapterNumber)
            .map((it) => it.name)
            .filter((n): n is string => !!n);
    }

    private pickForbiddenReveals(chapterNumber: number, items?: ForeshadowItem[]): string[] {
        if (!Array.isArray(items)) return [];
        return items
            .filter((it) => {
                const planned = this.parseChapter(it.plannedReveal);
                return planned !== null && planned > chapterNumber;
            })
            .map((it) => it.name)
            .filter((n): n is string => !!n);
    }

    private mapPreviousEnding(prev?: GatheredContext['data']['previous_chapter']) {
        return {
            action: prev?.ending ?? '',
            emotion: '',
            unfinished: '',
            mustContinue: '',
        };
    }

    private parseChapter(raw?: string | number | null): number | null {
        if (raw === null || raw === undefined) return null;
        const m = String(raw).match(/\d+/);
        return m ? Number(m[0]) : null;
    }
}
