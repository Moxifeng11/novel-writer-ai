/**
 * agent-nlu.ts — 对话引导 Agent 的 AI 槽位解析
 *
 * 把用户一句话拆成待填槽位；失败返回 null，由引擎回退到 chips/序号匹配。
 * 只解析 missing 中的槽位，不编造未询问的字段。
 */
import type NovelWriterPlugin from '../../main';
import type { AgentContext, AgentSlots, GuideAgentPort } from '../../engine/agent/agent-types';
import { STORY_STRUCTURES } from '../../shared/story-structure';
import { extractResponseText } from '../../shared/api-response-utils';

const SLOT_LABELS: Record<string, string> = {
    projectName: '项目名（2-20 字符，中文/字母/数字，不含空格标点）',
    genre: '题材（1-12 字）',
    projectType: '类型，只能填 original（原创）或 fanfic（同人）',
    sourceWork: '原作名称',
    channel: '目标频道，只能填：男频/女频/通用',
    longVariant: '长篇路径，只能填：original（原创）/fanfic（同人）',
    fanficType: '同人类型，如：原著向/CP向/IF线/衍生/群像',
    canonScope: '对原作改动范围，如：只改支线/重写结局/平行世界/前传/后传',
    structureId: `故事结构，只能填：${STORY_STRUCTURES.map(s => s.id).join('/')}`,
    tone: '叙事基调（如：热血爽文/悬疑冷峻/温情治愈/黑暗史诗/轻松诙谐/悲壮苍凉）',
    goldenFinger: '金手指（如：系统/重生记忆/穿越知识/血脉觉醒/神秘器物/读心/时间回溯/无金手指）',
    shortCategory: '番茄短篇分类名称，必须来自平台分类列表',
    premise: '一句话故事（10-200字）',
    coreConflict: '核心冲突（6-160字）',
    emotionalPromise: '情绪承诺（4-120字）',
    reversals: '反转设计（6-220字）',
    endingPayoff: '结尾兑现（6-180字）',
    characterCore: '主角核心欲望与软肋（4-160字）',
    scriptGenre: '红果短剧类型名称',
    logline: '一句话 logline（10-160字）',
    hook3s: '前3秒钩子（6-120字）',
    payoff: '核心爽点/兑现（6-160字）',
    characters: '主要角色与关系（10-260字）',
    scenes: '核心场景/名场面（10-260字）',
    targetEpisodes: '目标集数，40-120 的数字',
    paywallEpisode: '强付费卡点集数，1-120 的数字',
};

export function createAiNlu(plugin: NovelWriterPlugin): NonNullable<GuideAgentPort['aiParse']> {
    return async (text: string, _ctx: AgentContext, missing: string[]): Promise<Partial<AgentSlots> | null> => {
        const trimmed = String(text || '').trim();
        if (trimmed.length < 2 || missing.length === 0) return null;

        const system = '你是小说工坊的对话槽位解析器。从用户输入中抽取指定槽位，只输出一个 JSON 对象，不要 Markdown 代码块，不要解释。未提及的槽位不要输出。';
        const user = [
            `待抽取槽位：`,
            ...missing.map(key => `- ${key}: ${SLOT_LABELS[key] || key}`),
            '',
            `用户输入：${trimmed}`,
            '',
            '输出示例：{"projectName":"九霄逆行","genre":"玄幻","structureId":"three_act"}',
        ].join('\n');

        try {
            const result = await plugin.aiEngine.callAI(system, user, undefined, 0.2, 512, { bypassCache: true });
            if (result.error) return null;
            const match = extractResponseText(result.content || '').match(/\{[\s\S]*\}/);
            if (!match) return null;
            const data = JSON.parse(match[0]) as Record<string, unknown>;
            const partial: Partial<AgentSlots> = {};
            for (const key of missing) {
                const value = data[key];
                if (typeof value !== 'string') continue;
                const cleaned = value.trim();
                if (!cleaned) continue;
                (partial as Record<string, unknown>)[key] = cleaned;
            }
            return Object.keys(partial).length > 0 ? partial : null;
        } catch {
            return null;
        }
    };
}
