/** ==== 故事质量闭环 — 核心数据结构 ====
 * 对应 spec: story-quality-closed-loop-optimization 第 2.1 节数据模型。
 * 全部为纯数据结构，无副作用。
 */

/** P0-1 章节故事状态快照 */
export interface ChapterStateSnapshot {
    chapterNumber: number;
    timeline: { time: string; location: string };
    povCharacter: string;
    mainGoal: string;
    coreConflict: string;
    requiredBeats: string[];
    requiredReveals: string[];
    forbiddenReveals: string[];
    characterStates: CharacterStateBrief[];
    previousEnding: {
        action: string;
        emotion: string;
        unfinished: string;
        mustContinue: string;
    };
    acceptanceCriteria: string[];
}

/** 生死状态（结构化；缺省 unknown 表示快照未覆盖） */
export type CharacterLifeState = 'alive' | 'dead' | 'unknown';

/** 伤势等级（结构化；缺省 unknown 表示快照未覆盖） */
export type CharacterInjuryLevel = 'none' | 'light' | 'severe' | 'critical' | 'unknown';

/**
 * 单角色状态摘要（快照内嵌）
 *
 * v4.94：新增 lifeState / injuryLevel 两个**结构化**维度。
 * 为什么：conflict-detector 的剧变检测此前只能靠关键词（「死了」「重伤」），
 * 换个说法就漏报。有了结构化字段，规则可以先读字段、词表只做兜底。
 * 缺省 unknown 表示"快照没覆盖到"，此时才允许回退到词表。
 */
export interface CharacterStateBrief {
    name: string;
    emotion: string;
    injury: string;
    goal: string;
    secret: string;
    relationships: string;
    /** 生死状态 */
    lifeState?: CharacterLifeState;
    /** 伤势等级 */
    injuryLevel?: CharacterInjuryLevel;
}

/** P0-2 剧情任务卡 */
export interface StoryBeat {
    id: string;
    description: string;
    type: 'event' | 'conflict' | 'reveal' | 'emotion' | 'relationship' | 'hook';
    required: boolean;
    completed?: boolean;
}
