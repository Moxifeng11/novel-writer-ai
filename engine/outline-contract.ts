/**
 * outline-contract.ts — 全书规划算法契约层（纯函数，无副作用、不调用 AI）
 *
 * ## 为什么需要这一层
 *
 * 原算法的缺陷不是单点 bug，而是**缺少阶段间的显式契约**：AI 的自由输出（蓝图章号范围、
 * 卷级字段值、章节分配表）没有约束就进入下一个阶段，于是缺陷会绕过校验并污染全局：
 *
 *  1. 蓝图 `expectedChapterRanges` 无长度/连续性/总和校验；且蓝图不可用时的回退分配用
 *     `ceil(totalChapters / volumes)`，三卷 400 章会得到 134+134+134=402 章（总章数被放大）。
 *  2. 卷结构校验只检测「缺章」（`covered.size < expectedCount`），**不检测「多章/越界章号」**，
 *     因此 AI 多写的章号能原样进入最终文档。
 *  3. 卷字段只检测「`- **字段**：` 是否存在」，不检测值是否为空或占位符（`（无）`/`待补充`…）。
 *  4. 跨卷问题只按 `volumeIndex` 定位，`relatedVolumes` 场景无法被定向修复。
 *  5. 组装最终文档前没有全局章号连续性终检（不连续/重叠/超总章数只能靠人眼发现）。
 *
 * 本模块把这些约束集中为可单测的纯函数，由 `OutlineGenerator` 编排调用，使「校验」成为
 * 算法的一等公民，而不是散落在各处的临时判断。
 */

import {
    OUTLINE_REQUIRED_KEYS,
    OUTLINE_TABLE_HEADER,
} from '../shared/format-constants';
import { validateOutlineOutput } from '../shared/template-validator';
import type { GlobalStorylineBlueprint as ValidatorBlueprint } from './cross-volume-outline-validator';

// ============================================================
// 一、卷级字段契约
// ============================================================

/**
 * 卷大纲在 12 个共享必填字段之外，额外要求输出的两个字段。
 *
 * 存在的理由：`VolumeOutlineSummarizer.extract` 依赖 `伏笔安排` 与 `势力变动` 两个小节来构建
 * 跨卷摘要（pendingForeshadows / factionChanges）。原提示词从不要求这两个字段，导致提取结果
 * 恒为空、`previousSummariesText` 形同虚设，跨卷伏笔与势力链条实际断裂。
 * 这里只在「卷生成契约」内追加，不改动共享常量 `OUTLINE_REQUIRED_KEYS`，
 * 以免影响其它以 12 字段为准的校验入口（如 full-writer-view）。
 */
export const OUTLINE_VOLUME_EXTRA_KEYS = ['伏笔安排', '势力变动'] as const;

/** 卷大纲必须输出的全部字段（12 共享 + 2 跨卷摘要必需） */
export const OUTLINE_VOLUME_REQUIRED_KEYS: readonly string[] = [
    ...OUTLINE_REQUIRED_KEYS,
    ...OUTLINE_VOLUME_EXTRA_KEYS,
];

/** 视为「空值/占位符」的字段值（与实体占位符语义一致） */
const PLACEHOLDER_VALUES = new Set([
    '', '-', '—', '--', '（无）', '(无)', '无', '（空）', '(空)', '空',
    '待定', '待补充', '待完善', '（待补充）', '（待定）', 'TBD', 'tbd', 'N/A', 'n/a',
    '...', '……', '略', '同上', '同上卷', '无内容',
]);

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 匹配 `- **字段**：` 行（用于定位字段起点） */
function fieldLineRegex(key: string): RegExp {
    return new RegExp(`^-\\s*\\*\\*${escapeRegExp(key)}\\*\\*\\s*[：:]`);
}

/** 匹配任意字段起始行（用于判定字段值区域的结束） */
const ANY_FIELD_LINE = /^-?\s*\*\*[^*]+\*\*\s*[：:]/;

/**
 * 提取指定字段的值文本（支持「同行内联」与「换行子列表」两种写法）。
 * 返回 null 表示该字段在内容中完全缺失。
 */
export function extractFieldValue(content: string, key: string): string | null {
    const lines = content.split('\n');
    const re = fieldLineRegex(key);
    let startIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i].trim())) {
            startIdx = i;
            break;
        }
    }
    if (startIdx < 0) return null;

    const head = lines[startIdx].trim().replace(re, '').trim();
    const parts: string[] = [head];
    for (let i = startIdx + 1; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (ANY_FIELD_LINE.test(trimmed)) break;
        if (/^#{2,6}\s/.test(trimmed)) break;
        if (trimmed.startsWith(OUTLINE_TABLE_HEADER)) break;
        parts.push(trimmed);
    }
    return parts.join('\n').trim();
}

/** 值是否为「空/占位」。hard=true 时占位符也算空；hard=false 时占位符视为合法的「确实没有」。 */
function isBlankValue(value: string | null, hard: boolean): boolean {
    if (value === null) return true;
    const normalized = value
        .split('\n')
        .map(line => line.replace(/^[-*+]\s+/, '').trim())
        .filter(line => line.length > 0)
        .join('\n')
        .replace(/\*\*/g, '')
        .trim();
    if (normalized.length === 0) return true;
    if (!hard) return false;
    return PLACEHOLDER_VALUES.has(normalized);
}

// ============================================================
// 二、设置归一化与章号范围契约
// ============================================================

export interface NormalizedOutlineSettings {
    totalWords: number;
    volumes: number;
    wordsPerChapter: number;
    totalChapters: number;
    theme: string;
    genre: string;
}

/**
 * 归一化输入参数，保证后续所有除法/循环都处于合法域内：
 * - volumes / wordsPerChapter / totalWords 非法（NaN、≤0、非整数）时回退默认值；
 * - totalChapters 至少为 volumes，保证每卷至少 1 章（否则按比例分配会出现 0 章卷）。
 */
export function normalizeOutlineSettings(raw: {
    totalWords: string;
    volumes: number;
    wordsPerChapter: number;
    theme?: string;
    genre?: string;
}): NormalizedOutlineSettings {
    const parsedWords = parseInt(raw.totalWords, 10);
    const totalWords = Number.isFinite(parsedWords) && parsedWords > 0 ? parsedWords : 1_000_000;

    const rawVolumes = Math.floor(Number(raw.volumes));
    const volumes = Number.isFinite(rawVolumes) && rawVolumes > 0 ? rawVolumes : 3;

    const rawPerChapter = Math.floor(Number(raw.wordsPerChapter));
    const wordsPerChapter = Number.isFinite(rawPerChapter) && rawPerChapter > 0 ? rawPerChapter : 2500;

    const totalChapters = Math.max(volumes, Math.ceil(totalWords / wordsPerChapter));

    return {
        totalWords,
        volumes,
        wordsPerChapter,
        totalChapters,
        theme: raw.theme || '',
        genre: raw.genre || '',
    };
}

/**
 * 按比例把 totalChapters 精确分配到 volumes 卷：总和恒等于 totalChapters，且每卷 ≥ 1 章。
 * 这是蓝图不可用/不合法时的回退，也是蓝图章号的归一化目标。
 */
export function buildProportionalChapterRanges(volumes: number, totalChapters: number): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    const base = Math.floor(totalChapters / volumes);
    const remainder = totalChapters % volumes;

    let cursor = 1;
    for (let i = 0; i < volumes; i++) {
        const count = Math.max(1, base + (i < remainder ? 1 : 0));
        ranges.push([cursor, cursor + count - 1]);
        cursor += count;
    }
    // 若因 max(1, …) 导致总和溢出（totalChapters < volumes），把末卷压缩到 totalChapters
    if (cursor - 1 > totalChapters) {
        const last = ranges[ranges.length - 1];
        last[1] = Math.max(last[0], totalChapters);
    }
    return ranges;
}

/** 校验章号范围是否满足全部硬约束；返回 null 表示合法，否则返回原因描述 */
export function validateChapterRanges(
    ranges: unknown,
    volumes: number,
    totalChapters: number,
): string | null {
    if (!Array.isArray(ranges)) return 'expectedChapterRanges 不是数组';
    if (ranges.length !== volumes) return `expectedChapterRanges 长度 ${ranges.length} ≠ 分卷数 ${volumes}`;

    let prevEnd = 0;
    for (let i = 0; i < ranges.length; i++) {
        const item = ranges[i] as unknown;
        if (!Array.isArray(item) || item.length !== 2) return `第${i + 1}卷章号范围不是 [起始, 结束] 二元组`;
        const start = Math.floor(Number(item[0]));
        const end = Math.floor(Number(item[1]));
        if (!Number.isFinite(start) || !Number.isFinite(end)) return `第${i + 1}卷章号范围含非数字`;
        if (start < 1 || end < start) return `第${i + 1}卷章号范围非法（${start}-${end}）`;
        if (i === 0 && start !== 1) return `第1卷起始章号必须为 1（实际 ${start}）`;
        if (i > 0 && start !== prevEnd + 1) return `第${i + 1}卷起始章号(${start})与第${i}卷结束章号(${prevEnd})不连续`;
        prevEnd = end;
    }
    if (prevEnd !== totalChapters) return `章号总数 ${prevEnd} ≠ 规划总章数 ${totalChapters}`;
    return null;
}

/**
 * 蓝图章号范围的归一化：合法则原样返回；不合法则按比例重新分配（总和严格等于 totalChapters）。
 * 无论 AI 返回什么（缺项、越界、不连续、总和不符、非数组），结果都是可直接使用的合法范围。
 */
export function normalizeChapterRanges(
    ranges: unknown,
    volumes: number,
    totalChapters: number,
): { ranges: Array<[number, number]>; normalized: boolean; reason?: string } {
    const reason = validateChapterRanges(ranges, volumes, totalChapters);
    if (!reason) {
        return {
            ranges: (ranges as Array<[number, number]>).map(r => [Math.floor(r[0]), Math.floor(r[1])] as [number, number]),
            normalized: false,
        };
    }
    return { ranges: buildProportionalChapterRanges(volumes, totalChapters), normalized: true, reason };
}

// ============================================================
// 三、蓝图契约（结构与字段完整性）
// ============================================================

export interface BlueprintValidationContext {
    volumes: number;
    totalChapters: number;
    chapterRanges: Array<[number, number]>;
    hasCharacters: boolean;
    hasFactions: boolean;
}

/**
 * 校验蓝图「不只是一堆空数组」：
 * - 章号范围必须合法；
 * - 转折点 ≥ 1 且卷号合法、章节范围落在该卷内；
 * - 伏笔 ≥ 1 且 buryVolume < expectedRevealVolume（否则回收在埋设之前，语义倒置）；
 * - 提供了角色/势力时，对应时间线必须非空。
 */
export function validateBlueprintCompleteness(
    blueprint: ValidatorBlueprint,
    ctx: BlueprintValidationContext,
): string[] {
    const gaps: string[] = [];

    const rangeError = validateChapterRanges(blueprint.expectedChapterRanges, ctx.volumes, ctx.totalChapters);
    if (rangeError) gaps.push(`章号范围不合法：${rangeError}`);

    const inVolume = (v: unknown): boolean => {
        const n = Math.floor(Number(v));
        return Number.isFinite(n) && n >= 1 && n <= ctx.volumes;
    };

    const turningPoints = blueprint.turningPoints;
    if (!Array.isArray(turningPoints) || turningPoints.length === 0) {
        gaps.push('缺少关键转折点（turningPoints 为空）');
    } else {
        turningPoints.forEach((tp, i) => {
            if (!tp?.name || !String(tp.name).trim()) gaps.push(`第${i + 1}个转折点缺少名称`);
            if (!inVolume(tp?.expectedVolume)) gaps.push(`转折点「${tp?.name || i + 1}」的 expectedVolume 越界或缺失`);
            if (tp?.expectedChapterRange && Array.isArray(tp.expectedChapterRange) && inVolume(tp.expectedVolume)) {
                const [rs, re] = ctx.chapterRanges[Math.floor(Number(tp.expectedVolume)) - 1] || [1, 1];
                const cs = Math.floor(Number(tp.expectedChapterRange[0]));
                const ce = Math.floor(Number(tp.expectedChapterRange[1]));
                if (!Number.isFinite(cs) || !Number.isFinite(ce) || cs < rs || ce > re) {
                    gaps.push(`转折点「${tp.name}」的章节范围 ${cs}-${ce} 超出其所属卷范围 ${rs}-${re}`);
                }
            }
        });
    }

    const foreshadows = blueprint.requiredForeshadows;
    if (!Array.isArray(foreshadows) || foreshadows.length === 0) {
        gaps.push('缺少必须回收的伏笔（requiredForeshadows 为空）');
    } else {
        foreshadows.forEach((fs, i) => {
            if (!fs?.name || !String(fs.name).trim()) gaps.push(`第${i + 1}个伏笔缺少名称`);
            const bury = Math.floor(Number(fs?.buryVolume));
            const reveal = Math.floor(Number(fs?.expectedRevealVolume));
            if (!inVolume(bury) || !inVolume(reveal)) {
                gaps.push(`伏笔「${fs?.name || i + 1}」的埋设/回收卷号越界或缺失`);
            } else if (bury > reveal) {
                // 同卷埋设并回收是合法的；只有「回收卷早于埋设卷」才是语义倒置
                gaps.push(`伏笔「${fs.name}」埋设卷(${bury}) 晚于 回收卷(${reveal})，回收先于埋设，语义倒置`);
            }
        });
    }

    if (ctx.hasFactions) {
        const factionTimeline = blueprint.factionTimeline;
        if (!Array.isArray(factionTimeline) || factionTimeline.length === 0) {
            gaps.push('缺少势力演变时间线（factionTimeline 为空，但项目已有势力）');
        } else {
            factionTimeline.forEach((fe, i) => {
                if (!fe?.factionName || !String(fe.factionName).trim()) gaps.push(`第${i + 1}条势力事件缺少势力名`);
                if (!inVolume(fe?.expectedVolume)) gaps.push(`势力事件「${fe?.factionName || i + 1}」的 expectedVolume 越界或缺失`);
                if (fe?.eventType && !['rise', 'fall', 'transform'].includes(fe.eventType)) {
                    gaps.push(`势力事件「${fe.factionName}」的 eventType「${fe.eventType}」非法`);
                }
            });
        }
    }

    if (ctx.hasCharacters) {
        const characterTimeline = blueprint.characterTimeline;
        if (!Array.isArray(characterTimeline) || characterTimeline.length === 0) {
            gaps.push('缺少角色状态时间线（characterTimeline 为空，但项目已有角色）');
        } else {
            characterTimeline.forEach((cs, i) => {
                if (!cs?.characterName || !String(cs.characterName).trim()) gaps.push(`第${i + 1}条角色线缺少角色名`);
                if (!Array.isArray(cs?.expectedStates) || cs.expectedStates.length === 0) {
                    gaps.push(`角色「${cs?.characterName || i + 1}」的状态时间线为空`);
                } else {
                    cs.expectedStates.forEach((st, j) => {
                        if (!inVolume(st?.volume)) gaps.push(`角色「${cs.characterName}」第${j + 1}个状态卷号越界`);
                        if (!st?.state || !String(st.state).trim()) gaps.push(`角色「${cs.characterName}」第${j + 1}个状态为空`);
                    });
                }
            });
        }
    }

    return gaps;
}

/** 蓝图定向补全指令（携带缺陷清单，提示词随轮次变化以绕过 prompt 缓存） */
export function buildBlueprintRepairHint(gaps: string[], attempt: number): string {
    return [
        `【第 ${attempt} 轮蓝图定向补全——必须逐项修正】`,
        '上一轮蓝图存在以下缺陷：',
        ...gaps.slice(0, 10).map((g, i) => `${i + 1}. ${g}`),
        '',
        '硬性要求：',
        '- expectedChapterRanges 必须为数组，长度等于分卷数，各卷范围首尾相接且总章号数严格等于规划总章数',
        '- turningPoints 至少 1 条，expectedVolume 必须在分卷数范围内',
        '- requiredForeshadows 至少 1 条，回收卷不得早于埋设卷',
        '- factionTimeline / characterTimeline 至少各 1 条（若存在对应已有元素）',
        '- 只输出合法 JSON，不要输出任何解释性文字',
    ].join('\n');
}

// ============================================================
// 四、章节分配表解析 / 校验 / 归一化
// ============================================================

/** 章节分配表数据行：`| 12 | 描述 |` */
const CHAPTER_ROW_RE = /^\|\s*(\d+)\s*\|\s*(.*?)\s*\|?\s*$/;

/** 从内容中提取全部章节号（**不做范围过滤**，用于发现越界/跨卷重叠等全局问题） */
export function extractAllChapterNumbers(content: string): number[] {
    const numbers: number[] = [];
    for (const raw of content.split('\n')) {
        const m = raw.trim().match(CHAPTER_ROW_RE);
        if (!m) continue;
        const n = parseInt(m[1], 10);
        if (!isNaN(n)) numbers.push(n);
    }
    return numbers;
}

/** 从内容中提取落在 [start, end] 内、去重且描述非空的章节号集合 */
export function extractCoveredChapters(content: string, start: number, end: number): Set<number> {
    const covered = new Set<number>();
    for (const raw of content.split('\n')) {
        const m = raw.trim().match(CHAPTER_ROW_RE);
        if (!m) continue;
        const n = parseInt(m[1], 10);
        if (isNaN(n) || n < start || n > end || covered.has(n)) continue;
        covered.add(n);
    }
    return covered;
}

export interface ChapterTableAnalysis {
    inRange: number[];
    outOfRange: number[];
    duplicates: number[];
    emptyDescription: number[];
}

/** 全量分析章节表：区分「范围内 / 越界 / 重复 / 描述为空」四类异常 */
export function analyzeChapterTable(content: string, start: number, end: number): ChapterTableAnalysis {
    const inRange = new Set<number>();
    const outOfRange = new Set<number>();
    const duplicates = new Set<number>();
    const emptyDescription = new Set<number>();

    for (const raw of content.split('\n')) {
        const m = raw.trim().match(CHAPTER_ROW_RE);
        if (!m) continue;
        const n = parseInt(m[1], 10);
        if (isNaN(n)) continue;
        const desc = m[2].trim();
        if (n < start || n > end) {
            // 越界行不算「重复」，单列一类
            outOfRange.add(n);
            continue;
        }
        if (desc.length === 0) emptyDescription.add(n);
        if (inRange.has(n)) duplicates.add(n);
        else inRange.add(n);
    }

    return {
        inRange: Array.from(inRange).sort((a, b) => a - b),
        outOfRange: Array.from(outOfRange).sort((a, b) => a - b),
        duplicates: Array.from(duplicates).sort((a, b) => a - b),
        emptyDescription: Array.from(emptyDescription).sort((a, b) => a - b),
    };
}

/** 找出 [start, end] 内缺失的章节号，并压缩为连续区间列表（供增量补全按区间请求） */
export function findMissingChapterRanges(
    content: string,
    start: number,
    end: number,
): Array<[number, number]> {
    const covered = extractCoveredChapters(content, start, end);
    const ranges: Array<[number, number]> = [];
    let cursor: number | null = null;
    for (let n = start; n <= end; n++) {
        if (covered.has(n)) {
            if (cursor !== null) {
                ranges.push([cursor, n - 1]);
                cursor = null;
            }
        } else if (cursor === null) {
            cursor = n;
        }
    }
    if (cursor !== null) ranges.push([cursor, end]);
    return ranges;
}

/** 把连续区间按上限切分成不超过 maxSize 的批次 */
export function chunkRanges(
    ranges: Array<[number, number]>,
    maxSize: number,
): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (const [s, e] of ranges) {
        for (let cur = s; cur <= e; cur += maxSize) {
            out.push([cur, Math.min(cur + maxSize - 1, e)]);
        }
    }
    return out;
}

/**
 * 章节分配表归并/净化：解析内容中所有数据行（去重、剔除越界与空描述），
 * 合并 `extraRows` 中的新行，最后按章号升序重排替换原数据行。
 *
 * 用途有二：
 *  - 净化（extraRows 为空）：确保越界/重复章号不会进入最终文档；
 *  - 增量补全（extraRows 为补全批次输出）：把缺失章节并回草稿。
 * 未找到表头时不改动结构，仅原样返回内容（由校验层报告「缺表格」缺陷）。
 */
export function consolidateChapterTable(
    content: string,
    start: number,
    end: number,
    extraRows = '',
): string {
    const tableHeaderIdx = content.split('\n').findIndex(line => line.trim().startsWith(OUTLINE_TABLE_HEADER));
    if (tableHeaderIdx < 0) return content;

    const rows = new Map<number, string>();
    const collect = (text: string): void => {
        for (const raw of text.split('\n')) {
            const m = raw.trim().match(CHAPTER_ROW_RE);
            if (!m) continue;
            const n = parseInt(m[1], 10);
            if (isNaN(n) || n < start || n > end || rows.has(n)) continue;
            const desc = m[2].replace(/\|/g, '／').trim();
            if (desc.length === 0) continue;
            rows.set(n, `| ${n} | ${desc} |`);
        }
    };
    collect(content);
    collect(extraRows);

    const sortedRows = Array.from(rows.keys()).sort((a, b) => a - b).map(n => rows.get(n) as string);

    const lines = content.split('\n');
    const out: string[] = [];
    let inserted = false;
    for (const line of lines) {
        if (CHAPTER_ROW_RE.test(line.trim())) {
            if (!inserted) {
                out.push(...sortedRows);
                inserted = true;
            }
            continue;
        }
        out.push(line);
    }
    if (!inserted && sortedRows.length > 0) {
        // 表头存在但没有数据行：紧跟在表头/分隔行之后插入
        const headIdx = out.findIndex(line => line.trim().startsWith(OUTLINE_TABLE_HEADER));
        const insertAt = out.findIndex((line, i) => i > headIdx && /^\|[\s:-]+\|$/.test(line.trim())) >= 0
            ? out.findIndex((line, i) => i > headIdx && /^\|[\s:-]+\|$/.test(line.trim())) + 1
            : headIdx + 1;
        out.splice(insertAt, 0, ...sortedRows);
    }
    return out.join('\n');
}

// ============================================================
// 五、单卷结构校验（精确匹配，不再只查「缺章」）
// ============================================================

/**
 * 单卷结构缺陷清单（空数组 = 达标）。检查项：
 *  1. 复用 `validateOutlineOutput`：12 字段存在性 / 章节范围格式 / 章节分配表存在；
 *  2. 12 个核心字段的**值非空且非占位符**；
 *  3. 2 个跨卷摘要字段**存在**（值为「（无）」可接受，因为确实可能没有）；
 *  4. 章节范围必须与规划范围严格一致；
 *  5. 章节表必须是「精确覆盖」：不多、不少、不越界、不重复、描述不为空。
 */
export function validateVolumeStructure(
    content: string,
    chapterRange: [number, number],
    expectedCount: number,
): string[] {
    if (!content || !content.trim()) return ['本卷输出为空'];

    const [start, end] = chapterRange;
    const gaps: string[] = [...validateOutlineOutput(content).missingFields];

    // 2 & 3. 字段值实质校验
    for (const key of OUTLINE_VOLUME_REQUIRED_KEYS) {
        const hard = !OUTLINE_VOLUME_EXTRA_KEYS.includes(key as '伏笔安排' | '势力变动');
        if (isBlankValue(extractFieldValue(content, key), hard)) {
            gaps.push(`字段「${key}」为空或为占位符`);
        }
    }

    // 4. 章节范围一致
    const rangeMatch = content.match(/第(\d+)章\s*-\s*第(\d+)章/);
    if (rangeMatch) {
        const s = parseInt(rangeMatch[1], 10);
        const e = parseInt(rangeMatch[2], 10);
        if (s !== start || e !== end) {
            gaps.push(`章节范围与规划不一致（应为第${start}章 - 第${end}章，实际为第${s}章 - 第${e}章）`);
        }
    }

    // 5. 章节表精确匹配
    const analysis = analyzeChapterTable(content, start, end);
    if (analysis.inRange.length !== expectedCount) {
        const missing: number[] = [];
        const present = new Set(analysis.inRange);
        for (let n = start; n <= end; n++) if (!present.has(n)) missing.push(n);
        gaps.push(`章节分配覆盖 ${analysis.inRange.length}/${expectedCount} 章，缺失第 ${missing.slice(0, 5).join('、')}${missing.length > 5 ? ' 等' : ''} 章`);
    }
    if (analysis.outOfRange.length > 0) {
        gaps.push(`存在 ${analysis.outOfRange.length} 个越界章号（如第 ${analysis.outOfRange.slice(0, 5).join('、')} 章，超出本卷范围 第${start}-${end} 章）`);
    }
    if (analysis.duplicates.length > 0) {
        gaps.push(`存在 ${analysis.duplicates.length} 个重复章号（如第 ${analysis.duplicates.slice(0, 5).join('、')} 章）`);
    }
    if (analysis.emptyDescription.length > 0) {
        gaps.push(`存在 ${analysis.emptyDescription.length} 行章节描述为空（如第 ${analysis.emptyDescription.slice(0, 5).join('、')} 章）`);
    }

    return gaps;
}

/** 卷级定向补全指令（提示词随轮次变化，避免命中 prompt 缓存形成无效重试） */
export function buildVolumeRepairHint(gaps: string[], attempt: number): string {
    return [
        `【第 ${attempt} 轮定向补全——必须逐项修正】`,
        '上一轮本卷输出存在以下结构缺陷：',
        ...gaps.slice(0, 10).map((g, i) => `${i + 1}. ${g}`),
        '',
        '修正硬性要求：',
        `- 本卷必须完整包含全部 ${OUTLINE_VOLUME_REQUIRED_KEYS.length} 个字段（含「伏笔安排」「势力变动」），值不得为空或"（无）"`,
        `- 「章节分配」必须使用两列表格 ${OUTLINE_TABLE_HEADER}，完整列出本卷每一章`,
        '- 章节号必须严格落在本卷章节范围内，不得越界、不得重复、不得跳号',
        '- 每一行的章节描述都不得为空',
        '- 禁止出现"……""省略""以此类推""同上"等任何省略表述',
        '- 直接输出可直接使用的完整大纲正文，不要讨论缺陷本身',
    ].join('\n');
}

// ============================================================
// 六、全局章号连续性终检（组装文档前的最后一道门）
// ============================================================

/**
 * 全局章号连续性校验：逐卷核对覆盖度与越界，并检查跨卷无重复、全书无缺失、无超总章数。
 * 返回空数组表示文档章号结构完全自洽。
 *
 * 注意：这里必须统计**全部**章节号（含越界行），否则越界行会被范围过滤掉，
 * 跨卷重叠与超总章数就永远检不出来——那正是原算法「章号被放大却无人发现」的盲点。
 */
export function validateGlobalChapterContinuity(
    volumeContents: string[],
    volumeRanges: Array<[number, number]>,
    totalChapters: number,
): string[] {
    const gaps: string[] = [];
    const owner = new Map<number, number>();

    for (let i = 0; i < volumeContents.length; i++) {
        const range = volumeRanges[i];
        if (!range) {
            gaps.push(`第${i + 1}卷缺少章节范围记录`);
            continue;
        }
        const [start, end] = range;
        const all = extractAllChapterNumbers(volumeContents[i]);
        const inRange = new Set(all.filter(n => n >= start && n <= end));
        const expected = end - start + 1;

        if (inRange.size !== expected) {
            gaps.push(`第${i + 1}卷章节表覆盖 ${inRange.size}/${expected} 章（范围 第${start}-${end} 章）`);
        }

        const outOfRange = Array.from(new Set(all.filter(n => n < start || n > end))).sort((a, b) => a - b);
        if (outOfRange.length > 0) {
            gaps.push(`第${i + 1}卷含 ${outOfRange.length} 个越界章号（如第 ${outOfRange.slice(0, 5).join('、')} 章，超出本卷范围 第${start}-${end} 章）`);
        }

        for (const n of all) {
            if (owner.has(n) && owner.get(n) !== i) {
                gaps.push(`第 ${n} 章同时出现在第${owner.get(n)! + 1}卷与第${i + 1}卷`);
            } else if (!owner.has(n)) {
                owner.set(n, i);
            }
        }
    }

    const missing: number[] = [];
    for (let n = 1; n <= totalChapters; n++) if (!owner.has(n)) missing.push(n);
    if (missing.length > 0) {
        gaps.push(`全书缺失 ${missing.length} 章（第 ${missing.slice(0, 5).join('、')}${missing.length > 5 ? ' 等' : ''} 章）`);
    }

    const overflow = Array.from(owner.keys()).filter(n => n > totalChapters).sort((a, b) => a - b);
    if (overflow.length > 0) {
        gaps.push(`存在 ${overflow.length} 个超出全书总章数(${totalChapters})的章号（如第 ${overflow.slice(0, 5).join('、')} 章）`);
    }

    return gaps;
}
