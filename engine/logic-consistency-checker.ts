/**
 * logic-consistency-checker.ts — C1 逻辑一致性轻审查（同步启发式）
 *
 * 面向协同写作工作台实时监控：不调用 AI、不落盘、不弹 Notice。
 */

export type LogicIssueType =
    | 'time_conflict'
    | 'injury_action_conflict'
    | 'knowledge_boundary'
    | 'location_jump'
    | 'identity_conflict';

/**
 * LogicConsistencyIssue 类型定义。
 */
export interface LogicConsistencyIssue {
    type: LogicIssueType;
    severity: 'low' | 'medium' | 'high';
    message: string;
    sample: string;
    suggestion: string;
}

/**
 * LogicConsistencyReport 类型定义。
 */
export interface LogicConsistencyReport {
    issues: LogicConsistencyIssue[];
    paragraphCount: number;
    checkedAt: number;
}

const TIME_GROUPS = [
    { name: '清晨/白天', words: ['清晨', '早晨', '晨光', '天亮', '白天', '正午', '午后'] },
    { name: '夜晚/深夜', words: ['夜里', '夜晚', '深夜', '子时', '月光', '天黑', '黄昏'] }
];

const INJURY_WORDS = ['重伤', '昏迷', '断骨', '吐血', '濒死', '气绝', '动弹不得'];
const ACTION_WORDS = ['飞奔', '狂奔', '纵身', '挥剑', '厮杀', '追上', '跃起', '冲出'];
const MODERN_WORDS = ['手机', '电脑', '网络', '电梯', '汽车', '飞机', '微信', '短信', '摄像头'];
const LOCATION_WORDS = ['京城', '山门', '客栈', '皇宫', '战场', '密室', '山洞', '街道', '城门', '院子', '大殿'];
const IDENTITY_PAIRS = [
    ['从未见过', '认出'],
    ['不知道', '早已知道'],
    ['陌生人', '故人'],
    ['敌人', '盟友']
];

function splitParagraphs(body: string): string[] {
    return (body || '')
        .split(/\n{2,}|\r?\n/)
        .map(p => p.trim())
        .filter(Boolean)
        .slice(-18);
}

function hasAny(text: string, words: string[]): string[] {
    return words.filter(word => text.includes(word));
}

function pushIssue(issues: LogicConsistencyIssue[], issue: LogicConsistencyIssue): void {
    if (issues.some(existing => existing.type === issue.type && existing.sample === issue.sample)) return;
    issues.push(issue);
}

/**
 * analyzeLogicConsistency 函数。
 * @param body - 正文
  * @returns LogicConsistencyReport 实例
 */
export function analyzeLogicConsistency(body: string): LogicConsistencyReport {
    const paragraphs = splitParagraphs(body);
    const issues: LogicConsistencyIssue[] = [];

    paragraphs.forEach((paragraph, index) => {
        const label = `第${index + 1}段`;
        const matchedTimeGroups = TIME_GROUPS
            .map(group => ({ group: group.name, hits: hasAny(paragraph, group.words) }))
            .filter(result => result.hits.length > 0);
        if (matchedTimeGroups.length >= 2) {
            pushIssue(issues, {
                type: 'time_conflict',
                severity: 'medium',
                message: `${label} 同时出现昼夜时间词，可能造成时间线跳变`,
                sample: matchedTimeGroups.map(item => item.hits.slice(0, 2).join('/')).join(' vs '),
                suggestion: '拆成明确的转场，或保留一个主时间锚点。'
            });
        }

        const injuries = hasAny(paragraph, INJURY_WORDS);
        const actions = hasAny(paragraph, ACTION_WORDS);
        if (injuries.length > 0 && actions.length > 0) {
            pushIssue(issues, {
                type: 'injury_action_conflict',
                severity: 'high',
                message: `${label} 伤势与高强度动作相邻，角色行动能力可能矛盾`,
                sample: `${injuries[0]} / ${actions[0]}`,
                suggestion: '补一句恢复、强撑代价或外力协助，避免角色状态断裂。'
            });
        }

        const modern = hasAny(paragraph, MODERN_WORDS);
        if (modern.length > 0) {
            pushIssue(issues, {
                type: 'knowledge_boundary',
                severity: 'medium',
                message: `${label} 出现现代/跨世界词汇，检查是否符合项目设定`,
                sample: modern.slice(0, 3).join('、'),
                suggestion: '若不是现代题材，请改成世界观内等价物或解释来源。'
            });
        }

        const locations = hasAny(paragraph, LOCATION_WORDS);
        if (new Set(locations).size >= 3 && !/(转眼|片刻后|一路|赶到|回到|离开|与此同时)/.test(paragraph)) {
            pushIssue(issues, {
                type: 'location_jump',
                severity: 'low',
                message: `${label} 多个地点连续出现但缺少转场词`,
                sample: Array.from(new Set(locations)).slice(0, 4).join(' → '),
                suggestion: '增加移动、切场或视角转移提示。'
            });
        }

        for (const pair of IDENTITY_PAIRS) {
            if (pair.every(word => paragraph.includes(word))) {
                pushIssue(issues, {
                    type: 'identity_conflict',
                    severity: 'medium',
                    message: `${label} 人物认知/身份表述可能前后冲突`,
                    sample: pair.join(' / '),
                    suggestion: '明确这是误判、伪装揭露，还是叙述错误。'
                });
            }
        }
    });

    return { issues: issues.slice(0, 8), paragraphCount: paragraphs.length, checkedAt: Date.now() };
}
