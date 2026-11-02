/**
 * synopsis-spec.ts — 全书简介写作规格、评分与解析（纯函数）
 *
 * 参考精品网文简介的通用逻辑：首屏钩子、主角困境、金手指/变数、核心冲突、
 * 爽点承诺、终局悬念；四种风格各生成一版，用户挑最有感觉的。
 */

/**
 * 简介风格。
 */
export type SynopsisStyle = 'hook' | 'satisfaction' | 'character' | 'world';
/**
 * 简介长度档。
 */
export type SynopsisLength = 'short' | 'standard' | 'long';

/**
 * 风格元数据。
 */
export interface SynopsisStyleMeta {
    label: string;
    description: string;
    targetChars: number;
}

/**
 * 风格元数据表。
 */
export const SYNOPSIS_STYLE_META: Record<SynopsisStyle, SynopsisStyleMeta> = {
    hook: { label: '悬念型', description: '异常开局 + 真相悬念，先让读者想问“然后呢”', targetChars: 240 },
    satisfaction: { label: '爽点型', description: '困境 + 金手指 + 连续打脸/升级承诺', targetChars: 260 },
    character: { label: '人物型', description: '主角魅力、缺陷与选择，让读者先喜欢这个人', targetChars: 240 },
    world: { label: '世界观型', description: '独特规则 + 主角在规则中的位置与代价', targetChars: 260 },
};

/**
 * 长度范围。
 */
export const SYNOPSIS_LENGTH_RANGE: Record<SynopsisLength, { min: number; max: number; label: string }> = {
    short: { min: 120, max: 180, label: '短版 120-180 字' },
    standard: { min: 220, max: 320, label: '标准版 220-320 字' },
    long: { min: 350, max: 500, label: '长版 350-500 字' },
};

/**
 * 简介变体。
 */
export interface SynopsisVariant {
    style: SynopsisStyle;
    title: string;
    text: string;
    wordCount: number;
    selfCheck?: string;
}

/**
 * 简介上下文。
 */
export interface SynopsisContext {
    project: string;
    genre: string;
    description: string;
    worldviewExcerpt: string;
    protagonist: string;
    volumeSummary: string;
    openPromises: string;
}

/**
 * 简介提示词。
 */
export interface SynopsisPrompts {
    system: string;
    user: string;
}

const NEGATIVE_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
    { pattern: /这是一个.+?的故事/, message: '禁止“这是一个……的故事”式空泛开头' },
    { pattern: /且看|究竟|如何|命运|从此踏上|一路开挂|震惊全场|无数人|没有人知道/, message: '出现简介套话/陈词滥调' },
    { pattern: /^(?:[^。！？]{0,6})[，,]\s*(?:[^。！？]{0,6})[，,]/, message: '开头不要在背景信息上绕圈，先给钩子' },
];

/**
 * 简介评分表。
 */
export const SYNOPSIS_RUBRIC = [
    { key: 'hook', label: '首屏钩子', weight: 20 },
    { key: 'agency', label: '主角主动性', weight: 15 },
    { key: 'conflict', label: '冲突清晰度', weight: 15 },
    { key: 'promise', label: '爽点承诺', weight: 15 },
    { key: 'character', label: '人物魅力', weight: 10 },
    { key: 'freshness', label: '新鲜度', weight: 10 },
    { key: 'readability', label: '可读性', weight: 10 },
    { key: 'platform', label: '平台适配', weight: 5 },
] as const;

/**
 * 构建简介提示词。
 *
 * @param ctx - 上下文
 * @param length - 长度
 * @returns 提示词
 */
export function buildSynopsisPrompts(
    ctx: SynopsisContext,
    length: SynopsisLength = 'standard',
): SynopsisPrompts {
    const range = SYNOPSIS_LENGTH_RANGE[length];
    const styleList = (Object.keys(SYNOPSIS_STYLE_META) as SynopsisStyle[])
        .map(style => `- ${style}：${SYNOPSIS_STYLE_META[style].label}——${SYNOPSIS_STYLE_META[style].description}`)
        .join('\n');
    return {
        system: `你是一位擅长网文简介的资深编辑。请根据提供的全书资料，一次生成四种风格的简介。

【写作顺序——每一版都必须遵守】
1. 第一段 1-2 句：主角 + 异常处境/关键选择 + 悬念；禁止先讲世界观背景。
2. 第二段：主角想要什么、被什么阻止、代价是什么。
3. 第三段：金手指/变数/独特规则，以及它带来的爽点或危险。
4. 第四段：冲突升级与读者可期待的兑现（打脸、升级、复仇、守护、揭秘等）。
5. 最后一句：留下一个具体悬念或反转，不要总结全书。

【硬性要求】
- 总字数：${range.label}（${range.min}-${range.max} 字）
- 短句优先，少用形容词堆砌；像在跟读者说话，不像出版简介。
- 必须让读者清楚：主角是谁、要做什么、为什么难、看下去能看到什么。
- 禁止剧透结局；禁止罗列境界/设定表；禁止“且看”“究竟”“命运”“从此踏上”“一路开挂”“震惊全场”等套话。
- 四版必须真正不同：悬念型重谜团，爽点型重兑现，人物型重魅力，世界观型重规则。
- 只输出 JSON 数组，不要 Markdown 代码块，不要解释。

【输出格式】
[
  {"style":"hook","title":"可选书名","text":"完整简介","selfCheck":"一句话说明钩子是什么"},
  {"style":"satisfaction","title":"可选书名","text":"完整简介","selfCheck":"一句话说明爽点承诺"},
  {"style":"character","title":"可选书名","text":"完整简介","selfCheck":"一句话说明人物魅力"},
  {"style":"world","title":"可选书名","text":"完整简介","selfCheck":"一句话说明世界规则"}
]

【四种风格】
${styleList}`,
        user: `【项目】${ctx.project}
【题材】${ctx.genre || '未设定'}
【一句话设定】${ctx.description || '未设定'}
【主角】${ctx.protagonist || '未设定'}
【世界观摘要】
${ctx.worldviewExcerpt || '未设定'}
【分卷/全书大纲摘要】
${ctx.volumeSummary || '未设定'}
【未兑现承诺】
${ctx.openPromises || '未设定'}

请生成四版简介。`,
    };
}

/**
 * 解析简介变体。
 *
 * @param content - 内容
 * @returns 变体数组
 */
export function parseSynopsisVariants(content: string): SynopsisVariant[] {
    const cleaned = String(content || '')
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    let parsed: unknown = null;
    try {
        if (arrayMatch) parsed = JSON.parse(arrayMatch[0]);
        else if (objectMatch) parsed = [JSON.parse(objectMatch[0])];
    } catch {
        parsed = null;
    }
    if (!parsed) {
        // 模型偶尔只给一段正文：保留为悬念型，不让用户白等
        if (cleaned.length >= 80) {
            return [{
                style: 'hook',
                title: '',
                text: cleaned.slice(0, 800),
                wordCount: countChars(cleaned),
                selfCheck: '模型未返回结构化数组，已按单版保存',
            }];
        }
        return [];
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const variants: SynopsisVariant[] = [];
    const seen = new Set<SynopsisStyle>();
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const raw = item as Record<string, unknown>;
        const style = normalizeStyle(raw.style);
        if (seen.has(style)) continue;
        const text = String(raw.text || '').trim();
        if (!text) continue;
        seen.add(style);
        variants.push({
            style,
            title: String(raw.title || '').trim(),
            text,
            wordCount: countChars(text),
            selfCheck: String(raw.selfCheck || '').trim(),
        });
    }
    return variants;
}

/**
 * 简介校验结果。
 */
export interface SynopsisValidation {
    score: number;
    issues: string[];
    charCount: number;
}

/**
 * 校验简介文本。
 *
 * @param text - 文本内容
 * @param style - 文风
 * @param length - 长度
 * @returns 校验结果
 */
export function validateSynopsisText(text: string, style: SynopsisStyle, length: SynopsisLength = 'standard'): SynopsisValidation {
    const charCount = countChars(text);
    const issues: string[] = [];
    const range = SYNOPSIS_LENGTH_RANGE[length];
    if (charCount < range.min) issues.push(`字数偏少（${charCount} < ${range.min}）`);
    if (charCount > range.max + 80) issues.push(`字数偏多（${charCount} > ${range.max}）`);
    for (const item of NEGATIVE_PATTERNS) {
        if (item.pattern.test(text)) issues.push(item.message);
    }
    const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    if (paragraphs.length < 2) issues.push('段落过少，简介需要至少 2 段');
    if (!/[？?！!]/.test(paragraphs[0] || '')) issues.push('首段缺少钩子式问句/感叹，读者可能没有继续读的理由');
    if (style === 'hook' && !/(竟然|却|直到|没想到|原来|不该|秘密|真相)/.test(text)) {
        issues.push('悬念型缺少反转/真相信号');
    }
    if (style === 'satisfaction' && !/(打脸|反击|升级|兑现|碾压|翻身|逆袭|奖励|变强)/.test(text)) {
        issues.push('爽点型缺少可期待的兑现承诺');
    }
    const penalty = Math.min(60, issues.length * 12);
    return { score: Math.max(0, 90 - penalty), issues, charCount };
}

/**
 * 统计字符数。
 *
 * @param text - 文本内容
 * @returns 数量
 */
export function countChars(text: string): number {
    return (text || '').replace(/\s/g, '').length;
}

function normalizeStyle(raw: unknown): SynopsisStyle {
    const value = String(raw || '').trim().toLowerCase();
    if (value === 'satisfaction' || value === '爽点' || value === '爽点型') return 'satisfaction';
    if (value === 'character' || value === '人物' || value === '人物型') return 'character';
    if (value === 'world' || value === '世界观' || value === '世界观型') return 'world';
    return 'hook';
}

/**
 * 风格中文名。
 *
 * @param style - 文风
 * @returns 名称
 */
export function styleLabel(style: SynopsisStyle): string {
    return SYNOPSIS_STYLE_META[style]?.label || style;
}