/**
 * tool-result-pruner.ts — 工具结果确定性裁剪（移植 dsh compaction-tool-result-pruner）
 *
 * dsh 的做法：**不调用模型**，对超过预算的工具结果保留「头部 + 尾部」、把中段
 * 替换成一条标记；原事件不改写，只在投影（derive）时生效，因此可重放。
 *
 * 本插件里 `list_chapters` / `list_commands` / `run_command` 的结果可以到几 KB，
 * 每回合都会随转写整段发给模型；旧的会话压缩只在 30 轮时做一次整体摘要，
 * 中间这些超大结果会一直占满上下文。
 */

export interface PruneConfig {
    /** 超过该字符数才裁剪（默认 6000） */
    thresholdChars: number;
    /** 保留头部字符数（默认 1200） */
    headChars: number;
    /** 保留尾部字符数（默认 1200） */
    tailChars: number;
}

/**
 * 默认裁剪配置。
 */
export const DEFAULT_PRUNE_CONFIG: PruneConfig = {
    thresholdChars: 6000,
    headChars: 1200,
    tailChars: 1200,
};

/**
 * 裁剪占位标记。
 */
export const PRUNE_MARKER = '\n…【中间内容已裁剪，不参与本轮上下文；需要全文请让用户重新查询】…\n';

/**
 * 裁剪结果。
 */
export interface PruneOutcome {
    text: string;
    /** 被裁掉的字符数（0 表示未裁剪） */
    saved: number;
}

/**
 * 按 Unicode 码点裁剪，避免把代理对（emoji）切成半个字符。
 * 中段被替换为 {@link PRUNE_MARKER}。
 */
export function pruneToolResultText(text: string, config: Partial<PruneConfig> = {}): PruneOutcome {
    const cfg = { ...DEFAULT_PRUNE_CONFIG, ...config };
    const threshold = Math.max(1, cfg.thresholdChars);
    const head = Math.max(0, cfg.headChars);
    const tail = Math.max(0, cfg.tailChars);

    const points = Array.from(text);
    if (points.length <= threshold) return { text, saved: 0 };
    // 头 + 尾 + 标记必须小于原文，否则裁剪没有意义
    if (head + tail >= points.length) return { text, saved: 0 };

    const headText = points.slice(0, head).join('');
    const tailText = tail > 0 ? points.slice(points.length - tail).join('') : '';
    const pruned = `${headText}${PRUNE_MARKER}${tailText}`;
    return { text: pruned, saved: points.length - Array.from(pruned).length };
}
