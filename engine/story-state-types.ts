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

/** 单角色状态摘要（快照内嵌） */
export interface CharacterStateBrief {
    name: string;
    emotion: string;
    injury: string;
    goal: string;
    secret: string;
    relationships: string;
}

/** P0-2 剧情任务卡 */
export interface StoryBeat {
    id: string;
    description: string;
    type: 'event' | 'conflict' | 'reveal' | 'emotion' | 'relationship' | 'hook';
    required: boolean;
    completed?: boolean;
}
