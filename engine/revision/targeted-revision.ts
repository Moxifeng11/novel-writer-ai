/**
 * targeted-revision.ts — 按维度、按片段执行的定向修订
 *
 * 与旧 iterativeRefine 的区别：
 * - 输入是结构化 issues，不再泛泛“再检查一遍”；
 * - 每个 pass 只改一个维度；
 * - 只替换命中的段落/场景，不整章重写；
 * - 可选评分回调，分数下降则回滚该 pass。
 */
import type {
    RevisionDimension,
    RevisionIssue,
    RevisionPassResult,
    TargetedRevisionResult,
} from './revision-types';
import { buildRevisionPlan } from './quality-issue-parser';
import { buildRevisionSystemPrompt, buildRevisionUserPrompt } from './revision-prompts';
import { createLogger } from '../../shared/logger';

const log = createLogger('TargetedRevision');

/**
 * RevisionCallAI 类型定义。
 */
export interface RevisionCallAI {
    (systemPrompt: string, userPrompt: string): Promise<{ content: string; error?: string }>;
}

/**
 * 修订上下文结构定义。
 */
export interface RevisionContext {
    sceneCard?: string;
    score?: (body: string) => number;
}

interface TextRange {
    start: number;
    end: number;
    excerpt: string;
}

function splitParagraphs(text: string): TextRange[] {
    const ranges: TextRange[] = [];
    const re = /(?:^|\n)([^\n]+(?:\n(?!\n)[^\n]+)*)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
        const raw = match[1];
        if (!raw.trim()) continue;
        const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
        ranges.push({ start, end: start + raw.length, excerpt: raw });
    }
    return ranges;
}

function findSceneRange(text: string, sceneNum: number): TextRange | null {
    const heading = new RegExp(`^#{1,6}\\s*(?:场景|Scene)\\s*${sceneNum}\\s*[：:]`, 'im');
    const m = heading.exec(text);
    if (!m) return null;
    const start = m.index;
    const next = new RegExp(`^#{1,6}\\s*(?:场景|Scene)\\s*\\d+\\s*[：:]`, 'gim');
    next.lastIndex = start + m[0].length;
    const nextMatch = next.exec(text);
    const end = nextMatch ? nextMatch.index : text.length;
    return { start, end, excerpt: text.slice(start, end) };
}

function keywordScore(text: string, dimension: RevisionDimension): number {
    const keywords: Record<RevisionDimension, string[]> = {
        dialogue: ['说', '问', '答', '道', '「', '“'],
        rhythm: ['然后', '于是', '随后', '接着', '片刻', '良久'],
        description: ['看见', '听见', '闻到', '感觉', '目光', '风', '雨'],
        hook: ['最后', '终于', '突然', '没想到', '原来'],
        continuity: ['之前', '上一章', '后来', '已经', '记得'],
        style: ['仿佛', '似乎', '不由得', '莫名', '嘴角', '眼中'],
    };
    return (keywords[dimension] || []).reduce((sum, k) => sum + (text.includes(k) ? 1 : 0), 0);
}

/**
 * 为一个维度选择最小可修订片段。
 *
 * @param body - 正文
 * @param dimension - 维度
 * @param issues - 问题列表
  * @returns TextRange 或 null
 */
export function selectRevisionTarget(
    body: string,
    dimension: RevisionDimension,
    issues: RevisionIssue[],
): TextRange | null {
    const relevant = issues.filter(i => i.dimension === dimension);
    for (const issue of relevant) {
        const sceneMatch = issue.location?.match(/场景(\d+)/);
        if (sceneMatch) {
            const scene = findSceneRange(body, parseInt(sceneMatch[1], 10));
            if (scene) return scene;
        }
        const paraMatch = issue.location?.match(/第(\d+)段/);
        if (paraMatch) {
            const paras = splitParagraphs(body);
            const target = paras[parseInt(paraMatch[1], 10) - 1];
            if (target) return target;
        }
        const probe = issue.evidence.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').slice(0, 12);
        if (probe.length >= 4) {
            const paras = splitParagraphs(body);
            const hit = paras.find(p => p.excerpt.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').includes(probe));
            if (hit) return hit;
        }
    }

    // 没有定位：选该维度关键词最集中的段落；整章都无信号时不动
    const paras = splitParagraphs(body);
    let best: TextRange | null = null;
    let bestScore = 0;
    for (const p of paras) {
        const score = keywordScore(p.excerpt, dimension);
        if (score > bestScore) {
            best = p;
            bestScore = score;
        }
    }
    return bestScore >= 2 ? best : null;
}

function cleanAIOutput(content: string): string {
    return content
        .replace(/^```(?:markdown|md|text)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

function validateReplacement(original: string, revised: string): string | null {
    if (!revised.trim()) return 'AI 返回空内容';
    const ratio = revised.length / Math.max(1, original.length);
    if (ratio < 0.55 || ratio > 1.8) return `修订片段长度异常（${Math.round(ratio * 100)}%）`;
    if (revised.includes('修改说明') || revised.includes('【修订')) return 'AI 返回了说明而不是正文';
    return null;
}

/**
 * runTargetedRevision 函数。
 * @param input - 输入
  * @returns TargetedRevisionResult 实例
 */
export async function runTargetedRevision(input: {
    body: string;
    issues: RevisionIssue[];
    callAI: RevisionCallAI;
    context?: RevisionContext;
    maxPasses?: number;
}): Promise<TargetedRevisionResult> {
    const plan = buildRevisionPlan(input.issues, input.maxPasses ?? 3);
    let body = input.body;
    const passes: RevisionPassResult[] = [];
    if (plan.passes.length === 0) {
        return { body, passes, changed: false };
    }

    for (const dimension of plan.passes) {
        const target = selectRevisionTarget(body, dimension, input.issues);
        if (!target) {
            passes.push({ dimension, changed: false, notes: '未找到需要修订的片段' });
            continue;
        }
        const before = body.slice(0, target.start);
        const after = body.slice(target.end);
        const prompt = buildRevisionUserPrompt(dimension, target.excerpt, input.issues, {
            before: before.slice(-600),
            after: after.slice(0, 600),
            sceneCard: input.context?.sceneCard,
        });
        let response: { content: string; error?: string };
        try {
            response = await input.callAI(buildRevisionSystemPrompt(dimension), prompt);
        } catch (e) {
            passes.push({ dimension, changed: false, error: e instanceof Error ? e.message : String(e) });
            break;
        }
        if (response.error) {
            passes.push({ dimension, changed: false, error: response.error });
            break;
        }
        const revised = cleanAIOutput(response.content);
        const invalid = validateReplacement(target.excerpt, revised);
        if (invalid) {
            passes.push({ dimension, changed: false, error: invalid });
            continue;
        }
        const nextBody = `${before}${revised}${after}`;
        if (nextBody === body) {
            passes.push({ dimension, changed: false, notes: '修订结果与原文相同' });
            continue;
        }
        if (input.context?.score) {
            const beforeScore = input.context.score(body);
            const afterScore = input.context.score(nextBody);
            if (afterScore + 2 < beforeScore) {
                passes.push({ dimension, changed: false, notes: `评分下降 ${beforeScore}→${afterScore}，已回滚` });
                continue;
            }
        }
        body = nextBody;
        passes.push({ dimension, changed: true, notes: `修订 ${target.excerpt.length} 字片段` });
        log.info(`[TargetedRevision] ${dimension} pass 完成`);
    }

    return { body, passes, changed: body !== input.body };
}
