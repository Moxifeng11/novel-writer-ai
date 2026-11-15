/**
 * emotion-plan-parse.ts — 从「情绪规划」步骤产物解析逐场景强度（纯函数）
 *
 * 供 M10 节奏基准使用：情绪规划里通常有「场景N：情绪/强度」，解析成
 * SceneIntensity[] 后即可推导基准并检测偏离，无需人工标注节奏。
 */

import type { SceneIntensity } from './rhythm-baseline-model';

/** 强度关键词（按优先级） */
const INTENSITY_KEYS = ['强度', '情绪强度', '张力', '强度值', 'intensity'];

/**
 * 解析逐场景强度。
 *
 * 支持：
 * - `## 场景1：xxx` 分块，块内 `- 强度：60`
 * - 表格行 `| 场景1 | 60 |`
 * - 行内 `场景1：强度 60`
 *
 * @param text - 情绪规划全文
 * @returns 场景强度（按序号升序）
 */
export function parseEmotionIntensities(text: string): SceneIntensity[] {
    const source = String(text ?? '').replace(/\r\n/g, '\n');
    const found = new Map<number, SceneIntensity>();

    // ① 分块形式（按标题切块：split 捕获组会丢掉块正文，必须用 matchAll 定位区间）
    const blockRe = /^##[ \t]*场景[ \t]*(\d+)[ \t]*[：:]?[ \t]*(.*)$/gm;
    const blockMatches = [...source.matchAll(blockRe)];
    for (let i = 0; i < blockMatches.length; i++) {
        const match = blockMatches[i];
        const index = Number(match[1]);
        const start = (match.index ?? 0) + match[0].length;
        const end = i + 1 < blockMatches.length ? (blockMatches[i + 1].index ?? source.length) : source.length;
        const body = source.slice(start, end);
        const intensity = pickIntensity(body);
        if (index && intensity !== null) found.set(index, { index, intensity });
    }

    // ② 表格/行内形式
    const linePattern = /场景\s*(\d+)[^\n]*?(\d{1,3})\s*(?:%|分)?/g;
    let match: RegExpExecArray | null;
    while ((match = linePattern.exec(source)) !== null) {
        const index = Number(match[1]);
        const value = Number(match[2]);
        if (!index || !Number.isFinite(value) || value < 0 || value > 100) continue;
        if (found.has(index)) continue;
        found.set(index, { index, intensity: value });
    }

    return [...found.values()].sort((a, b) => a.index - b.index);
}

/**
 * 渲染情绪曲线摘要（供提示词/日志）。
 *
 * @param scenes - 场景强度
 * @returns 文本；空返回空串
 */
export function renderEmotionCurve(scenes: readonly SceneIntensity[]): string {
    if (scenes.length === 0) return '';
    return `情绪曲线：${scenes.map(scene => `场景${scene.index}:${scene.intensity}`).join(' → ')}`;
}

/** 从文本中取强度值 */
function pickIntensity(text: string): number | null {
    for (const key of INTENSITY_KEYS) {
        const pattern = new RegExp(`${key}\\s*[：:]?\\s*(\\d{1,3})`);
        const match = text.match(pattern);
        if (match) {
            const value = Number(match[1]);
            if (Number.isFinite(value) && value >= 0 && value <= 100) return value;
        }
    }
    return null;
}
