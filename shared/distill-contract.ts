/**
 * distill-contract.ts — 蒸馏回流契约（正文 → 结构化回流数据）
 *
 * 来源与动机：云笔的「蒸馏闭环」是长篇不崩的关键——正文生成后自动蒸馏 18 项，
 * 回写到章节摘要/角色/场景/势力/物品/伏笔/情绪/台词/钩子/承接/事件线/关系，
 * 其中 16/17 项是**双向补写**（本章蒸馏时回填上一章章尾悬念、下一章章首承接），
 * 让前后章永远咬合（见 docs/audits/2026-11-25-yunbi-writing-flow.md §八）。
 *
 * 本仓此前只有单向：`analysisReport` 提取实体 + 时间线，蒸馏产物不回流。
 *
 * ## 与既有协议行的分工（不重复机制）
 *
 * 已有的 `shared/protocol-lines.ts`（CR/CI/BT/NE）覆盖四项：
 * 关系变化(CR) / 物品变动(CI) / 境界突破(BT) / 新实体(NE)。
 * 本契约**只补它没覆盖的**，避免同一事实两套行：
 *
 * | 云笔 18 项 | 本契约承担 |
 * |---|---|
 * | 1 章节摘要 / 11 钩子 / 12 开头承接 | `C` |
 * | 13 章节事件线（≤30 字） | `EL` |
 * | T 行时间轴 | `T`（结构化日期，供 timeline-chain 链式校验） |
 * | 6 伏笔线索 | `CF` |
 * | 7 情绪节奏 | `M` |
 * | 8/9 关键台词与对话 | `K` |
 * | 4 势力阵营 | `G` |
 * | 3 场景地点 | `L` |
 * | 10 写作要点 | `W` |
 * | 16/17 双向补写 | `OP` / `PH` |
 * | 2 出场角色 / 15 角色经历 | 已有实体提取（不重复） |
 * | 5 道具 / 14 物品变动 | 已有 `CI` 行（不重复） |
 * | 18 关系变化 | 已有 `CR` 行（不重复） |
 *
 * 本模块是纯函数层：解析、校验、渲染。不读盘、不调用模型。
 */

/** 蒸馏行种类 */
export type DistillLineKind =
    | 'C'   // 章节摘要（标题|摘要|章尾悬念|章首承接|关键台词）
    | 'EL'  // 章节事件线（≤30 字）
    | 'T'   // 时间跨度（起始|结束|闪回标记）
    | 'CF'  // 伏笔（名称|状态|备注）
    | 'M'   // 情绪（位置|强度|描述）
    | 'K'   // 关键台词（说话人|台词）
    | 'G'   // 势力（名称|变化）
    | 'L'   // 地点（名称|变化）
    | 'W'   // 写作要点（要点）
    | 'OP'  // 下一章章首承接（双向补写目标）
    | 'PH'; // 上一章章尾悬念（双向补写目标）

/** 单条蒸馏行 */
export interface DistillLine {
    kind: DistillLineKind;
    /** 去掉 tag 后的原始字段（未 trim 的空串已保留，按下标语义解释） */
    fields: string[];
    /** 原始行文本（便于回显与排障） */
    raw: string;
}

/** 伏笔状态 */
export const DISTILL_FORESHADOW_STATES = ['埋设', '推进', '回收'] as const;

/** 解析结果 */
export interface DistillParseResult {
    /** 按种类归组的蒸馏行 */
    lines: Record<DistillLineKind, DistillLine[]>;
    /** 非蒸馏行（正文）——解析时被剔除，调用方通常丢弃 */
    otherLineCount: number;
    /** 解析期问题（未知 tag / 字段数不符 / 缺必需 tag） */
    warnings: string[];
}

/** 校验结果 */
export interface DistillValidationResult {
    /** 硬错误：必须修正才能回流（如缺章节摘要、事件线超长） */
    errors: string[];
    /** 软告警：可回流但需人工确认（如日期不可解析、强度越界被钳制） */
    warnings: string[];
}

/** 事件线长度上限（云笔规定 ≤30 字） */
export const EVENT_LINE_MAX_CHARS = 30;

const ALL_KINDS: DistillLineKind[] = ['C', 'EL', 'T', 'CF', 'M', 'K', 'G', 'L', 'W', 'OP', 'PH'];

/** 各 tag 的期望字段数（不含 tag 本身） */
const FIELD_COUNTS: Record<DistillLineKind, number> = {
    C: 5,
    EL: 1,
    T: 3,
    CF: 3,
    M: 3,
    K: 2,
    G: 2,
    L: 2,
    W: 1,
    OP: 1,
    PH: 1,
};

/**
 * 蒸馏行指令文本（inject 模式注入模型，parse 模式不注入）。
 *
 * 只输出「协议行之外」的部分：关系/物品/新实体仍走既有 CR/CI/BT/NE，
 * 避免模型为同一事实写两套行。
 */
export const DISTILL_LINES_INSTRUCTION = `---

## 正文写完后，追加「蒸馏回流行」（没有就整行不写，不要编造）

格式（每行一个，字段用半角竖线 | 分隔，字段内不得含竖线）：

C|章节标题|本章摘要（60字内）|章尾悬念|章首承接|本章最关键的一句台词
EL|本章核心事件（30字内，含因果）
T|起始日期|结束日期|闪回（写「闪回」或「正常」）
CF|伏笔名|状态（埋设/推进/回收）|备注
M|位置（如 开场/中段/章尾）|强度（0-100）|情绪描述
K|说话人|台词
G|势力名|本章变化
L|地点名|本章变化
W|写作要点（本章达成的一条可复用经验）
OP|下一章开头应该承接的那一句情境
PH|本章结尾留给下一章的悬念

规则：
1. 只写**本章正文中确实发生**的内容，没有就不写该行
2. C / EL / T 三行必写；其余按需
3. T 行日期必须写成「纪元-年-月-日」（如 公元-2-4-15）；不要写「三日后」这类相对时间
4. 关系变化、物品变动、境界突破、新实体分别走 CR / CI / BT / NE 行，不要用上面的行代替`;

/**
 * 从模型输出中分离正文与蒸馏行。
 *
 * 容错：竖线两侧空格、未知 tag（记警告并丢弃）、字段数不符（记警告但保留行）。
 *
 * @param raw - 模型完整输出
 * @returns 归组后的蒸馏行 + 解析警告
 * @example
 * const { lines, warnings } = parseDistillLines('正文。\nC|第1章|主角入山|有人跟踪|山门开启|我不去');
 * lines.C[0].fields[1] // '主角入山'
 */
export function parseDistillLines(raw: string): DistillParseResult {
    const lines: Record<DistillLineKind, DistillLine[]> = {
        C: [], EL: [], T: [], CF: [], M: [], K: [], G: [], L: [], W: [], OP: [], PH: [],
    };
    const warnings: string[] = [];
    let otherLineCount = 0;

    for (const rawLine of String(raw ?? '').split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        const m = line.match(/^([A-Z]{1,2})\s*\|(.*)$/);
        if (!m) {
            otherLineCount++;
            continue;
        }
        const tag = m[1] as DistillLineKind;
        if (!ALL_KINDS.includes(tag)) {
            // 常见干扰：CR/CI/BT/NE 属既有协议行，交给 protocol-lines 处理，不算告警
            if (!['CR', 'CI', 'BT', 'NE'].includes(tag)) {
                warnings.push(`未知蒸馏行 tag「${tag}」，已忽略：${line.slice(0, 40)}`);
            }
            otherLineCount++;
            continue;
        }
        const fields = m[2].split('|').map((f) => f.trim());
        const expected = FIELD_COUNTS[tag];
        if (fields.length !== expected) {
            warnings.push(`${tag} 行字段数 ${fields.length} ≠ 期望 ${expected}（仍保留，按缺失补齐）：${line.slice(0, 40)}`);
        }
        while (fields.length < expected) fields.push('');
        lines[tag].push({ kind: tag, fields: fields.slice(0, Math.max(expected, fields.length)), raw: line });
    }

    if (lines.C.length === 0) warnings.push('缺少 C（章节摘要）行——蒸馏回流的核心字段');
    if (lines.EL.length === 0) warnings.push('缺少 EL（章节事件线）行');

    return { lines, otherLineCount, warnings };
}

/**
 * 分离正文与蒸馏行（一次遍历，带安全阀）。
 *
 * 安全阀（沿用协议行那次真实缺陷的教训）：只有在解析到 `C` 或 `EL` 时才认定
 * 这是真的蒸馏块并剥离；否则**原样保留正文**——普通散文里以 `W|`/`K|` 开头的
 * 行（表格、剧本格式）不能被误摘。
 *
 * @param raw - 模型完整输出
 * @returns 剥离后的正文与解析结果
 * @example
 * const { body, parsed, stripped } = splitDistillLines('正文。' + '\n' + 'C|第1章|摘要|钩子|承接|台词');
 * stripped // true
 */
export function splitDistillLines(raw: string): { body: string; parsed: DistillParseResult; stripped: boolean } {
    const parsed = parseDistillLines(raw);
    const looksLikeDistill = parsed.lines.C.length > 0 || parsed.lines.EL.length > 0;
    if (!looksLikeDistill) {
        return { body: String(raw ?? ''), parsed, stripped: false };
    }
    const NL = String.fromCharCode(10);
    const kept: string[] = [];
    for (const line of String(raw ?? '').split(NL)) {
        const m = line.trim().match(/^([A-Z]{1,2})\s*\|/);
        if (m && ALL_KINDS.includes(m[1] as DistillLineKind)) continue;
        kept.push(line);
    }
    return { body: kept.join(NL), parsed, stripped: true };
}

/**
 * 校验蒸馏行语义。
 *
 * 硬错误：缺 C / EL 超长。软告警：T 行日期不可解析、M 强度越界、CF 状态不在白名单。
 *
 * @param parsed - parseDistillLines 的结果
 * @returns 错误与告警
 * @example
 * validateDistillLines(parseDistillLines('正文')).errors[0] // 含「缺少 C」
 */
export function validateDistillLines(parsed: DistillParseResult): DistillValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const l = parsed.lines;

    if (l.C.length === 0) errors.push('缺少 C（章节摘要）行');
    if (l.EL.length === 0) errors.push('缺少 EL（章节事件线）行');

    for (const line of l.EL) {
        const text = line.fields[0] ?? '';
        if (text.length > EVENT_LINE_MAX_CHARS) {
            errors.push(`EL 事件线超长（${text.length} > ${EVENT_LINE_MAX_CHARS} 字）：${text.slice(0, 40)}`);
        }
        if (!text.trim()) errors.push('EL 事件线为空');
    }

    for (const line of l.T) {
        const start = parseDateField(line.fields[0]);
        const end = parseDateField(line.fields[1]);
        if (!start) warnings.push(`T 行起始日期不可解析（应为「纪元-年-月-日」）：${line.fields[0] || '（空）'}`);
        if (!end) warnings.push(`T 行结束日期不可解析：${line.fields[1] || '（空）'}`);
    }

    for (const line of l.M) {
        const n = Number(line.fields[1]);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
            warnings.push(`M 行强度应为 0-100：${line.fields[1] || '（空）'}`);
        }
    }

    for (const line of l.CF) {
        const state = line.fields[1] ?? '';
        if (state && !(DISTILL_FORESHADOW_STATES as readonly string[]).includes(state)) {
            warnings.push(`CF 行状态应为「${DISTILL_FORESHADOW_STATES.join('/')}」：${state}`);
        }
    }

    return { errors, warnings: [...parsed.warnings, ...warnings] };
}

function parseDateField(text: string): boolean {
    // 只判断形态，真正的结构化解析交给 timeline-chain.parseStructuredDate
    const raw = String(text ?? '').trim();
    if (!raw) return false;
    return /^[^\s].*[-/._]\d{1,4}[-/._]\d{1,2}[-/._]\d{1,2}$/.test(raw) || /\d{1,4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?/.test(raw);
}

/**
 * 提取双向补写需求。
 *
 * 云笔的 16/17 项：本章蒸馏时回填上一章章尾悬念与下一章章首承接。
 * 本仓策略保守：**只产出待确认条目，不直接改相邻章文件**。
 *
 * @param parsed - 解析结果
 * @param chapterNum - 本章章号
 * @returns 待确认补写条目（含目标章号与字段）
 * @example
 * collectBackfillItems(parsed, 5) // [{ targetChapter: 4, field: '章尾悬念', text: '…' }]
 */
export function collectBackfillItems(
    parsed: DistillParseResult,
    chapterNum: number,
): Array<{ targetChapter: number; field: string; text: string; source: 'PH' | 'OP' }> {
    const out: Array<{ targetChapter: number; field: string; text: string; source: 'PH' | 'OP' }> = [];
    for (const line of parsed.lines.PH) {
        const text = (line.fields[0] ?? '').trim();
        if (text) out.push({ targetChapter: chapterNum - 1, field: '章尾悬念', text, source: 'PH' });
    }
    for (const line of parsed.lines.OP) {
        const text = (line.fields[0] ?? '').trim();
        if (text) out.push({ targetChapter: chapterNum + 1, field: '章首承接', text, source: 'OP' });
    }
    return out;
}

/**
 * 渲染「蒸馏回流待确认」清单（Markdown）。
 *
 * 与 `renderProtocolChecklist` 同策略：只列待确认项，不直写数据表。
 *
 * @param parsed - 解析结果
 * @param validation - 校验结果
 * @param chapterName - 章节名
 * @param extraNotes - 额外说明（如时间轴链式校验结论）
 * @returns Markdown 文本
 * @example
 * renderDistillChecklist(parsed, validation, '第5章')
 */
export function renderDistillChecklist(
    parsed: DistillParseResult,
    validation: DistillValidationResult,
    chapterName: string,
    extraNotes: string[] = [],
): string {
    const l = parsed.lines;
    const section = (title: string, rows: string[]): string[] => (rows.length === 0 ? [] : ['', `### ${title}`, '', ...rows]);

    const out: string[] = [
        `# ${chapterName} 蒸馏回流待确认`,
        '',
        '> 由蒸馏回流契约（shared/distill-contract.ts）从正文末尾的蒸馏行解析生成。',
        '> **本文件只是待确认清单**：相邻章补写与数据表更新需人工核对后再执行。',
    ];

    if (validation.errors.length > 0) {
        out.push('', '## ⚠️ 硬错误（必须修正）', '', ...validation.errors.map((e) => `- ${e}`));
    }
    if (validation.warnings.length > 0) {
        out.push('', '## 告警（可回流，建议核对）', '', ...validation.warnings.map((w) => `- ${w}`));
    }
    if (extraNotes.length > 0) {
        out.push('', '## 校验结论', '', ...extraNotes.map((n) => `- ${n}`));
    }

    out.push(
        ...section('章节摘要（C）', l.C.map((x) => `- 标题：${x.fields[0]}\n  - 摘要：${x.fields[1]}\n  - 章尾悬念：${x.fields[2]}\n  - 章首承接：${x.fields[3]}\n  - 关键台词：${x.fields[4]}`)),
        ...section('事件线（EL）', l.EL.map((x) => `- ${x.fields[0]}（${(x.fields[0] ?? '').length} 字）`)),
        ...section('时间跨度（T）', l.T.map((x) => `- ${x.fields[0]} → ${x.fields[1]}（${x.fields[2] || '正常'}）`)),
        ...section('伏笔（CF）', l.CF.map((x) => `- ${x.fields[0]} · ${x.fields[1]}${x.fields[2] ? ` · ${x.fields[2]}` : ''}`)),
        ...section('情绪（M）', l.M.map((x) => `- ${x.fields[0]} · 强度 ${x.fields[1]} · ${x.fields[2]}`)),
        ...section('关键台词（K）', l.K.map((x) => `- ${x.fields[0]}：「${x.fields[1]}」`)),
        ...section('势力（G）', l.G.map((x) => `- ${x.fields[0]}${x.fields[1] ? ` · ${x.fields[1]}` : ''}`)),
        ...section('地点（L）', l.L.map((x) => `- ${x.fields[0]}${x.fields[1] ? ` · ${x.fields[1]}` : ''}`)),
        ...section('写作要点（W）', l.W.map((x) => `- ${x.fields[0]}`)),
    );

    const backfill = collectBackfillItems(parsed, parseChapterNum(chapterName));
    out.push(
        ...section(
            '双向补写待确认',
            backfill.map((b) => `- [ ] 第${b.targetChapter}章「${b.field}」← ${b.text}`),
        ),
    );

    return out.join('\n');
}

function parseChapterNum(chapterName: string): number {
    const m = String(chapterName ?? '').match(/第\s*(\d+)\s*章/);
    return m ? Number(m[1]) : 0;
}
