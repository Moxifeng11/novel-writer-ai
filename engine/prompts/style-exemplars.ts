/**
 * style-exemplars.ts — 真人样文的运行时选择与注入（样文优先策略的核心）
 *
 * 背景（实测取证）：`human-voice.ts` 旧版是 23 条数值配额 + 20 个禁用词，
 * 模型逐条达标后产出「每项都刚好合格」的均匀文本——AI 感恰恰来自这种均匀。
 * 仓库里 10 套文风预设的「零、参考样本」30 个槽位全空，全链路没有一段正例样文。
 *
 * 这里把本地抽样的真人文本（`data/human-samples/*.json`，仅本机、不入包）按
 * 场景类型挑 2–3 段注入提示词，让模型「照着写」而不是「照着禁令不犯错」。
 */

export interface ExemplarSample {
    /** 来源书名（只在账本/调试里出现，不进 prompt 正文） */
    book: string;
    /** 场景类型：战斗/冲突、日常/对话、情绪/心理、补充 */
    kind: string;
    text: string;
}

const MAX_LIBRARY = 400;
let library: ExemplarSample[] = [];

/**
 * 由宿主（UI 层）在启动时把本地样文灌进来
 *
 * @param samples - 样本
 */
export function setExemplarLibrary(samples: ExemplarSample[]): void {
    library = (samples || [])
        .filter((sample) => sample && typeof sample.text === 'string' && sample.text.trim().length >= 120)
        .slice(0, MAX_LIBRARY)
        .map((sample) => ({ book: sample.book || 'unknown', kind: sample.kind || '补充', text: sample.text.trim() }));
}

export function getExemplarLibrary(): readonly ExemplarSample[] {
    return library;
}

export function hasExemplars(): boolean {
    return library.length > 0;
}

/** 测试用 */
export function clearExemplarLibrary(): void {
    library = [];
}

const KIND_ORDER = ['战斗/冲突', '日常/对话', '情绪/心理'];

export interface SelectOptions {
    /** 期望的场景类型（按顺序尽量覆盖） */
    kinds?: string[];
    /** 每段最多字符数（超出截到句末） */
    perSampleChars?: number;
    /** 最多几段 */
    limit?: number;
}

/**
 * 截到句末标点，避免把样文切成半句
 *
 * @param text - 文本内容
 * @param maxChars - 最大字符数
 * @returns 文本结果
 */
function cutAtSentence(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const head = text.slice(0, maxChars);
    const lastStop = Math.max(
        head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'), head.lastIndexOf('…'),
    );
    return lastStop > maxChars * 0.5 ? head.slice(0, lastStop + 1) : head;
}

/**
 * 按场景类型挑样文：优先覆盖战斗/日常/心理三类，不足则按库内顺序补。
 * 不做语义检索（样文是风格参照，场景覆盖面比语义相似更重要）。
 * @param options - 配置项
 * @returns 结果数组
 */
export function selectExemplars(options: SelectOptions = {}): ExemplarSample[] {
    if (library.length === 0) return [];
    const limit = Math.max(1, Math.min(4, options.limit ?? 3));
    const perSampleChars = Math.max(150, options.perSampleChars ?? 480);
    const kinds = options.kinds && options.kinds.length > 0 ? options.kinds : KIND_ORDER;
    const picked: ExemplarSample[] = [];
    const used = new Set<number>();

    for (const kind of kinds) {
        if (picked.length >= limit) break;
        const index = library.findIndex((sample, i) => !used.has(i) && sample.kind === kind);
        if (index < 0) continue;
        used.add(index);
        picked.push({ ...library[index], text: cutAtSentence(library[index].text, perSampleChars) });
    }
    for (let i = 0; i < library.length && picked.length < limit; i++) {
        if (used.has(i)) continue;
        used.add(i);
        picked.push({ ...library[i], text: cutAtSentence(library[i].text, perSampleChars) });
    }
    return picked;
}

/**
 * 渲染成 prompt 块。
 * 只在有样文时返回内容；无样文返回空串，调用方退化为「弱约束模式」。
 * @param samples - 样本
 * @param options - 配置项
 * @returns 文本结果
 */
export function formatExemplarBlock(samples: ExemplarSample[], options: { header?: string } = {}): string {
    if (samples.length === 0) return '';
    const lines = [
        options.header ?? '【真人写作样文（照这个语感写：句子长短、用词、停顿、对话方式；不要抄句子，也不要抄情节）】',
    ];
    samples.forEach((sample, index) => {
        lines.push(`—— 样文 ${index + 1}（${sample.kind}）——`);
        lines.push(sample.text);
    });
    lines.push('写的时候：句子的长短、段落的疏密、用词的轻重，都向上面这些样文靠；宁可有点粗糙，也不要写成四平八稳的说明书。');
    return lines.join('\n');
}
