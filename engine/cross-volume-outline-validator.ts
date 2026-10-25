/**
 * cross-volume-outline-validator.ts — 跨卷大纲一致性校验器
 *
 * 基于正则提取信息，不调用 AI。
 * 对多卷大纲文本与全局蓝图进行跨卷一致性验证。
 *
 * ## 匹配算法演进
 *
 * 第一代：`extractKeywords` + `matchesKeywords` — 基于分隔符的精确关键词匹配。
 * 第二代：`fuzzyMatchName` — 基于字符重叠度的滑动窗口模糊匹配。
 * 第三代：`smartMatchName` — 双策略融合（精确优先，模糊兜底）。
 *
 * 演进原因：解决分隔符无法穷举、换题材后命名风格变化导致的误报问题。
 *   - 第一代依赖固定分隔符拆分，遇到非常规命名或新题材时容易漏匹配；
 *   - 第二代通过字符重叠度提升召回率，但短名称易误判；
 *   - 第三代结合两者优势，精确匹配快速短路，模糊匹配兜底召回。
 */

export type IssueSeverity = 'critical' | 'warning';

export interface ValidationIssue {
    type: string;
    severity: IssueSeverity;
    message: string;
    volumeIndex?: number;
    relatedVolumes?: number[];
}

export interface CrossVolumeValidationReport {
    isValid: boolean;
    criticalIssues: ValidationIssue[];
    warningIssues: ValidationIssue[];
    checkedAt: number;
}

export interface VolumeConflictInfo {
    hasConflict: boolean;
    conflictType: 'count_mismatch' | 'range_mismatch' | 'none';
    message: string;
    details: string;
}

export interface BlueprintTurningPoint {
    name: string;
    expectedVolume: number;
    expectedChapterRange?: [number, number];
}

export interface BlueprintForeshadow {
    name: string;
    buryVolume: number;
    expectedRevealVolume: number;
}

export interface BlueprintFactionEvent {
    factionName: string;
    eventType: 'rise' | 'fall' | 'transform';
    expectedVolume: number;
}

/**
 * 从中文名称中提取2-4字核心关键词
 * 算法：按常见中文分隔符拆分，保留2-4字片段
 * 例如：「苍穹之痕觉醒」→ ["苍穹", "觉醒"]
 * 例如：「灭门真凶浮现」→ ["灭门", "真凶", "浮现"]
 * 例如：「幽渊第七氏族」→ ["幽渊", "氏族"]
 */
export function extractKeywords(name: string): string[] {
    // 移除括号及其中内容
    const cleaned = name.replace(/[（(][^）)]*[）)]/g, '');
    // 按分隔符拆分
    const parts = cleaned.split(/[之的与和、，,\s\-—]+/).filter(p => p.length >= 2 && p.length <= 4);
    // 如果拆分后为空，取原名称的2-4字片段
    if (parts.length === 0 && cleaned.length >= 2) {
        if (cleaned.length <= 4) {
            return [cleaned];
        }
        return [cleaned.slice(0, 2), cleaned.slice(-2)];
    }
    return parts;
}

/**
 * 检查目标文本中是否包含所有关键词
 */
export function matchesKeywords(keywords: string[], text: string): boolean {
    if (keywords.length === 0) return true;
    return keywords.every(kw => text.includes(kw));
}

/**
 * 基于字符重叠度的模糊匹配函数，用于判断蓝图名称是否在文本中被提及。
 *
 * 算法原理：
 * 1. 预处理名称：去除括号内容和常见标点
 * 2. 短名称（≤4字）或去重字符不足3个时返回 false（走精确匹配）
 * 3. 计算窗口大小（名称长度×2，最小15），在文本中滑动窗口
 * 4. 统计每个窗口内与名称去重字符集的匹配数，计算匹配度
 * 5. 若最大匹配度 ≥ 阈值（默认0.6），返回 true
 *
 * 性能优化：一旦找到匹配度达标的窗口立即返回（提前终止）。
 *
 * @param name - 蓝图名称
 * @param text - 待匹配的文本
 * @param options - 可选配置
 * @param options.threshold - 匹配度阈值，默认 0.6
 * @param options.minWindowSize - 最小窗口大小，默认 15
 * @returns 是否模糊匹配成功
 */
export function fuzzyMatchName(
    name: string,
    text: string,
    options?: { threshold?: number; minWindowSize?: number },
): boolean {
    if (!name || !text) return false;

    const threshold = options?.threshold ?? 0.6;
    const minWindowSize = options?.minWindowSize ?? 15;

    let cleaned = name.replace(/[（(][^）)]*[）)]/g, '');
    cleaned = cleaned.replace(/[，。、！？：；""''「」『』（）()]/g, '');

    if (cleaned.length <= 4) return false;

    const charSet = new Set(cleaned);
    const totalChars = charSet.size;
    if (totalChars < 3) return false;

    const windowSize = Math.max(cleaned.length * 2, minWindowSize);

    if (text.length <= windowSize) {
        let matchCount = 0;
        for (const ch of text) {
            if (charSet.has(ch)) matchCount++;
        }
        return matchCount / totalChars >= threshold;
    }

    for (let i = 0; i <= text.length - windowSize; i++) {
        const window = text.slice(i, i + windowSize);
        let matchCount = 0;
        const seen = new Set<string>();
        for (const ch of window) {
            if (charSet.has(ch) && !seen.has(ch)) {
                seen.add(ch);
                matchCount++;
            }
        }
        if (matchCount / totalChars >= threshold) {
            return true;
        }
    }

    return false;
}

/**
 * 双策略名称匹配封装函数，结合精确关键词匹配与模糊字符重叠度匹配。
 *
 * 设计意图：
 * 1. 优先使用精确关键词匹配（策略 A），利用其计算成本低、准确率高的特点进行快速短路判断
 * 2. 精确匹配失败时，降级到模糊匹配（策略 B），通过字符重叠度捕捉表述差异、语序变化等情况
 * 3. 这种"先快后慢、先准后宽"的分层策略，在保证召回率的同时兼顾了整体性能
 *
 * @param name - 蓝图名称（待匹配的目标名称）
 * @param text - 被搜索的文本内容
 * @returns 匹配成功返回 true，失败返回 false
 */
export function smartMatchName(name: string, text: string): boolean {
    const keywords = extractKeywords(name);
    if (matchesKeywords(keywords, text)) {
        return true;
    }
    return fuzzyMatchName(name, text);
}

export interface BlueprintCharacterState {
    characterName: string;
    expectedStates: Array<{ volume: number; state: string }>;
}

export interface GlobalStorylineBlueprint {
    turningPoints?: BlueprintTurningPoint[];
    requiredForeshadows?: BlueprintForeshadow[];
    factionTimeline?: BlueprintFactionEvent[];
    characterTimeline?: BlueprintCharacterState[];
    expectedChapterRanges?: Array<[number, number]>;
}

interface ParsedVolume {
    index: number;
    rawText: string;
    chapterRange: [number, number] | null;
    characterStates: Map<string, string[]>;
    foreshadowReveals: string[];
    factionEvents: Map<string, string[]>;
    turningPointMentions: string[];
    hasSubplot: boolean;
    subplotRelatedChapters: number[];
}

const RE_CHAPTER_RANGE = /第(\d+)章\s*[-~至]\s*第(\d+)章/;

const DEATH_STATES = ['死亡', '阵亡', '陨落', '陨命', '身亡', '死去', '被杀', '逝去'];
const ACTIVE_STATES = ['活跃', '出场', '行动', '现身', '登场', '对话', '战斗', '出现'];
const SUBLINE_MARKERS = ['支线', '番外', '外传', '侧线'];
const FORESHADOW_REVEAL_WORDS = ['回收', '揭晓', '揭露', '解开', '揭晓', '真相大白', '揭开'];
/** 势力崛起/兴盛的关键词（导出以便生成侧提示词与校验侧判定保持单一来源） */
export const FACTION_RISE_WORDS = ['崛起', '兴盛', '壮大', '称霸', '登顶'];
/** 势力覆灭/衰落的关键词（同上） */
export const FACTION_FALL_WORDS = ['覆灭', '灭亡', '衰落', '瓦解', '被灭', '衰败'];
const CAUSAL_CONNECTORS = ['因此', '于是', '导致', '因为', '源于', '引出', '牵扯', '牵连', '牵连主线', '回归主线'];

function extractChapterRange(text: string): [number, number] | null {
    const m = text.match(RE_CHAPTER_RANGE);
    if (!m) return null;
    const start = parseInt(m[1], 10);
    const end = parseInt(m[2], 10);
    if (isNaN(start) || isNaN(end) || start > end) return null;
    return [start, end];
}

function extractCharacterStates(text: string): Map<string, string[]> {
    const map = new Map<string, string[]>();

    // 匹配 "**姓名**：...状态..." 或 "姓名（状态）" 或表格行中的人物
    const patterns = [
        /\*\*([^*【】（）\n]{1,8})\*\*[：:]\s*([^\n]*(?:死亡|重伤|失踪|昏迷|活跃|出场|退场|隐居|牺牲)[^\n]*)/g,
        /([^\s【】（）]{1,8})[（(]([^）)]*(?:死亡|重伤|失踪|昏迷|活跃|出场|退场|隐居|牺牲)[^）)]*)[）)]/g,
        /\|\s*([^|\n]{1,8})\s*\|\s*([^|\n]*(?:死亡|重伤|失踪|昏迷|活跃|出场|退场|隐居|牺牲)[^|\n]*)\s*\|/g,
    ];

    for (const re of patterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            const name = m[1].trim();
            const state = m[2].trim();
            if (!map.has(name)) map.set(name, []);
            map.get(name)!.push(state);
        }
    }

    // 上下文模式："XXX 在...后死亡" / "XXX 仍然活跃"
    const contextRe = /([^\s，。！？\n【】（）]{1,8})\s*(?:在[^\n]*?后|仍然|依旧|继续|从此)?\s*(死亡|阵亡|陨落|重伤|失踪|昏迷|退场|隐居|牺牲|活跃|出场)/g;
    let cm: RegExpExecArray | null;
    while ((cm = contextRe.exec(text)) !== null) {
        const name = cm[1].trim();
        const state = cm[2].trim();
        if (!map.has(name)) map.set(name, []);
        if (!map.get(name)!.includes(state)) map.get(name)!.push(state);
    }

    return map;
}

function extractForeshadowReveals(text: string): string[] {
    const reveals: string[] = [];
    const re = /(?:回收|揭晓|揭露|解开|揭开|真相大白)\s*(?:["「『])?(.+?)(?:["」』])?(?=\s|，|。|！|？|$|\n)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const name = m[1].trim();
        if (name.length > 0 && name.length < 20) reveals.push(name);
    }
    return reveals;
}

function extractFactionEvents(text: string): Map<string, string[]> {
    const map = new Map<string, string[]>();
    const re = /([^\s，。！？\n【】（）]{1,10})(?:势力|宗门|家族|帮派|组织)?\s*(崛起|兴盛|壮大|称霸|登顶|覆灭|灭亡|衰落|瓦解|被灭|衰败|转型)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const name = m[1].trim();
        const event = m[2].trim();
        if (!map.has(name)) map.set(name, []);
        map.get(name)!.push(event);
    }
    return map;
}

function extractTurningPointMentions(text: string): string[] {
    const mentions: string[] = [];
    // 提取 ## 或 ### 下的关键事件标题
    const re = /#{2,3}\s*(.+?)(?:\n|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        mentions.push(m[1].trim());
    }
    return mentions;
}

function hasSubplot(text: string): boolean {
    return SUBLINE_MARKERS.some(marker => text.includes(marker));
}

function extractSubplotChapters(text: string): number[] {
    const chapters: number[] = [];
    const re = /第(\d+)章/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n)) chapters.push(n);
    }
    return chapters;
}

function isDeathState(states: string[]): boolean {
    return states.some(s => DEATH_STATES.some(ds => s.includes(ds)));
}

function isActiveState(states: string[]): boolean {
    return states.some(s => ACTIVE_STATES.some(as => s.includes(as)));
}

export class CrossVolumeOutlineValidator {
    validate(volumes: string[], blueprint: GlobalStorylineBlueprint): CrossVolumeValidationReport {
        const criticalIssues: ValidationIssue[] = [];
        const warningIssues: ValidationIssue[] = [];

        const parsedVolumes: ParsedVolume[] = volumes.map((rawText, index) => ({
            index,
            rawText,
            chapterRange: extractChapterRange(rawText),
            characterStates: extractCharacterStates(rawText),
            foreshadowReveals: [],
            factionEvents: new Map(),
            turningPointMentions: [],
            hasSubplot: hasSubplot(rawText),
            subplotRelatedChapters: extractSubplotChapters(rawText),
        }));

        // 1. 章节号连续性检查
        this.checkChapterContinuity(parsedVolumes, criticalIssues, warningIssues);

        // 2. 人物一致性（主线 critical）
        this.checkCharacterConsistency(parsedVolumes, criticalIssues, warningIssues, blueprint);

        // 3. 主线事件衔接
        this.checkTurningPoints(parsedVolumes, criticalIssues, blueprint);

        // 4. 伏笔回收
        this.checkForeshadowReveals(parsedVolumes, criticalIssues, warningIssues, blueprint);

        // 5. 势力格局
        this.checkFactionTimeline(parsedVolumes, criticalIssues, blueprint);

        // 6. 支线-主线连接逻辑
        this.checkSubplotConnection(parsedVolumes, criticalIssues, warningIssues);

        return {
            isValid: criticalIssues.length === 0,
            criticalIssues,
            warningIssues,
            checkedAt: Date.now(),
        };
    }

    private checkChapterContinuity(
        volumes: ParsedVolume[],
        criticalIssues: ValidationIssue[],
        warningIssues?: ValidationIssue[],
    ): void {
        const sorted = [...volumes].filter(v => v.chapterRange !== null);
        sorted.sort((a, b) => (a.chapterRange![0] - b.chapterRange![0]));

        // 对没有识别到章节范围的卷发出 warning（提示格式可能异常）
        if (warningIssues) {
            for (const v of volumes) {
                if (v.chapterRange === null) {
                    warningIssues.push({
                        type: 'chapter_range_missing',
                        severity: 'warning',
                        message: `第${v.index + 1}卷未识别到章节范围（格式可能异常），跳过连续性检查`,
                        volumeIndex: v.index,
                    });
                }
            }
        }

        // 只在物理相邻卷之间检查连续性（index 差为 1）
        for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1];
            const curr = sorted[i];
            // 只有当两卷在原 volumes 数组中是物理相邻时才检查连续性
            if (Math.abs(curr.index - prev.index) !== 1) continue;
            const prevEnd = prev.chapterRange![1];
            const currStart = curr.chapterRange![0];
            if (currStart !== prevEnd + 1) {
                criticalIssues.push({
                    type: 'chapter_range_gap',
                    severity: 'critical',
                    message: `第${curr.index + 1}卷章节范围(${currStart}-${curr.chapterRange![1]})与第${prev.index + 1}卷(${prev.chapterRange![0]}-${prevEnd})不连续，缺失或重叠章号`,
                    volumeIndex: curr.index,
                    relatedVolumes: [prev.index, curr.index],
                });
            }
        }
    }

    private checkCharacterConsistency(
        volumes: ParsedVolume[],
        criticalIssues: ValidationIssue[],
        warningIssues: ValidationIssue[],
        blueprint: GlobalStorylineBlueprint,
    ): void {
        const allNames = new Set<string>();
        volumes.forEach(v => v.characterStates.forEach((_, name) => allNames.add(name)));

        // 蓝图中的角色时间线优先级更高
        if (blueprint.characterTimeline) {
            for (const cs of blueprint.characterTimeline) {
                const sorted = [...cs.expectedStates].sort((a, b) => a.volume - b.volume);
                for (let i = 1; i < sorted.length; i++) {
                    const prev = sorted[i - 1];
                    const curr = sorted[i];
                    const prevDead = DEATH_STATES.some(ds => prev.state.includes(ds));
                    const currActive = ACTIVE_STATES.some(as => curr.state.includes(as));
                    if (prevDead && currActive) {
                        criticalIssues.push({
                            type: 'character_state_conflict',
                            severity: 'critical',
                            message: `角色「${cs.characterName}」在第${prev.volume}卷状态为「${prev.state}」，第${curr.volume}卷却「${curr.state}」，存在矛盾`,
                            relatedVolumes: [prev.volume - 1, curr.volume - 1],
                        });
                    }
                }
            }
        }

        // 从文本提取的角色状态交叉验证
        for (const name of allNames) {
            const statesByVolume: Array<{ volume: number; states: string[] }> = [];
            for (const v of volumes) {
                const states = v.characterStates.get(name);
                if (states) statesByVolume.push({ volume: v.index + 1, states });
            }

            for (let i = 0; i < statesByVolume.length; i++) {
                const curr = statesByVolume[i];
                if (isDeathState(curr.states)) {
                    for (let j = i + 1; j < statesByVolume.length; j++) {
                        const later = statesByVolume[j];
                        if (isActiveState(later.states)) {
                            criticalIssues.push({
                                type: 'character_state_conflict',
                                severity: 'critical',
                                message: `角色「${name}」在第${curr.volume}卷呈现死亡/退场状态，第${later.volume}卷仍活跃出场，存在矛盾`,
                                relatedVolumes: [curr.volume - 1, later.volume - 1],
                            });
                        }
                    }
                }
            }
        }
    }

    private checkTurningPoints(
        volumes: ParsedVolume[],
        criticalIssues: ValidationIssue[],
        blueprint: GlobalStorylineBlueprint,
    ): void {
        if (!blueprint.turningPoints || blueprint.turningPoints.length === 0) return;

        for (const tp of blueprint.turningPoints) {
            const volIndex = tp.expectedVolume - 1;
            if (!Number.isFinite(volIndex) || volIndex < 0 || volIndex >= volumes.length) {
                criticalIssues.push({
                    type: 'turning_point_missing',
                    severity: 'critical',
                    message: `蓝图转折点「${tp.name}」预期在第${tp.expectedVolume}卷，但大纲只有${volumes.length}卷`,
                    volumeIndex: volIndex,
                });
                continue;
            }

            // 转折点只发生一次：只要在预期卷或更早的卷出现过，就不算缺失。
            // 否则蓝图 expectedVolume 一旦偏差，就会要求后续卷重复写已发生的事件，
            // 触发整卷重写（耗时）并最终留下「降级生成」标记（质量假象）。
            const mentioned = volumes
                .slice(0, volIndex + 1)
                .some(v => smartMatchName(tp.name, v.rawText));
            if (!mentioned) {
                criticalIssues.push({
                    type: 'turning_point_missing',
                    severity: 'critical',
                    message: `第${tp.expectedVolume}卷大纲未提及蓝图规划的关键转折点「${tp.name}」`,
                    volumeIndex: volIndex,
                });
            }
        }
    }

    private checkForeshadowReveals(
        volumes: ParsedVolume[],
        criticalIssues: ValidationIssue[],
        warningIssues: ValidationIssue[],
        blueprint: GlobalStorylineBlueprint,
    ): void {
        // 主线伏笔检查
        if (blueprint.requiredForeshadows && blueprint.requiredForeshadows.length > 0) {
            for (const fs of blueprint.requiredForeshadows) {
                const expectedVol = fs.expectedRevealVolume;
                const revealed = Array.from({ length: Math.min(expectedVol, volumes.length) }, (_, i) => i)
                    .some(i => smartMatchName(fs.name, volumes[i].rawText));
                if (!revealed) {
                    if (expectedVol <= volumes.length) {
                        criticalIssues.push({
                            type: 'foreshadow_not_revealed',
                            severity: 'critical',
                            message: `蓝图要求伏笔「${fs.name}」必须在第${expectedVol}卷前回收，但前${expectedVol}卷大纲均未安排回收`,
                            relatedVolumes: Array.from({ length: expectedVol }, (_, i) => i),
                        });
                    } else {
                        warningIssues.push({
                            type: 'foreshadow_not_revealed',
                            severity: 'warning',
                            message: `蓝图要求伏笔「${fs.name}」在第${expectedVol}卷回收，但当前仅提供${volumes.length}卷大纲`,
                        });
                    }
                }
            }
        }

        // 支线伏笔 warning 检查：仅根据文本自身
        for (const v of volumes) {
            if (v.hasSubplot) {
                const subplotText = v.rawText;
                const hasReveal = FORESHADOW_REVEAL_WORDS.some(w => subplotText.includes(w));
                if (!hasReveal) {
                    warningIssues.push({
                        type: 'subplot_foreshadow_weak',
                        severity: 'warning',
                        message: `第${v.index + 1}卷含支线内容，但未明确安排任何伏笔回收/揭晓，可能导致支线缺乏收束感`,
                        volumeIndex: v.index,
                    });
                }
            }
        }
    }

    private checkFactionTimeline(
        volumes: ParsedVolume[],
        criticalIssues: ValidationIssue[],
        blueprint: GlobalStorylineBlueprint,
    ): void {
        if (!blueprint.factionTimeline || blueprint.factionTimeline.length === 0) return;

        for (const fe of blueprint.factionTimeline) {
            const volIndex = fe.expectedVolume - 1;
            if (volIndex < 0 || volIndex >= volumes.length) continue;

            const vol = volumes[volIndex];
            const factionMentioned = smartMatchName(fe.factionName, vol.rawText);
            const matched =
                factionMentioned &&
                (fe.eventType === 'rise' && FACTION_RISE_WORDS.some(w => vol.rawText.includes(w)) ||
                    fe.eventType === 'fall' && FACTION_FALL_WORDS.some(w => vol.rawText.includes(w)) ||
                    fe.eventType === 'transform');

            if (!matched) {
                const eventDesc = fe.eventType === 'rise' ? '崛起/兴盛' : fe.eventType === 'fall' ? '覆灭/衰落' : '重大变化';
                criticalIssues.push({
                    type: 'faction_timeline_mismatch',
                    severity: 'critical',
                    message: `蓝图要求「${fe.factionName}」在第${fe.expectedVolume}卷应发生${eventDesc}，但该卷大纲未体现此事件`,
                    volumeIndex: volIndex,
                });
            }
        }
    }

    private checkSubplotConnection(
        volumes: ParsedVolume[],
        criticalIssues: ValidationIssue[],
        warningIssues: ValidationIssue[],
    ): void {
        for (const v of volumes) {
            if (!v.hasSubplot) continue;

            const text = v.rawText;

            // 检查是否含有因果连接词
            const hasCausal = CAUSAL_CONNECTORS.some(c => text.includes(c));
            if (!hasCausal) {
                criticalIssues.push({
                    type: 'subplot_mainline_disconnect',
                    severity: 'critical',
                    message: `第${v.index + 1}卷支线内容缺少与主线的因果连接（如"因此""源于""回归主线"等），可能形成逻辑断裂`,
                    volumeIndex: v.index,
                });
            }

            // 支线内部逻辑 warning：检查支线是否明确收束
            const hasResolution = /支线.{0,20}(收束|结束|完结|收尾|回归|并入)/.test(text) ||
                /(收束|结束|完结|收尾).{0,20}支线/.test(text);
            if (!hasResolution) {
                warningIssues.push({
                    type: 'subplot_no_resolution',
                    severity: 'warning',
                    message: `第${v.index + 1}卷支线未在大纲中明确收束或回归主线，可能导致支线悬空`,
                    volumeIndex: v.index,
                });
            }
        }
    }

    detectVolumeConflict(existingVolumes: number, newVolumeCount: number, newChaptersPerVolume: number): VolumeConflictInfo {
        if (existingVolumes !== newVolumeCount) {
            const totalNewChapters = newVolumeCount * newChaptersPerVolume;
            return {
                hasConflict: true,
                conflictType: 'count_mismatch',
                message: `卷数量冲突：现有 ${existingVolumes} 卷，新规划 ${newVolumeCount} 卷`,
                details: `新规划总章节约 ${totalNewChapters} 章（${newChaptersPerVolume} 章/卷 × ${newVolumeCount} 卷），与现有卷数不一致，需重新对齐大纲结构。`,
            };
        }

        return {
            hasConflict: false,
            conflictType: 'none',
            message: '卷数量一致，无冲突',
            details: `现有 ${existingVolumes} 卷与新规划 ${newVolumeCount} 卷数量匹配。`,
        };
    }
}
