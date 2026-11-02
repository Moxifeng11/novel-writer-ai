/**
 * context-hygiene.ts — 发 prompt 之前的上下文体检（纯函数）
 *
 * 背景：正文 prompt 由 30+ 个段拼成，其中不少段来源不同步（步骤结果、世界书、上章回写、
 * 知识/记忆注入）。实测最容易出现的两类污染不是「内容不好」，而是：
 *
 *   1. 同一段内容被两个变量各注入一次（规则×文笔风格、世界观×设定库、场景展开×场景卡）；
 *   2. 步骤结果来自别的章（目录里只剩旧文件、按名字模糊匹配），模型会照着上一章的资料写本章。
 *
 * 这里只做两件可判定的事：**重复段**（2-gram 相似度）与**串章**（章节号与当前章不符）。
 * 不做语义冲突判断——那需要结构化事实，贸然自动改稿风险更大。
 */

export interface ContextBlock {
    key: string;
    label: string;
    text: string;
}

/**
 * HygieneIssueType 类型定义。
 */
export type HygieneIssueType = 'duplicate' | 'staleChapter' | 'conflict';

/**
 * HygieneIssue 类型定义。
 */
export interface HygieneIssue {
    type: HygieneIssueType;
    severity: 'high' | 'medium' | 'low';
    /** 涉及的变量 key（重复段是两个，串章是一个） */
    blocks: string[];
    message: string;
}

/**
 * HygieneResult 类型定义。
 */
export interface HygieneResult {
    issues: HygieneIssue[];
    /** 命中重复、建议清空的变量（保留优先级更高的那个） */
    dropKeys: string[];
    checked: number;
}

/** 重复检测只看这些段（其余段短小或本来就该重复，例如世界观与设定库可能局部重合） */
const DUPLICATE_SCAN_KEYS = [
    'writingRules', 'writingStyle', 'writingStyleContent', 'humanVoice',
    'worldView', 'settingLib', 'prevChapEnding', 'prevChaptersSummary',
    'sceneExpansion', 'sceneCardDigest', 'infoPlan', 'outlineContent',
    'distilledContent', 'emotionPlan', 'longTermMemory', 'storyContextPack',
];

/** 这些段必须属于「当前章」；出现别的章节号就是串章信号 */
const CURRENT_CHAPTER_KEYS = [
    'infoPlan', 'outlineContent', 'distilledContent', 'sceneExpansion', 'sceneCardDigest', 'emotionPlan',
];

/** 清空时保留谁：越靠前越权威（保留靠前的那个）。场景卡是硬约束，优先于散文式的场景展开。 */
const KEEP_PRIORITY = [
    'writingRules', 'worldView', 'settingLib', 'infoPlan', 'outlineContent',
    'distilledContent', 'sceneCardDigest', 'sceneExpansion', 'emotionPlan',
    'prevChapEnding', 'humanVoice', 'writingStyleContent', 'writingStyle',
    'storyContextPack', 'longTermMemory', 'prevChaptersSummary',
];

const MIN_DUPLICATE_CHARS = 200;
const DUPLICATE_RATIO = 0.85;

function normalize(text: string): string {
    return String(text || '').replace(/[\s\u3000]+/g, '').replace(/[，。！？；：“”「」『』、（）()【】\[\]—-]/g, '');
}

/**
 * 2-gram 集合相似度（Dice 系数）；短文本返回 0，避免误判
 *
 * @param a - 参与比较的值
 * @param b - 参与比较的值
 * @returns 数值结果
 */
export function bigramSimilarity(a: string, b: string): number {
    const x = normalize(a);
    const y = normalize(b);
    if (x.length < MIN_DUPLICATE_CHARS || y.length < MIN_DUPLICATE_CHARS) return 0;
    if (x === y) return 1;
    const grams = (s: string): Map<string, number> => {
        const map = new Map<string, number>();
        for (let i = 0; i < s.length - 1; i++) {
            const gram = s.slice(i, i + 2);
            map.set(gram, (map.get(gram) || 0) + 1);
        }
        return map;
    };
    const ga = grams(x);
    const gb = grams(y);
    let overlap = 0;
    for (const [gram, count] of ga) {
        const other = gb.get(gram);
        if (other) overlap += Math.min(count, other);
    }
    return (2 * overlap) / (x.length - 1 + (y.length - 1));
}

/**
 * 从正文里抽出「第N章」的章节号（去重，按出现顺序）
 *
 * @param text - 文本内容
 * @returns 结果数组
 */
export function extractChapterNumbers(text: string): number[] {
    const found: number[] = [];
    for (const match of String(text || '').matchAll(/第\s*(\d+)\s*章/g)) {
        const n = parseInt(match[1], 10);
        if (Number.isFinite(n) && !found.includes(n)) found.push(n);
    }
    return found;
}

/**
 * 上下文体检。
 * @param blocks 参与注入的段（key/label/text）
 * @param chapterNum 当前章号（用于串章判定）
 * @param options - 配置项
  * @returns HygieneResult 实例
 */
export function auditContextBlocks(
    blocks: readonly ContextBlock[],
    options: { chapterNum: number },
): HygieneResult {
    const issues: HygieneIssue[] = [];
    const dropKeys: string[] = [];
    const byKey = new Map(blocks.map((block) => [block.key, block]));

    // 1) 重复段：两两比较（段数最多几十，O(n²) 可接受）
    const scan = DUPLICATE_SCAN_KEYS
        .map((key) => byKey.get(key))
        .filter((block): block is ContextBlock => Boolean(block))
        .filter((block) => normalize(block.text).length >= MIN_DUPLICATE_CHARS);

    for (let i = 0; i < scan.length; i++) {
        for (let j = i + 1; j < scan.length; j++) {
            const a = scan[i];
            const b = scan[j];
            const ratio = bigramSimilarity(a.text, b.text);
            if (ratio < DUPLICATE_RATIO) continue;
            const keep = KEEP_PRIORITY.indexOf(a.key) <= KEEP_PRIORITY.indexOf(b.key) ? a.key : b.key;
            const drop = keep === a.key ? b.key : a.key;
            issues.push({
                type: 'duplicate',
                severity: ratio >= 0.95 ? 'high' : 'medium',
                blocks: [a.key, b.key],
                message: `「${byKey.get(a.key)?.label || a.key}」与「${byKey.get(b.key)?.label || b.key}」内容重复 ${(ratio * 100).toFixed(0)}%，保留前者`,
            });
            if (!dropKeys.includes(drop)) dropKeys.push(drop);
        }
    }

    // 2) 串章：步骤结果里出现的章节号都不是当前章（且至少出现 2 次，避免一句「见第3章」误判）
    for (const key of CURRENT_CHAPTER_KEYS) {
        const block = byKey.get(key);
        if (!block || !block.text) continue;
        const numbers = extractChapterNumbers(block.text);
        if (numbers.length === 0) continue;
        if (numbers.includes(options.chapterNum)) continue;
        const mentions = (block.text.match(/第\s*\d+\s*章/g) || []).length;
        if (mentions < 2) continue;
        issues.push({
            type: 'staleChapter',
            severity: 'high',
            blocks: [key],
            message: `「${block.label}」引用的章节是 ${numbers.map((n) => `第${n}章`).join('、')}，与当前第${options.chapterNum}章不符（疑似读到旧步骤结果）`,
        });
    }

    return { issues, dropKeys, checked: scan.length };
}

/**
 * 一行摘要（注入账本用）
 *
 * @param result - 结果
 * @returns 文本结果
 */
export function formatContextHygiene(result: HygieneResult): string {
    if (result.issues.length === 0) return '';
    const dup = result.issues.filter((issue) => issue.type === 'duplicate').length;
    const stale = result.issues.filter((issue) => issue.type === 'staleChapter').length;
    const conflict = result.issues.filter((issue) => issue.type === 'conflict').length;
    const parts = [
        dup > 0 ? `${dup} 处重复${result.dropKeys.length > 0 ? `（已清空 ${result.dropKeys.join('、')}）` : ''}` : '',
        conflict > 0 ? `${conflict} 处规则冲突` : '',
        stale > 0 ? `${stale} 处疑似串章` : '',
    ].filter(Boolean);
    return `【上下文体检】${parts.join(' / ')}`;
}

/**
 * 文笔风格 vs 写作规则的格式冲突。
 *
 * 实测（2026-10-31）：项目的 `文笔风格.md` 里仍写着「每段仅一个句号，句号后必须换行」，
 * 而写作规则是「自然段 2–6 句、80–220 字」。两段都进 prompt，模型通常听更具体、更靠后的
 * 文笔风格 → 输出被重新打碎。这里检测这种「段落形态」级冲突，并可只剔除冲突行（不改用户文件）。
 */
const STYLE_FRAGMENT_PATTERNS: Array<{ re: RegExp; label: string }> = [
    { re: /每段(?:仅|只)?(?:有)?(?:一个|1个)句号/, label: '每段仅一个句号' },
    { re: /句号后(?:必须)?换行/, label: '句号后必须换行' },
    { re: /一句一段|一段一句/, label: '一句一段' },
    { re: /每段(?:仅|只)(?:写)?一句/, label: '每段只写一句' },
];

/**
 * 规则里是否给了「自然段」正向锚点（这是与碎段冲突的判定依据）
 *
 * @param rulesText - 规则集文本
 * @returns 是否成功
 */
export function hasParagraphAnchor(rulesText: string): boolean {
    // v4.26：规则改为引导版，「每段开头空两格」就是格式锚点；
    // 旧版「自然段 2–6 句」仍兼容（存量项目文件）。
    return /每段开头空两格/.test(String(rulesText || ''))
        || /自然段\s*[2２][–\-~—]\s*6\s*句|80\s*[–\-~—]\s*220\s*字/.test(String(rulesText || ''));
}

/**
 * StyleConflictResult 类型定义。
 */
export interface StyleConflictResult {
    /** 命中的冲突标签 */
    conflicts: string[];
    /** 剔除冲突行后的文笔风格（未命中时原样返回） */
    cleaned: string;
    /** 被剔除的行 */
    trimmedLines: string[];
    /** 剔除比例过高（>60%）时为 true：只告警不清空，避免把风格文件削空 */
    tooMuchTrimmed: boolean;
    /** 生效规则没有「自然段」锚点：此时无法靠剔除化解，只能提示换规则版本 */
    rulesLackAnchor: boolean;
}

/**
 * resolveStyleConflicts 函数。
 * @param styleText - 文风文本
 * @param rulesText - 规则集文本
  * @returns StyleConflictResult 实例
 */
export function resolveStyleConflicts(styleText: string, rulesText: string): StyleConflictResult {
    const text = String(styleText || '');
    const anchor = hasParagraphAnchor(rulesText);
    if (!text.trim()) {
        return { conflicts: [], cleaned: text, trimmedLines: [], tooMuchTrimmed: false, rulesLackAnchor: !anchor };
    }
    const lines = text.split('\n');
    const kept: string[] = [];
    const trimmedLines: string[] = [];
    const conflicts: string[] = [];
    for (const line of lines) {
        const hits = STYLE_FRAGMENT_PATTERNS.filter((pattern) => pattern.re.test(line));
        if (hits.length > 0) {
            for (const hit of hits) conflicts.push(hit.label);
            trimmedLines.push(line.trim());
            continue;
        }
        kept.push(line);
    }
    if (trimmedLines.length === 0) {
        return { conflicts: [], cleaned: text, trimmedLines: [], tooMuchTrimmed: false, rulesLackAnchor: !anchor };
    }
    // 规则本身没有自然段锚点时不能剔：那等于让风格文件单方面改口径，用户无法预期
    if (!anchor) {
        return { conflicts, cleaned: text, trimmedLines: [], tooMuchTrimmed: false, rulesLackAnchor: true };
    }
    const trimmedChars = trimmedLines.join('').length;
    const tooMuchTrimmed = trimmedChars / Math.max(1, text.length) > 0.6;
    return {
        conflicts: [...new Set(conflicts)],
        cleaned: tooMuchTrimmed ? text : kept.join('\n'),
        trimmedLines,
        tooMuchTrimmed,
        rulesLackAnchor: false,
    };
}
