/**
 * contrast-library.ts — 弱/强写作对照库解析
 *
 * 项目文件：00-系统模板/写作对照库.md
 * 结构：
 *   ## 对话
 *   ### 弱写法
 *   ...
 *   ### 强写法
 *   ...
 *   ### 差异
 *   ...
 *
 * 只注入用户/基准样章提供的对照，不自动生成“弱写法”样本。
 */

export interface ContrastPair {
    dimension: string;
    weak: string;
    strong: string;
    difference: string;
}

const SECTION_RE = /^##\s+(.+?)\s*$/gm;

function extractSubsection(body: string, heading: string): string {
    const re = new RegExp(`^###[ \\t]*${heading}[ \\t]*\\r?\\n([\\s\\S]*?)(?=^###[ \\t]|^##[ \\t]|$)`, 'im');
    const m = body.match(re);
    return m ? m[1].trim() : '';
}

/**
 * 解析对照库 Markdown。缺少任一强/弱段落的章节跳过。
 *
 * @param content - 内容
 * @returns 结果数组
 */
export function parseContrastLibrary(content: string): ContrastPair[] {
    if (!content || !content.trim()) return [];
    const pairs: ContrastPair[] = [];
    const matches = Array.from(content.matchAll(SECTION_RE));

    for (let i = 0; i < matches.length; i++) {
        const dimension = (matches[i][1] || '').trim();
        const start = (matches[i].index ?? 0) + matches[i][0].length;
        const end = i + 1 < matches.length ? (matches[i + 1].index ?? content.length) : content.length;
        const body = content.slice(start, end);
        const weak = extractSubsection(body, '弱写法');
        const strong = extractSubsection(body, '强写法');
        if (!weak || !strong) continue;
        pairs.push({
            dimension,
            weak,
            strong,
            difference: extractSubsection(body, '差异'),
        });
    }
    return pairs;
}

const SCENE_TYPE_ALIASES: Record<string, string[]> = {
    dialogue: ['对话', '日常', '交谈'],
    battle: ['战斗', '冲突', '动作'],
    emotional: ['情绪', '心理', '情感'],
    description: ['描写', '环境', '场景'],
    rhythm: ['节奏', '叙事'],
};

/**
 * 按场景类型匹配对照；无匹配返回 null。
 *
 * @param pairs - 配对列表
 * @param sceneType - 场景类型
  * @returns ContrastPair 或 null
 */
export function selectContrastPair(pairs: ContrastPair[], sceneType?: string): ContrastPair | null {
    if (pairs.length === 0) return null;
    const aliases = sceneType ? (SCENE_TYPE_ALIASES[sceneType] || [sceneType]) : [];
    for (const alias of aliases) {
        const hit = pairs.find(p => p.dimension.includes(alias) || alias.includes(p.dimension));
        if (hit) return hit;
    }
    return null;
}

export function formatContrastPairForPrompt(pair: ContrastPair | null, maxChars = 900): string {
    if (!pair) return '';
    const text = [
        `【对照样本：${pair.dimension}】`,
        '弱写法（禁止模仿）：',
        pair.weak.slice(0, 400),
        '强写法（学习其工艺，不照抄情节）：',
        pair.strong.slice(0, 400),
        pair.difference ? `差异：${pair.difference.slice(0, 200)}` : '',
    ].filter(Boolean).join('\n');
    return text.slice(0, maxChars);
}
