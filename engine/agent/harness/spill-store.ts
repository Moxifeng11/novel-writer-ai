/**
 * spill-store.ts — 大工具结果落盘（吸收 dsh spill / spill-policy）
 *
 * 问题：一次 read_file 读到几万字正文、或 list_commands 全量清单，会整段留在会话日志里，
 * 每次调模型都重复付费，还会把会话压缩推过阈值。
 * 做法：结果超过阈值时**原文落盘**，日志里只留「定位符 + 头尾摘要」；
 * 模型需要细节时用 read_file 按 locator 取回（无损，可翻页），而不是把原文一直带着。
 *
 * 这里只放策略与文本构造（纯函数）；真正写盘由宿主注入 SpillSink。
 */

/**
 * 溢出写入接口。
 */
export interface SpillSink {
    /**
     * 写入一份大结果，返回库内相对路径（locator）；失败返回 null（调用方保留原文）。
     * name 只是建议文件名，实现需自行保证唯一性。
     */
    write(name: string, content: string): Promise<string | null>;
}

/**
 * 溢出策略（阈值/目标目录）。
 */
export interface SpillPolicy {
    /** 超过该字符数才落盘（默认 6000，约 4000 token） */
    thresholdChars: number;
    /** 日志里保留的头部字符数 */
    headChars: number;
    /** 日志里保留的尾部字符数（结尾常是「失败原因/汇总」） */
    tailChars: number;
}

/**
 * 默认溢出策略。
 */
export const DEFAULT_SPILL_POLICY: SpillPolicy = {
    thresholdChars: 6000,
    headChars: 600,
    tailChars: 200,
};

/**
 * 判断内容是否应溢出到磁盘。
 *
 * @param content - 内容
 * @param policy - 策略
 * @returns 布尔值
 */
export function shouldSpill(content: string, policy: SpillPolicy = DEFAULT_SPILL_POLICY): boolean {
    return String(content || '').length > Math.max(0, policy.thresholdChars);
}

/** 落盘文件的正文：带来源与规模头，便于用户/模型直接打开时知道这是什么 */
export function buildSpillBody(tool: string, content: string, at: Date = new Date()): string {
    const pad = (value: number): string => String(value).padStart(2, '0');
    // 用本地时间而不是 UTC：存档是给人看的，ISO 的 Z 时间会与用户时钟差 8 小时
    const iso = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} `
        + `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
    return [
        `<!-- spill: ${tool} @ ${iso} · ${content.length} chars -->`,
        `# 工具结果存档：${tool}`,
        '',
        `- 生成时间：${iso}`,
        `- 原始长度：${content.length} 字符`,
        '- 来源：Agent 会话中一次性返回过长的工具结果（原文无损保存）',
        '',
        '---',
        '',
        content,
    ].join('\n');
}

/** 日志中的替代文本：定位符 + 头尾摘要 + 取回指引 */
export function buildSpillReplacement(
    content: string,
    locator: string,
    policy: SpillPolicy = DEFAULT_SPILL_POLICY,
): string {
    const text = String(content || '');
    const head = text.slice(0, Math.max(0, policy.headChars));
    const tail = policy.tailChars > 0 && text.length > policy.headChars + policy.tailChars
        ? text.slice(-policy.tailChars)
        : '';
    const parts = [
        `【结果过大已落盘】共 ${text.length} 字符，原文保存为 ${locator}。需要细节时用 read_file（path=${locator}）按行读取，不要凭记忆编造。`,
        '---- 开头 ----',
        head,
    ];
    if (tail) {
        parts.push('---- 结尾 ----', tail);
    }
    return parts.join('\n');
}