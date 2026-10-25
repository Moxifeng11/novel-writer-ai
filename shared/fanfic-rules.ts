/**
 * shared/fanfic-rules.ts — 同人创作约束的唯一读取入口
 *
 * 权威来源是项目 `.project` 的「## 同人设定路径」，与向导/项目面板的保存侧一致。
 * 该模块只负责「读 + 解析 + 格式化」，不做 UI，也不依赖 main.ts，便于单测。
 */
import { App, TFile } from 'obsidian';
import { pjProjectMeta } from './paths';

export interface FanficRules {
    /** 是否同人项目 */
    isFanfic: boolean;
    /** 同人设定文件路径（可能为空：项目标记为同人但未绑定设定） */
    path: string;
    workName: string;
    /** 原作核心设定：世界观类型 / 力量体系 / 核心规则 */
    worldviewType: string;
    powerSystem: string;
    coreRules: string;
    mustFollow: string;
    adaptScope: string;
    redlines: string;
    /**
     * 原作主要人物（来自设定文件的「## 主要人物」段）。
     * 模板一直有这一节，但此前既不解析也不注入，同人角色性格与定位对模型完全不可见。
     */
    characters?: FanficCharacter[];
    /**
     * 原作势力组织（来自设定文件的「## 势力组织」段）。
     * 势力决定阵营立场与冲突逻辑，不注入时模型容易写错谁与谁对立。
     */
    factions?: FanficCharacter[];
    /**
     * 原作剧情时间线（来自「## 原作剧情时间线」表格）。
     * 模板在表头注明「全量输入，用于 AI 写作时检索当前章节在原作时间线上的位置」，
     * 但读取侧此前完全没有实现——模型不知道当前情节发生在 canon 的哪一段。
     */
    originalTimeline?: string[];
    /**
     * 同人自身时间线（来自「## 故事背景时间线（你的同人）」表格）。
     * 与上者分开注入：一个是原作事件顺序，一个是本书自己的进度，混排会让模型对不上号。
     */
    fanficTimeline?: string[];
    /**
     * 加载失败原因（成功时不存在）。
     * 同人项目在「路径未绑定 / 文件不存在 / 读取异常」时都会退化为空规则，
     * 若不把原因带出来，协同写作会在没有任何原作约束的情况下静默继续。
     */
    loadError?: FanficRulesLoadError;
}

export interface FanficCharacter {
    name: string;
    /** 原作定位 */
    originalRole: string;
    /** 在同人中的变化（可为空） */
    change: string;
}

export type FanficRulesLoadError = 'missing-path' | 'missing-file' | 'read-failed';

const EMPTY_RULES: FanficRules = {
    isFanfic: false,
    path: '',
    workName: '',
    worldviewType: '',
    powerSystem: '',
    coreRules: '',
    mustFollow: '',
    adaptScope: '',
    redlines: '',
    characters: [],
};

/** 注入 prompt 时单项上限，避免用户粘贴长文挤占本地小窗口预算 */
export const FANFIC_RULE_ITEM_MAX_CHARS = 160;

/** 注入 prompt 时原作人物最多条数（本地 8K 窗口下不能把人物表全量塞进去） */
export const FANFIC_MAX_INJECTED_CHARACTERS = 6;

/** 人物单字段注入上限 */
export const FANFIC_CHARACTER_FIELD_MAX_CHARS = 60;

/** 时间线最多注入条数（模板写「全量输入」，但本地 8K 窗口必须设上限） */
export const FANFIC_MAX_INJECTED_TIMELINE_ROWS = 8;

/** 时间线单行注入上限 */
export const FANFIC_TIMELINE_ROW_MAX_CHARS = 120;

/** 原作时间线窗口在锚点之前保留的行数：让模型看到当前进度之前发生了什么 */
const FANFIC_TIMELINE_WINDOW_BEFORE = 2;

/** 用同人时间线最近几条寻找 canon 锚点（最新进度优先） */
const FANFIC_TIMELINE_ANCHOR_LOOKBACK = 3;

/** 模板里的空占位，解析时视为未填写（生成骨架会写「（待补充）」） */
const FANFIC_PLACEHOLDERS = new Set(['待补充', '（待补充）', '(待补充)']);

/** 解析 `.project` 元信息，取出类型与同人设定路径 */
export function parseProjectMeta(metaContent: string): { isFanfic: boolean; fanficPath: string } {
    const typeMatch = metaContent.match(/^##\s*类型\s*\r?\n\s*(\S+)/m);
    const pathMatch = metaContent.match(/^##\s*同人设定路径\s*\r?\n\s*(\S.*)/m);
    const fanficPath = pathMatch ? pathMatch[1].trim() : '';
    const isFanfic = typeMatch ? typeMatch[1].trim() === 'fanfic' : !!fanficPath;
    return { isFanfic, fanficPath };
}

/**
 * 读取同人设定里的单个字段值。
 *
 * 权威格式是正文 `- **字段**：值`（生成文件与手写文件都用这种），必须保留多行续行：
 * 只取第一行会让 prompt 里的规则比向导里显示的少一截。
 * 正文没有该字段时回退 frontmatter `字段: 值`（用户可能只写了 frontmatter）。
 * 遇到下一条 `- **` 规则、Markdown 标题或空行即停止，避免吞并后续内容。
 */
export function extractFanficRuleValue(content: string, label: string): string {
    if (!content) return '';
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const marker = new RegExp(`^\\s*(?:-\\s*)?\\*\\*${escaped}\\*\\*\\s*[：:]\\s*(.*)$`);
    const collected: string[] = [];
    let active = false;
    for (const line of content.split(/\r?\n/)) {
        const match = line.match(marker);
        if (match) {
            active = true;
            const value = match[1].trim();
            if (value) collected.push(value);
            continue;
        }
        if (!active) continue;
        const trimmed = line.trim();
        if (!trimmed) break;
        if (/^-\s*\*\*/.test(trimmed) || /^#{1,6}\s/.test(trimmed)) break;
        collected.push(trimmed);
    }
    const body = collected.join('\n').trim();
    if (body) return body;

    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatter) return '';
    const fmLine = frontmatter[1].match(new RegExp(`^${escaped}\\s*[：:]\\s*(.+)$`, 'm'));
    return fmLine ? fmLine[1].trim() : '';
}

/**
 * 解析「多条同构条目」小节（模板格式：`- **名称**：` + 两个缩进子项）。
 *
 * 不能用 `extractFanficRuleValue(content, 名称标签)` 一次搞定：它只会取第一条。
 * 这里按条目切分，再对每条复用同一字段解析（子项以 `- **` 开头，会被正确截断）。
 */
function parseFanficEntrySection(content: string, sectionTitle: string, nameLabel: string): FanficCharacter[] {
    if (!content) return [];
    const heading = new RegExp(`^##\\s*${sectionTitle}\\s*$`);
    const nameMarker = new RegExp(`^\\s*-\\s*\\*\\*${nameLabel}\\*\\*\\s*[：:]`);
    const sectionLines: string[] = [];
    let inside = false;
    for (const line of content.split(/\r?\n/)) {
        if (heading.test(line)) {
            inside = true;
            continue;
        }
        if (inside && /^##\s/.test(line)) break;
        if (inside) sectionLines.push(line);
    }
    if (sectionLines.length === 0) return [];

    const blocks: string[] = [];
    let current: string[] | null = null;
    for (const line of sectionLines) {
        if (nameMarker.test(line)) {
            if (current) blocks.push(current.join('\n'));
            current = [line];
            continue;
        }
        if (current) current.push(line);
    }
    if (current) blocks.push(current.join('\n'));

    const entries: FanficCharacter[] = [];
    for (const block of blocks) {
        const name = extractFanficRuleValue(block, nameLabel);
        if (!name || FANFIC_PLACEHOLDERS.has(name)) continue;
        const originalRole = extractFanficRuleValue(block, '原作定位');
        const change = extractFanficRuleValue(block, '在同人中的变化');
        entries.push({
            name,
            originalRole: FANFIC_PLACEHOLDERS.has(originalRole) ? '' : originalRole,
            change: FANFIC_PLACEHOLDERS.has(change) ? '' : change,
        });
    }
    return entries;
}

/** 解析「## 主要人物」 */
export function parseFanficCharacters(content: string): FanficCharacter[] {
    return parseFanficEntrySection(content, '主要人物', '人物名');
}

/** 解析「## 势力组织」 */
export function parseFanficFactions(content: string): FanficCharacter[] {
    return parseFanficEntrySection(content, '势力组织', '势力名');
}

/**
 * 解析指定小节的 Markdown 表格，返回每行的紧凑文本（单元格用「｜」连接）。
 *
 * 模板的两张时间线表都声明「全量输入」，但读取侧此前只认「- **字段**：」格式，
 * 表格永远解析为空：模型不知道当前情节落在 canon 的哪一段，也看不到本书自己的时间进度。
 * 表头行与 `|---|` 分隔行不是内容，必须丢弃；整行都是占位「待补充」的行同样丢弃
 * （生成骨架写的就是占位行，注入它等于告诉模型「时间线: 待补充」）。
 */
export function parseFanficTimeline(content: string, sectionTitle: string): string[] {
    return parseFanficTimelineRows(content, sectionTitle)
        .map((cells) => cells.filter((cell) => cell && !FANFIC_PLACEHOLDERS.has(cell)).join('｜'));
}

/**
 * 解析同人时间线表格的原始单元格（二维数组，列位置与文件一一对应）。
 *
 * prompt 注入与上下文面板必须共用这一份行数据：面板侧旧实现先过滤空单元格再按列名映射，
 * 中间某列为空时后续列会整体左移（「章节参考」显示在「涉及人物」下），
 * 与 prompt 里的行内容对不上。空单元格必须保留为空串，占位单元格按原值保留、由调用方决定是否展示。
 */
export function parseFanficTimelineRows(content: string, sectionTitle: string): string[][] {
    if (!content) return [];
    const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 允许标题带后缀括号：「## 故事背景时间线（你的同人）」
    const heading = new RegExp(`^##\\s*${escaped}\\s*(?:[（(].*)?$`);
    const rows: string[][] = [];
    let inside = false;
    for (const line of content.split(/\r?\n/)) {
        if (heading.test(line)) {
            inside = true;
            continue;
        }
        if (inside && /^##\s/.test(line)) break;
        const trimmed = line.trim();
        if (!inside || !trimmed.startsWith('|')) continue;
        const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
        rows.push(cells);
    }
    if (rows.length === 0) return [];

    // 有分隔行（|---|）时，它紧邻的上一行是表头
    const separatorIndex = rows.findIndex((cells) => cells.every((cell) => /^:?-{2,}:?$/.test(cell)));
    const body = separatorIndex >= 0
        ? rows.filter((_, index) => index !== separatorIndex && index !== separatorIndex - 1)
        : rows;

    const result: string[][] = [];
    for (const cells of body) {
        // 整行都是空/占位 → 不是时间线数据；但单个空单元格必须保留列位置
        if (!cells.some((cell) => cell && !FANFIC_PLACEHOLDERS.has(cell))) continue;
        result.push(cells);
    }
    return result;
}

/** 从同人设定正文中解析「作品名称 + 原作核心设定 + 三条创作规则」 */
export function parseFanficRules(content: string, path: string): FanficRules {
    const workName = content.match(/^作品名称:\s*(.+)$/m)?.[1]?.trim()
        || content.match(/^#\s*(.+?)\s*同人设定\s*$/m)?.[1]?.trim()
        || '';
    // 生成骨架会把未填字段写成「（待补充）」，AI 也被要求「不确定写待补充」；
    // 这些占位一旦进 prompt 就成了「必须遵守的原作规则：（待补充）」这种假约束，
    // 与人物/势力条目同口径：解析阶段直接丢弃（向导回填仍走 extractFanficRuleValue 保留原文）。
    const pick = (label: string): string => {
        const value = extractFanficRuleValue(content, label);
        return FANFIC_PLACEHOLDERS.has(value.trim()) ? '' : value;
    };
    return {
        isFanfic: true,
        path,
        workName,
        worldviewType: pick('世界观类型'),
        powerSystem: pick('力量体系'),
        coreRules: pick('核心规则'),
        mustFollow: pick('必须遵守的原作规则'),
        adaptScope: pick('允许改编的范围'),
        redlines: pick('禁止触及的红线'),
        characters: parseFanficCharacters(content),
        factions: parseFanficFactions(content),
        originalTimeline: parseFanficTimeline(content, '原作剧情时间线'),
        fanficTimeline: parseFanficTimeline(content, '故事背景时间线'),
    };
}

/** 读取项目的同人约束；非同人项目或设定缺失时返回空规则 */
export async function readFanficRules(app: App, project: string): Promise<FanficRules> {
    if (!project) return EMPTY_RULES;
    const metaFile = app.vault.getAbstractFileByPath(pjProjectMeta(project));
    if (!(metaFile instanceof TFile)) return EMPTY_RULES;

    let metaContent = '';
    try {
        metaContent = await app.vault.read(metaFile);
    } catch {
        return EMPTY_RULES;
    }
    const { isFanfic, fanficPath } = parseProjectMeta(metaContent);
    if (!isFanfic) return EMPTY_RULES;
    if (!fanficPath) return { ...EMPTY_RULES, isFanfic: true, loadError: 'missing-path' };

    const file = app.vault.getAbstractFileByPath(fanficPath);
    if (!(file instanceof TFile)) return { ...EMPTY_RULES, isFanfic: true, path: fanficPath, loadError: 'missing-file' };

    try {
        const content = await app.vault.read(file);
        return parseFanficRules(content, fanficPath);
    } catch {
        return { ...EMPTY_RULES, isFanfic: true, path: fanficPath, loadError: 'read-failed' };
    }
}

/**
 * 通过 FileSystemPort 读取同人约束（engine 层用，避免依赖 App）。
 * 与 readFanficRules 共用解析逻辑，缺失/损坏时返回空规则。
 */
export async function readFanficRulesFromFS(
    fs: import('./file-system-port').FileSystemPort,
    project: string
): Promise<FanficRules> {
    if (!project) return EMPTY_RULES;
    let metaContent = '';
    try {
        metaContent = await fs.read(pjProjectMeta(project));
    } catch {
        return EMPTY_RULES;
    }
    const { isFanfic, fanficPath } = parseProjectMeta(metaContent);
    if (!isFanfic) return EMPTY_RULES;
    if (!fanficPath) return { ...EMPTY_RULES, isFanfic: true, loadError: 'missing-path' };
    if (!(await fs.exists(fanficPath))) {
        return { ...EMPTY_RULES, isFanfic: true, path: fanficPath, loadError: 'missing-file' };
    }
    try {
        const content = await fs.read(fanficPath);
        return parseFanficRules(content, fanficPath);
    } catch {
        return { ...EMPTY_RULES, isFanfic: true, path: fanficPath, loadError: 'read-failed' };
    }
}

interface FanficTimelineSelection {
    rows: string[];
    /** 选中窗口在完整时间线中的起始下标（0-based） */
    start: number;
}

function splitTimelineRow(row: string): string[] {
    return row.split('｜');
}

/**
 * 用同人时间线最近几条的「对应原作时间」在 canon 时间线里定位锚点。
 * 先精确匹配、再包含匹配，都从后往前取最近一次出现；找不到返回 -1。
 */
function findCanonTimelineAnchor(canonRows: string[], fanRows: string[]): number {
    const recent = fanRows.slice(-FANFIC_TIMELINE_ANCHOR_LOOKBACK);
    for (let i = recent.length - 1; i >= 0; i--) {
        const ref = (splitTimelineRow(recent[i])[2] ?? '').trim();
        if (!ref || FANFIC_PLACEHOLDERS.has(ref) || ref.length < 2) continue;
        for (let row = canonRows.length - 1; row >= 0; row--) {
            if (splitTimelineRow(canonRows[row]).some((cell) => cell.trim() === ref)) return row;
        }
        for (let row = canonRows.length - 1; row >= 0; row--) {
            const hit = splitTimelineRow(canonRows[row]).some((cell) => {
                const value = cell.trim();
                return value.length >= 2 && (value.includes(ref) || ref.includes(value));
            });
            if (hit) return row;
        }
    }
    return -1;
}

/**
 * 原作时间线窗口：超过上限时按同人进度锚点取连续 8 行；
 * 没有锚点保持原来的「前 8 行」，避免用户只填 canon 时行为突变。
 */
function selectCanonTimeline(rows: string[], fanRows: string[]): FanficTimelineSelection {
    const limit = FANFIC_MAX_INJECTED_TIMELINE_ROWS;
    if (rows.length <= limit) return { rows, start: 0 };
    const anchor = findCanonTimelineAnchor(rows, fanRows);
    if (anchor < 0) return { rows: rows.slice(0, limit), start: 0 };
    const start = Math.min(Math.max(anchor - FANFIC_TIMELINE_WINDOW_BEFORE, 0), rows.length - limit);
    return { rows: rows.slice(start, start + limit), start };
}

/**
 * 同人时间线窗口：这是本书自己的进度，越靠后越接近当前章节，
 * 超过上限时取最近 8 行；继续取前 8 行会让写到中后期的同人永远看不到自己的最新进度。
 */
function selectFanficTimeline(rows: string[]): FanficTimelineSelection {
    const limit = FANFIC_MAX_INJECTED_TIMELINE_ROWS;
    if (rows.length <= limit) return { rows, start: 0 };
    const start = rows.length - limit;
    return { rows: rows.slice(start), start };
}

/**
 * 同人 prompt 注入选项。
 * focusText 是当前章节上下文（大纲 + 已写正文尾部）：人物/势力超过注入上限时，
 * 它决定「哪 6 条」进入 prompt，避免本章真正出场的角色排在第 7 位就完全不可见。
 */
export interface FanficPromptOptions {
    focusText?: string;
}

function countNameMentions(text: string, name: string): number {
    if (!text || !name) return 0;
    let count = 0;
    let index = text.indexOf(name);
    while (index !== -1) {
        count++;
        index = text.indexOf(name, index + name.length);
    }
    return count;
}

/**
 * 超过注入上限时按 focusText 中的出现次数排序（同分保持原顺序）；
 * 没有 focusText 时回退「前 N 条」，保证只填资料、不写正文的场景行为不变。
 */
function selectEntriesForInjection(
    entries: FanficCharacter[] | undefined,
    focusText: string | undefined,
): FanficCharacter[] {
    const list = entries ?? [];
    const limit = FANFIC_MAX_INJECTED_CHARACTERS;
    if (list.length <= limit) return list;
    const focus = (focusText ?? '').trim();
    if (!focus) return list.slice(0, limit);
    return list
        .map((entry, index) => ({ entry, index, score: countNameMentions(focus, entry.name) }))
        .sort((a, b) => (b.score - a.score) || (a.index - b.index))
        .slice(0, limit)
        .map((item) => item.entry);
}

/**
 * 格式化为可注入 prompt 的段落。非同人或核心设定与三条规则全空时返回空字符串，
 * 保证原创项目模板填充后不残留任何同人痕迹。
 *
 * 原作核心设定（世界观类型/力量体系/核心规则）必须一起注入：
 * 只给三条规则时，模型知道「不许 OOC」却不知道原作力量体系边界，
 * 长篇续写仍会写出体系外的能力。
 */
export function formatFanficRulesForPrompt(rules: FanficRules, options: FanficPromptOptions = {}): string {
    if (!rules.isFanfic) return '';
    const clip = (value: string): string =>
        value.length > FANFIC_RULE_ITEM_MAX_CHARS
            ? `${value.slice(0, FANFIC_RULE_ITEM_MAX_CHARS)}…`
            : value;

    const core: string[] = [];
    if (rules.worldviewType) core.push(`- 原作世界观类型：${clip(rules.worldviewType)}`);
    if (rules.powerSystem) core.push(`- 原作力量体系：${clip(rules.powerSystem)}`);
    if (rules.coreRules) core.push(`- 原作核心规则：${clip(rules.coreRules)}`);

    const ruleLines: string[] = [];
    if (rules.mustFollow) ruleLines.push(`- 必须遵守的原作规则：${clip(rules.mustFollow)}`);
    if (rules.adaptScope) ruleLines.push(`- 允许改编的范围：${clip(rules.adaptScope)}`);
    if (rules.redlines) ruleLines.push(`- 禁止触及的红线：${clip(rules.redlines)}`);

    // 原作人物与势力：模板里的「## 主要人物」「## 势力组织」此前既不解析也不注入，
    // 模型只知道规则、不知道这些角色/阵营原本是谁，同人正文最容易在立场与定位上 OOC。
    const clipField = (value: string): string =>
        value.length > FANFIC_CHARACTER_FIELD_MAX_CHARS
            ? `${value.slice(0, FANFIC_CHARACTER_FIELD_MAX_CHARS)}…`
            : value;
    const buildEntryLines = (
        entries: FanficCharacter[] | undefined,
        label: string,
        unit: '人' | '个',
    ): string[] => {
        const all = entries ?? [];
        const selected = selectEntriesForInjection(all, options.focusText);
        const lines: string[] = [];
        for (const entry of selected) {
            if (!entry.name) continue;
            const bits: string[] = [];
            if (entry.originalRole) bits.push(`原作定位：${clipField(entry.originalRole)}`);
            if (entry.change) bits.push(`在同人中的变化：${clipField(entry.change)}`);
            lines.push(bits.length > 0 ? `- ${entry.name}（${bits.join('；')}）` : `- ${entry.name}`);
        }
        if (all.length > selected.length) {
            const range = (options.focusText ?? '').trim()
                ? `以上为与当前章节相关的 ${selected.length} ${unit}`
                : `以上为前 ${selected.length} ${unit}`;
            lines.push(`- （${label}共 ${all.length} ${unit}，${range}）`);
        }
        return lines;
    };
    const characterLines = buildEntryLines(rules.characters, '原作主要人物', '人');
    const factionLines = buildEntryLines(rules.factions, '原作势力组织', '个');
    const clipTimelineRow = (row: string): string =>
        row.length > FANFIC_TIMELINE_ROW_MAX_CHARS
            ? `${row.slice(0, FANFIC_TIMELINE_ROW_MAX_CHARS)}…`
            : row;
    const buildTimelineLines = (
        selection: FanficTimelineSelection,
        total: number,
        label: string,
        tail: boolean,
    ): string[] => {
        const lines = selection.rows.map((row) => `- ${clipTimelineRow(row)}`);
        if (total > selection.rows.length) {
            const range = tail
                ? `以上为最近 ${selection.rows.length} 行`
                : `以上为第 ${selection.start + 1}–${selection.start + selection.rows.length} 行`;
            lines.push(`- （${label}共 ${total} 行，${range}）`);
        }
        return lines;
    };
    const originalTimeline = rules.originalTimeline ?? [];
    const fanficTimeline = rules.fanficTimeline ?? [];
    const fanficSelection = selectFanficTimeline(fanficTimeline);
    const originalTimelineLines = buildTimelineLines(
        selectCanonTimeline(originalTimeline, fanficSelection.rows),
        originalTimeline.length,
        '原作时间线',
        false,
    );
    const fanficTimelineLines = buildTimelineLines(
        fanficSelection,
        fanficTimeline.length,
        '同人时间线',
        true,
    );

    if (
        core.length === 0 && ruleLines.length === 0 && characterLines.length === 0
        && factionLines.length === 0 && originalTimelineLines.length === 0 && fanficTimelineLines.length === 0
    ) {
        return '';
    }

    const work = rules.workName || '原作';
    const parts = [
        '【同人创作约束（最高优先级，违反即返工）】',
        `原作：《${work}》`,
    ];
    if (core.length > 0) parts.push('【原作核心设定】', ...core);
    if (originalTimelineLines.length > 0) parts.push('【原作剧情时间线】', ...originalTimelineLines);
    if (characterLines.length > 0) parts.push('【原作主要人物】', ...characterLines);
    if (factionLines.length > 0) parts.push('【原作势力组织】', ...factionLines);
    if (fanficTimelineLines.length > 0) parts.push('【同人时间线】', ...fanficTimelineLines);
    if (ruleLines.length > 0) parts.push('【创作规则】', ...ruleLines);
    parts.push('- 角色性格、力量体系与关键事件顺序不得与原作规则冲突；超出「允许改编的范围」的改动一律不做。');
    return parts.join('\n');
}

/**
 * 把同人约束块拼到用户要求之前。
 * 统一 6 处实体生成入口的拼接方式，避免「有的入口有约束、有的没有」导致生成标准漂移。
 */
export function mergeFanficRequirement(fanficBlock: string, extra?: string): string {
    const base = (extra || '').trim();
    if (!fanficBlock) return base;
    return base ? `${fanficBlock}\n\n${base}` : fanficBlock;
}

/**
 * 同人设定加载失败或内容为空时给用户的提示文案；正常返回 null。
 * 空规则会让协同在「无原作约束」下继续写作，必须让用户看见，而不是只写日志。
 *
 * 「文件存在、能读、但全是骨架占位」同样算失效：解析阶段已丢弃占位，
 * 此时没有 loadError，若不单独判断，用户会以为绑定成功就一定有约束。
 * 「有可用内容」的口径与 `formatFanficRulesForPrompt` 是否输出约束块一致：
 * 作品名、路径不算内容；六个字段、人物/势力条目、两张时间线任一有实质内容才算。
 */
export function formatFanficRulesLoadWarning(rules: FanficRules): string | null {
    if (!rules.isFanfic) return null;
    const target = rules.path ? `「${rules.path}」` : '同人设定路径';
    if (!rules.loadError) {
        const hasContent = Boolean(
            rules.worldviewType || rules.powerSystem || rules.coreRules
            || rules.mustFollow || rules.adaptScope || rules.redlines
            || (rules.characters?.length ?? 0) > 0
            || (rules.factions?.length ?? 0) > 0
            || (rules.originalTimeline?.length ?? 0) > 0
            || (rules.fanficTimeline?.length ?? 0) > 0
        );
        if (hasContent) return null;
        return `⚠️ 同人设定里没有可用内容：${target}。协同写作不会带原作约束，请补全核心设定或创作规则（「待补充」占位不算填写）。`;
    }
    if (rules.loadError === 'missing-path') {
        return '⚠️ 同人项目尚未绑定设定文件：协同写作不会带原作约束。请在向导「同人设定」步骤填写，或运行命令「添加同人设定」。';
    }
    if (rules.loadError === 'missing-file') {
        return `⚠️ 同人设定文件不存在：${target}。协同写作不会带原作约束，请检查 .project 中的路径或重新保存设定。`;
    }
    return `⚠️ 同人设定读取失败：${target}。协同写作不会带原作约束，请检查文件权限后重试。`;
}
