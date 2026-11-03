/**
 * gate-snapshot.ts — 从模板变量装配 QualityGate 的 ChapterStateSnapshot（纯函数）
 *
 * QualityGate（三层验收）此前注册后零调用——它需要一份 ChapterStateSnapshot，
 * 而主链没有现成的装配点。这里从 `ctx.vars`（正文生成可用的全部模板变量）提取，
 * 让 11 步正文路径在保存后能零 AI 跑第一、二层（规则 + 结构）。
 *
 * 字段缺失一律给安全默认值（空数组/空串），门禁按「无信息」处理而不是报错。
 */
import type { ChapterStateSnapshot, CharacterStateBrief, StoryBeat } from '@/engine/story-state-types';

/**
 * 从 `${allChars}` 行抽「- 名字：…」并读取若干字段
 *
 * @param charBlock - 字符块
 * @returns 结果数组
 */
function parseCharacterStates(charBlock: string | undefined): CharacterStateBrief[] {
    const states: CharacterStateBrief[] = [];
    for (const line of String(charBlock || '').split('\n')) {
        const match = line.match(/^\s*-\s*([^：:｜|]{2,12})[：:｜|]\s*(.*)$/);
        if (!match) continue;
        const name = match[1].trim();
        const rest = match[2] || '';
        const pick = (label: string): string => {
            const m = rest.match(new RegExp(`${label}[^｜|]*`));
            return m ? m[0].replace(new RegExp(`^${label}[：:]?`), '').trim() : '';
        };
        states.push({
            name,
            emotion: pick('当前情绪'),
            injury: pick('伤势'),
            goal: pick('当前目标') || pick('核心动机'),
            secret: '',
            relationships: '',
        });
        if (states.length >= 12) break;
    }
    return states;
}

/**
 * 从情节蒸馏里抽「- 节点N：描述」作为 required beats
 *
 * @param distilled - 蒸馏结果
 * @returns 结果数组
 */
function parseRequiredBeats(distilled: string | undefined): StoryBeat[] {
    const beats: StoryBeat[] = [];
    let index = 0;
    for (const line of String(distilled || '').split('\n')) {
        const m = line.match(/^\s*[-*]\s*(?:节点\s*\d+\s*[：:]|.*?[：:]\s*)?(.{6,80})/);
        if (!m) continue;
        const text = m[1].trim();
        if (!text) continue;
        index++;
        beats.push({
            id: `beat-${index}`,
            description: text,
            type: 'event',
            required: index <= 3, // 前 3 个节点视为必须完成
        });
        if (beats.length >= 8) break;
    }
    return beats;
}

function firstLine(text: string | undefined, fallback = ''): string {
    const line = String(text || '').split('\n').map(l => l.trim()).find(l => l.length > 0);
    return line || fallback;
}

/**
 * 闸门快照输入。
 */
export interface GateSnapshotInput {
    chapterNum: number;
    vars: Record<string, string>;
}

/**
 * 从步骤变量构建章节状态快照。
 *
 * @param input - 输入
 * @returns 章节状态快照
 */
export function buildGateSnapshotFromVars(input: GateSnapshotInput): ChapterStateSnapshot {
    const vars = input.vars || {};
    const conflict = firstLine(
        (vars.infoPlan || '').match(/核心冲突[：:]\s*(.+)/)?.[1] || vars.chapterHook || '',
        '（信息规划缺失，未提取核心冲突）',
    );
    const ending = String(vars.prevChapEnding || '').trim();
    const endingAction = ending.slice(0, 120);
    return {
        chapterNumber: input.chapterNum,
        timeline: {
            time: firstLine((vars.timelineEvents || '').split('\n')[0]?.replace(/^[|\-\s]+/, '').split('|')[0] || '', '未标注'),
            location: firstLine((vars.sceneCardDigest || '').match(/地点[：:]([^|]+)/)?.[1] || '', '未标注'),
        },
        povCharacter: vars.protagonistName || '主角',
        mainGoal: conflict,
        coreConflict: conflict,
        requiredBeats: parseRequiredBeats(vars.distilledContent).map(b => b.description),
        requiredReveals: [],
        forbiddenReveals: [],
        characterStates: parseCharacterStates(vars.allChars),
        previousEnding: {
            action: endingAction,
            emotion: '',
            unfinished: '',
            mustContinue: ending ? '本章开头必须衔接上一章结尾的时空与人物状态' : '',
        },
        acceptanceCriteria: [
            `字数 ≥ ${vars.baseWords || '3000'}`,
            '每个场景情绪有变化',
            '无未解释的逻辑跳跃',
        ],
    };
}
