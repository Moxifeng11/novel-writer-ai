/**
 * step-validator.ts — 步骤完整性结构化校验
 *
 * v6.0: 替代字节数模糊匹配，基于内容结构判断步骤是否完整。
 * 每个步骤对应一个校验函数，返回四级状态。
 *
 * 四级状态：
 *   empty     — 空/无内容
 *   skeleton  — 只有模板骨架，未实际生成
 *   partial   — 有部分内容，但缺少必填模块（进行中）
 *   complete  — 所有必填模块齐全（已走完）
 */

import { validateEmotionPlan } from './emotion-planner';
import { validateSceneExpansion } from './scene-expander';

/**
 * 对话描写引号集合：中文弯引号“”/单引号‘’/直角引号「」『』/ASCII 双引号。
 * 实测缺陷：写作规范产出中文弯引号，旧正则只认 ASCII " 与「」，
 * 含 18 对对话的正文被判「缺少 对话描写」，一键成文在正文步直接中断。
 */
const DIALOGUE_QUOTE_CLASS = '[“”‘’「」『』"]';
const DIALOGUE_PATTERN = new RegExp(`${DIALOGUE_QUOTE_CLASS}.+${DIALOGUE_QUOTE_CLASS}`);
const DIALOGUE_TEST = new RegExp(DIALOGUE_QUOTE_CLASS);

/**
 * 步骤层级结构定义。
 */
export type StepLevel = 'empty' | 'skeleton' | 'partial' | 'complete';

/**
 * StepValidationResult 类型定义。
 */
export type StepValidationResult = {
    valid: boolean;       // 是否达到"走完"标准（= complete）
    missing: string[];    // 缺失的必填模块
    score: number;        // 完整度 0-100
    level: StepLevel;
};

type StepValidator = (content: string) => StepValidationResult;

// ============================================================
// v6.1: 内容实质校验工具函数
// ============================================================

/**
 * 规范化步骤内容的 Markdown 标记，供结构校验使用。
 *
 * AI 输出常用 `**标签**：` 或 `**标签**：内容` 的形式，而校验器按 `## 标签` 分节匹配。
 * 这里只做两件事：
 *   1. 去掉行内 `**粗体**` / `__粗体__` 标记；
 *   2. 把「独占一行的标签：」升级为二级标题，便于统一走分节内容校验。
 * 不修改落盘内容，仅影响校验结果。
 * @param content - 内容
 * @returns 文本结果
 */
export function normalizeStepMarkup(content: string): string {
    if (!content) return '';
    const out: string[] = [];
    for (const raw of content.split('\n')) {
        let line = raw
            .replace(/\*\*([^*\n]+)\*\*/g, '$1')
            .replace(/__([^_\n]+)__/g, '$1');
        // 已有标题：去掉「一、」「1.」「第二节」这类编号前缀，避免校验器按「## 关键词」失配
        line = stripHeadingNumbering(line);
        // 只把「结构标签：」提升为标题。长句/带句读的行是正文导语（如「本章是……功能：」），
        // 而「逐项核对：」「问题：」这类短导语也不是章节标题——旧实现见冒号就升标题，
        // 会在父章节内部插出伪标题，把父章节内容截断（大纲/质控因此误判缺模块）。
        const label = line.match(/^([^\s#\-*][^*\n]{0,19})\s*[：:]\s*$/);
        if (label && !/[。！？，；、]/.test(label[1]) && isStructuralLabel(label[1])) {
            out.push(`## ${stripNumberingPrefix(label[1].trim())}`);
        } else {
            out.push(line);
        }
    }
    return out.join('\n');
}

/** 标题编号前缀：一、 / （一） / 1. / 1、 / 第一节 / 第一部分（不匹配「第1章」） */
const HEADING_NUMBER_PREFIX_RE =
    /^(?:[（(][一二三四五六七八九十百\d]+[）)]\s*|[（(]?[一二三四五六七八九十百]+[）)]?[、.．]\s*|\d+[、.．]\s*|第[一二三四五六七八九十百\d]+[节部分]\s*)/;

function stripNumberingPrefix(text: string): string {
    return text.replace(HEADING_NUMBER_PREFIX_RE, '');
}

/**
 * 结构标签白名单：只有这些「标签：」才允许升级为 ## 标题。
 * 校验器本身就是按这些模块名取内容的，白名单之外的冒号行一律视为正文。
 */
const STRUCTURAL_LABEL_KEYWORDS = [
    '全书定位', '关键场景', '结尾钩子', '钩子', '悬念',
    '章名', '核心冲突', '情感温度', '冲突强度', '熵预算', '自信息', '信息释放', '伏笔操作',
    '情节节点', '冲突升级', '信息密度', '场景节奏', '爽点',
    '欲望', '动机', '恐惧', '创伤', '软肋', '道德', '底线', '原则',
    '写作技法', 'AI自检', '技法检查', '连贯性', '设定冲突', '人物OOC',
    '质量评估', '质量控制', '大纲偏离', '修改建议', '改进建议', '建议汇总',
];

function isStructuralLabel(label: string): boolean {
    return STRUCTURAL_LABEL_KEYWORDS.some((keyword) => label.includes(keyword));
}

function stripHeadingNumbering(line: string): string {
    const heading = line.match(/^(#{1,6}\s*)(.*)$/);
    if (heading) return heading[1] + stripHeadingDecoration(heading[2]);
    return line;
}

/**
 * 去掉标题序号前缀与包裹符（`一、`/`【修改建议汇总】`/`（三）质量评估`）
 *
 * @param text - 文本内容
 * @returns 文本结果
 */
function stripHeadingDecoration(text: string): string {
    return stripNumberingPrefix(text)
        .replace(/^[\s【\[（(]+/, '')
        .replace(/[\s】\]）)]+$/, '')
        .trim();
}

/**
 * 提取指定标题（Markdown ## 或 ### 级）后的内容块，直到下一个同级或更高级标题。
 * 返回空字符串表示没找到标题或标题后无内容。
 * @param content - 内容
 * @param headingPattern - 标题匹配模式
 * @returns 文本结果
 */
function extractSectionAfterHeading(content: string, headingPattern: RegExp): string {
    const lines = content.split('\n');
    let startIdx = -1;
    let headingLevel = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (headingPattern.test(line)) {
            const m = line.match(/^(#{1,6})\s+/);
            headingLevel = m ? m[1].length : 2;
            startIdx = i + 1;
            break;
        }
    }

    if (startIdx < 0) return '';

    // 只到「同级或更高级」标题为止：旧实现 `^##[#]*\s+` 会把 ### 子标题也当成结束，
    // 导致 `## 写作技法检查` 紧跟 `### 1. …` 时整节内容被判定为空（25KB 质控报告被判空）。
    const stopRe = new RegExp(`^#{1,${headingLevel}}\\s+`);
    const sectionLines: string[] = [];
    for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i];
        if (stopRe.test(line.trim())) break;
        sectionLines.push(line);
    }

    return sectionLines.join('\n').trim();
}

/** 占位值：空标签之外，模板/骨架里常见的「未填写」写法 */
const PLACEHOLDER_VALUE_RE =
    /^(?:（可选）|\(可选\)|\[[^\]]*\]|>-|-{2,}|—|暂无|无|略|待补充|待定|未设置|未知|n\/a|\.{3,}|…+|[\u4e00-\u9fa5A-Za-z]+(?:\/[\u4e00-\u9fa5A-Za-z]+){2,})$/i;

/**
 * 值是否为占位（空 / 枚举提示 / >- / 暂无 等）
 *
 * @param value - 值
 * @returns 是否成功
 */
function isPlaceholderValue(value: string): boolean {
    const v = value.trim().replace(/^["'「」]|["'「」]$/g, '').trim();
    if (!v) return true;
    return PLACEHOLDER_VALUE_RE.test(v);
}

/** 模板说明行：整行含「[开端/发展/转折]」这类带斜杠的方括号枚举 */
const BRACKET_ENUM_RE = /\[[^\]\n]*\/[^\]\n]*\]/;

/**
 * 剔除模板骨架里的占位行，只保留有实际值的行。
 *
 * 模板骨架的特征不是「没内容」，而是「所有标签后面都空着」：
 *   - 节点1： / 负责推进： / 钩子内容：
 *   - | 1 | | | | | |
 *   - 钩子类型：悬念式/反转式/预告式/前置冲突
 *   - 本章处于全书 [开端/发展/转折/高潮/收尾] 阶段
 * 旧实现按字符数判定，这些标签与枚举本身就能凑够 20/30 字门槛，
 * 导致未生成的情节蒸馏/大纲摘要被判为 complete（Rev 185 修复）。
 * @param content - 内容
 * @returns 文本结果
 */
export function stripPlaceholderLines(content: string): string {
    if (!content) return '';
    const kept: string[] = [];
    for (const raw of content.split('\n')) {
        const line = raw.trimEnd();
        if (!line.trim()) continue;

        // 表格行：除序号列外全空 → 占位行
        if (/^\s*\|.*\|\s*$/.test(line)) {
            const cells = line.split('|').slice(1, -1).map((c) => c.trim());
            const meaningful = cells.filter((c, i) => i > 0 && c && !isPlaceholderValue(c));
            if (meaningful.length === 0) continue;
            kept.push(line);
            continue;
        }

        // 整行是方括号多选枚举（模板说明）→ 占位
        if (BRACKET_ENUM_RE.test(line)) continue;

        // 单独一行就是占位值（>-、待定、…）
        if (isPlaceholderValue(line.replace(/^\s*[-*]\s*/, ''))) continue;

        // 「标签：值」结构：值为空/占位 → 整行占位
        const kv = line.match(/^\s*[-*]?\s*([^：:\n]{1,24})[：:]\s*(.*)$/);
        if (kv && isPlaceholderValue(kv[2])) continue;

        kept.push(line);
    }
    return kept.join('\n');
}

/**
 * 判断文本是否有实质性内容：
 * - 先剔除模板占位行（空标签、空表格行、枚举提示）
 * - 去除空白后长度 >= minChars
 * - 不是纯占位符（待补充、待定、省略号等）
 * - 键值对格式时，值不能为空
 * @param text - 文本内容
 * @param minChars - 最小字符
 * @returns 是否成功
 */
function hasMeaningfulContent(text: string, minChars = 15): boolean {
    const clean = stripPlaceholderLines(text).replace(/\s+/g, '').trim();
    if (clean.length < minChars) return false;
    if (/^(待补充|待定|暂无|无|略|\.\.\.|…)+$/.test(clean)) return false;
    if (clean.replace(/[-*:：#\s|]/g, '').length < minChars * 0.3) return false;
    return true;
}

/**
 * 检查某个标题下是否有实质内容（组合版，一步到位）
 * @param content - 内容
 * @param headingPattern - 标题匹配模式
 * @param minChars - 最小字符
 * @returns 是否成功
 */
function sectionContentValid(content: string, headingPattern: RegExp, minChars = 20): boolean {
    const section = extractSectionAfterHeading(content, headingPattern);
    return hasMeaningfulContent(section, minChars);
}

/**
 * 构造校验结果
 * @param found 已满足的必填项数量
 * @param total 必填项总数
 * @param missing 缺失的必填项名称
 * @param extraBonus 额外加分（可选加分项）
  * @returns StepValidationResult 实例
 */
function makeResult(
    found: number,
    total: number,
    missing: string[],
    extraBonus = 0,
): StepValidationResult {
    const baseScore = total > 0 ? Math.round((found / total) * 70) : 0;
    // 必填项一个都没命中时不计算加分，确保空内容仍是 empty
    const score = found > 0 ? Math.min(100, baseScore + extraBonus) : 0;

    let level: StepLevel = 'empty';
    if (found === total && score >= 85) {
        level = 'complete';
    } else if (found > 0 || score >= 30) {
        level = 'partial';
    } else if (score > 0) {
        level = 'skeleton';
    }

    return {
        valid: level === 'complete',
        missing,
        score,
        level,
    };
}

// ============================================================
// 各步骤校验器
// ============================================================

/**
 * 信息规划校验
 * 必填：章名与核心冲突 / 情感温度+冲突强度 / 熵预算与自信息 / 伏笔操作
 * v6.1: 从标题存在校验升级为内容实质校验
 * @param content - 内容
  * @returns StepValidationResult 实例
 */
function validateInfoPlan(content: string): StepValidationResult {
    const required = [
        { key: '章名与核心冲突', check: () => sectionContentValid(content, /##\s*(章名与核心冲突|核心冲突)/, 20) || /核心冲突[：:].{10,}/.test(content) },
        { key: '情感温度', check: () => sectionContentValid(content, /##\s*(情感温度|情感与冲突量化)/, 15) || /情感温度[：:].{5,}/.test(content) },
        {
            key: '冲突强度',
            check: () =>
                /冲突强度[：:].{5,}/.test(content)
                || /冲突强度阶梯[：:].{5,}/.test(content)
                // AI 常用「冲突强度 4/5」「冲突强度：4 级」或把强度单独写成小节，
                // 旧实现只认「冲突强度：长文本」，会把这些合法输出误判为缺失。
                || /(?:冲突强度|冲突等级)[^\n]{0,24}?(?:[1-5１-５]\s*(?:级|\/\s*5|分)|(?:为|是|达到)\s*[1-5１-５])/.test(content)
                || sectionContentValid(content, /##\s*冲突强度/, 5),
        },
        { key: '熵预算与自信息', check: () => sectionContentValid(content, /##\s*(熵预算|熵预算与自信息|自信息)/, 20) || /(熵预算|自信息)[：:].{10,}/.test(content) || sectionContentValid(content, /##\s*信息释放计划/, 30) },
        { key: '伏笔操作', check: () => sectionContentValid(content, /##\s*伏笔操作/, 15) || /伏笔操作[^：:\n]{0,12}[：:].{5,}/.test(content) },
    ];

    const missing: string[] = [];
    let found = 0;
    for (const r of required) {
        if (r.check()) found++;
        else missing.push(r.key);
    }

    const sceneCount = (content.match(/第[一二三四五六七八九十\d]+[场景幕]|##\s+scene|场景\s*\d/gi) || []).length;
    // 5 个必填项齐全即视为已生成（基础 70 + 15），场景数量只作为加分
    const extra = 15 + (sceneCount >= 3 ? 15 : sceneCount * 5);

    return makeResult(found, required.length, missing, extra);
}

/**
 * 情节蒸馏校验
 * 与 PLOT_DISTILL_PROMPTS 的输出结构对齐：
 * 必填：情节节点规划 / 冲突升级路径 / 信息密度指标
 * 加分：场景节奏设计 / 爽点设计
 * @param content - 内容
  * @returns StepValidationResult 实例
 */
function validatePlotDistill(content: string): StepValidationResult {
    const required = [
        { key: '情节节点规划', check: () => sectionContentValid(content, /##\s*情节节点/, 30) },
        { key: '冲突升级路径', check: () => sectionContentValid(content, /##\s*冲突升级/, 20) },
        { key: '信息密度指标', check: () => sectionContentValid(content, /##\s*信息密度/, 10) },
    ];

    const missing: string[] = [];
    let found = 0;
    for (const r of required) {
        if (r.check()) found++;
        else missing.push(r.key);
    }

    const bonusSections = [
        /##\s*场景节奏设计/,
        /##\s*爽点设计/,
    ].filter(p => sectionContentValid(content, p, 10)).length;
    // 3 个必填项齐全即达到「已生成」标准（基础 70 + 15），加分项再提高完整度评分
    const extra = 15 + bonusSections * 10;

    return makeResult(found, required.length, missing, extra);
}

/**
 * 大纲摘要校验
 * 必填：全书定位 / 至少3个场景 / 结尾钩子
 * v6.1: 从标题存在校验升级为内容实质校验
 * @param content - 内容
  * @returns StepValidationResult 实例
 */
function validateOutline(content: string): StepValidationResult {
    const required = [
        { key: '全书定位', check: () => sectionContentValid(content, /##\s*全书定位/, 20) || /全书定位[：:].{15,}/.test(content) },
        { key: '关键场景', check: () => sectionContentValid(content, /##\s*(关键场景|场景)/, 30) || /(关键场景|场景列表)[^：:\n]{0,10}[：:].{20,}/.test(content) },
        { key: '结尾钩子', check: () => sectionContentValid(content, /##\s*(钩子|结尾(钩子)?|悬念|反转|结尾悬念)/, 15) || /(结尾钩子|悬念|反转)[：:].{10,}/.test(content) },
    ];

    const missing: string[] = [];
    let found = 0;
    for (const r of required) {
        if (r.check()) found++;
        else missing.push(r.key);
    }

    // 关键场景常以 Markdown 表格呈现（| 1 | 场景 | ...），不能只依赖「场景N」字样
    const sceneRows = (content.match(/^\|\s*\d+\s*\|/gm) || []).length;
    const hasLocations = /地点|场景.+地点/.test(content);
    const hasChars = /人物|出场人物|角色/.test(content);
    const extra = 15 + (sceneRows >= 3 ? 5 : 0) + (hasLocations ? 5 : 0) + (hasChars ? 5 : 0);

    return makeResult(found, required.length, missing, extra);
}

/**
 * 角色灵魂校验
 * 输出格式为按角色分块：「【角色名】」后跟 9 个字段行（欲望：… / 恐惧：… / 底线：…）。
 *
 * Rev 185：旧实现只对整篇做 `(欲望|恐惧|底线)[：:]\s*\S{2,}` 匹配，
 * 「欲望：>-」这类空占位也能通过，且不区分角色块；注释里写的「至少1个配角核心」并未实现。
 * 现改为按块解析：每个块要求三项均为实质值（非占位、去掉标点后 >= 6 字），
 * 至少一个块三项齐全才可能 complete，missing 直接点名缺哪一项。
 */
const SOUL_BLOCK_RE = /^【([^】\n]{1,30})】\s*$/gm;

/** 灵魂字段标签（与 formatSoulForPrompt / 模板标题兼容） */
const SOUL_FIELD_LABELS: Record<string, string[]> = {
    desire: ['欲望', '核心欲望', '核心动机', '核心驱动力', '深层渴望', '表层目标'],
    fear: ['恐惧', '恐惧与创伤', '最怕失去', '创伤', '软肋', '心理阴影'],
    boundary: ['底线', '道德', '道德边界', '原则', '行为准则', '绝不'],
};

interface SoulBlock {
    name: string;
    body: string;
}

function parseSoulBlocks(content: string): SoulBlock[] {
    const matches = Array.from(content.matchAll(SOUL_BLOCK_RE));
    return matches.map((m, i) => {
        const start = (m.index || 0) + m[0].length;
        const end = i + 1 < matches.length ? (matches[i + 1].index || content.length) : content.length;
        return { name: m[1].trim(), body: content.slice(start, end) };
    });
}

/** 紧凑注入格式的字段前缀（buildCharacterSoulSummary：欲>… | 惧>… | 底>…） */
const SOUL_COMPACT_LABELS: Record<string, string> = {
    desire: '欲',
    fear: '惧',
    boundary: '底',
};

/**
 * 取块内某字段的值：优先「标签：值」同行，其次紧凑「欲>值」，最后「## 标签」下的第一行
 *
 * @param body - 正文
 * @param labels - 标签列表
 * @param compactLabel - 精简标签
 * @returns 文本结果
 */
function readSoulField(body: string, labels: string[], compactLabel?: string): string {
    if (compactLabel) {
        const compact = body.match(new RegExp(`(?:^|[|】])\\s*${compactLabel}>\\s*([^|\\n]+)`));
        if (compact && isEffectiveSoulValue(compact[1].trim())) return compact[1].trim();
    }
    for (const label of labels) {
        const inline = body.match(new RegExp(`^\\s*[-*]?\\s*${label}\\s*[：:]\\s*(.+)$`, 'm'));
        if (inline && !isPlaceholderValue(inline[1])) return inline[1].trim();
        const section = extractSectionAfterHeading(body, new RegExp(`^#{1,6}\\s*${label}`));
        const firstLine = section.split('\n').map((l) => l.replace(/^\s*[-*]\s*/, '').trim()).find((l) => l && !isPlaceholderValue(l));
        if (firstLine) return firstLine;
    }
    return '';
}

/**
 * 灵魂字段是否实质有效：非占位，且去掉标点后 >= 4 个字符（防「>-」「暂无」「无」）
 *
 * @param value - 值
 * @returns 是否成功
 */
function isEffectiveSoulValue(value: string): boolean {
    if (!value || isPlaceholderValue(value)) return false;
    const pure = value.replace(/[\s，。、“”‘’！？；：、,.!?;:"'()（）\-—…]/g, '');
    return pure.length >= 4;
}

function validateCharacterSoul(content: string): StepValidationResult {
    const blocks = parseSoulBlocks(content);

    if (blocks.length > 0) {
        const checks = [
            { key: '主角欲望/动机', field: 'desire' },
            { key: '主角恐惧/创伤', field: 'fear' },
            { key: '主角道德边界', field: 'boundary' },
        ];
        const foundFlags = checks.map((c) => ({
            key: c.key,
            ok: blocks.some((b) => isEffectiveSoulValue(readSoulField(b.body, SOUL_FIELD_LABELS[c.field], SOUL_COMPACT_LABELS[c.field]))),
        }));
        const found = foundFlags.filter((f) => f.ok).length;
        const missing = foundFlags.filter((f) => !f.ok).map((f) => f.key);

        const completeBlocks = blocks.filter((b) =>
            checks.every((c) => isEffectiveSoulValue(readSoulField(b.body, SOUL_FIELD_LABELS[c.field], SOUL_COMPACT_LABELS[c.field]))),
        ).length;
        // 至少一个角色三项齐全（基础 70 + 15），多角色与完整块仅作为完整度加分
        const extra = 15 + (blocks.length >= 2 ? 5 : 0) + (completeBlocks > 0 ? 5 : 0);
        return makeResult(found, checks.length, missing, extra);
    }

    // 无「【角色名】」块（手工整理/旧格式）：按行解析，同样过滤占位值
    const checks = [
        { key: '主角欲望/动机', field: 'desire' },
        { key: '主角恐惧/创伤', field: 'fear' },
        { key: '主角道德边界', field: 'boundary' },
    ];
    const foundFlags = checks.map((c) => ({
        key: c.key,
        ok: isEffectiveSoulValue(readSoulField(content, SOUL_FIELD_LABELS[c.field], SOUL_COMPACT_LABELS[c.field])),
    }));
    const found = foundFlags.filter((f) => f.ok).length;
    const missing = foundFlags.filter((f) => !f.ok).map((f) => f.key);

    return makeResult(found, checks.length, missing, 15);
}

/**
 * 情绪规划校验（复用引擎层校验）
 * @param content - 内容
  * @returns StepValidationResult 实例
 */
function validateEmotionPlanWrapper(content: string): StepValidationResult {
    const result = validateEmotionPlan(content);
    if (result.valid) {
        return { valid: true, missing: [], score: 92, level: 'complete' };
    }

    const sceneCount = (content.match(/^#{2,6}\s*(?:scene|场景)\s*\d+\s*[：:]/gim) || []).length;
    const hasOverall = /总体情绪曲线|开篇情绪/.test(content);
    const found = (hasOverall ? 1 : 0) + Math.min(sceneCount, 2);
    const total = 3;

    return makeResult(found, total, result.errors);
}

/**
 * Scene展开校验（复用引擎层校验）
 * @param content - 内容
  * @returns StepValidationResult 实例
 */
function validateSceneExpandWrapper(content: string): StepValidationResult {
    const result = validateSceneExpansion(content);
    if (result.valid) {
        return { valid: true, missing: [], score: 92, level: 'complete' };
    }

    const sceneCount = (content.match(/^#{2,6}\s*scene\s*\d+\s*[：:]/gim) || []).length;
    const total = 3;
    const found = Math.min(sceneCount, total);

    return makeResult(found, total, result.errors);
}

/**
 * 正文生成校验
 * 必填：字数达标（>=70%目标）/ 有开头 / 有对话 / 有结尾
 * 
 * @deprecated bodyGeneration 步骤已废弃，推荐使用句级协同写作（CoWriterEngine）。
 *             此校验函数保留用于兼容旧数据和句级写作完成后的正文完整性检查。
 *             两条路径共享同一正文文件格式，校验规则一致。
 * @param content - 内容
 * @param minWords - 最小词表
  * @returns StepValidationResult 实例
 */
function validateBodyGeneration(content: string, minWords = 2100): StepValidationResult {
    const pureText = content.replace(/^---[\s\S]*?---/, '').trim();
    const wordCount = pureText.length;

    const required = [
        { key: '字数达标', pattern: wordCount >= minWords ? /./ : /^$/, desc: `${wordCount}/${minWords}字` },
        { key: '章节开头', pattern: /^#|^第.+章|^\s*第.+节/ },
        // 实测缺陷：写作规范输出中文弯引号“”，旧正则只认 ASCII " 与「」，
        // 于是含 18 对对话的正文被判「缺少 对话描写」，一键成文中断在本步。
        { key: '对话描写', pattern: DIALOGUE_PATTERN },
        { key: '完整结尾', pattern: /。\s*$|…\s*$|！\s*$|？\s*$/ },
    ];

    const missing: string[] = [];
    let found = 0;
    for (const r of required) {
        if (r.pattern.test(pureText)) found++;
        else missing.push(r.key);
    }

    const wordRatio = Math.min(1, wordCount / minWords);
    const score = Math.round(wordRatio * 50) + Math.round((found / required.length) * 40) + 5;

    let level: StepLevel = 'empty';
    if (found === required.length && wordCount >= minWords) {
        level = 'complete';
    } else if (wordCount > 500 || found >= 2) {
        level = 'partial';
    } else if (wordCount > 0) {
        level = 'skeleton';
    }

    return {
        valid: level === 'complete',
        missing,
        score: Math.min(100, score),
        level,
    };
}

/**
 * 审查类步骤校验（分析报告等）
 * 必填：问题列表（至少1个问题或明确无问题）/ 总结评价
 * @param content - 内容
  * @returns StepValidationResult 实例
 */
function validateAuditStep(content: string): StepValidationResult {
    const hasIssues = /问题|缺陷|不足|错误|❌|⚠️|需修正/.test(content);
    const hasNoIssueConfirm = /无问题|合格|通过|整体良好|未发现/.test(content);
    const hasConclusion = /总结|结论|评价|整体|建议|改进方向/.test(content);
    const hasDetail = /第.+节|场景\d|问题\s*\d|#/.test(content);

    const required = [
        { key: '问题分析', found: hasIssues || hasNoIssueConfirm },
        { key: '总结评价', found: hasConclusion },
        { key: '具体细节', found: hasDetail },
    ];

    const missing: string[] = [];
    let found = 0;
    for (const r of required) {
        if (r.found) found++;
        else missing.push(r.key);
    }

    return makeResult(found, required.length, missing, 15 + (hasIssues ? 5 : 0));
}

/**
 * v6.0: 三合一质量控制校验（写作技法检查 + 连贯性审查 + 质量评估）
 * 必填：三大板块标题 / 修改建议汇总 / 检查项结论
 * v6.1: 从标题存在校验升级为内容实质校验
 * @param content - 内容
  * @returns StepValidationResult 实例
 */
function validateQualityControlMerged(content: string): StepValidationResult {
    // v4.25：标题允许「## 【一、写作技法检查】」这类带全角括号+序号的装饰
    // （实测模型按提示词的【一、…】输出，旧正则判整节缺失 → QC 永远 partial）。
    const deco = '(?:\\s*(?:【[^】]*】|[一二三四五六七八九十]+、))?\\s*';
    // v4.26：QC 改为六块引导式复盘；旧三块名仍兼容（旧项目/自定义模板）
    const sections = [
        { key: '镜头一致性', check: () => sectionContentValid(content, new RegExp('##' + deco + '(镜头一致性|镜头|视角)'), 20) },
        { key: '承接与钩子', check: () => sectionContentValid(content, new RegExp('##' + deco + '(承接与钩子|承接|钩子)'), 20) },
        { key: '人物动机与变化', check: () => sectionContentValid(content, new RegExp('##' + deco + '(人物动机与变化|人物动机|人物OOC|写作技法)'), 20) },
        { key: '世界与设定观感', check: () => sectionContentValid(content, new RegExp('##' + deco + '(世界与设定观感|世界与设定|连贯性审查|连贯性)'), 20) },
        { key: '节奏与阅读冲动', check: () => sectionContentValid(content, new RegExp('##' + deco + '(节奏与阅读冲动|节奏|质量评估)'), 20) },
        { key: '语言质感', check: () => sectionContentValid(content, new RegExp('##' + deco + '(语言质感|语言|文笔)'), 20) },
    ];
    const hasSuggestions = /(修改建议|建议汇总|改进建议)[：:].{10,}/.test(content) || sectionContentValid(content, /##\s*(修改建议|改进建议)/, 20);
    const hasCheckmarks = /[✅❌⚠️]/.test(content) || /(通过|问题|待改进)[：:]/.test(content);

    // v4.26：新六块为准；旧三块（写作技法/连贯性/质量评估）齐全时按 legacy 通过，
    // 缺失项的 missing 文案沿用旧名，避免旧项目报出「镜头一致性」这类看不懂的键。
    const legacy = [
        { key: '写作技法检查', check: () => sectionContentValid(content, new RegExp('##' + deco + '(写作技法|AI自检|技法检查)'), 40) },
        { key: '连贯性审查', check: () => sectionContentValid(content, new RegExp('##' + deco + '(连贯性审查|连贯性|设定冲突|人物OOC)'), 40) },
        { key: '质量评估', check: () => sectionContentValid(content, new RegExp('##' + deco + '(质量评估|质量控制|大纲偏离|信息密度)'), 40) },
    ];
    const legacyFound = legacy.filter((s) => s.check()).length;

    let found = 0;
    const missing: string[] = [];
    if (legacyFound === legacy.length) {
        found = legacy.length;
    } else {
        for (const s of sections) {
            if (s.check()) found++;
            else missing.push(s.key);
        }
        if (legacyFound > 0) {
            for (const s of legacy) {
                if (!s.check() && !missing.includes(s.key)) missing.push(s.key);
            }
        }
    }

    const extra = (hasSuggestions ? 10 : 0) + (hasCheckmarks ? 10 : 0);
    const result = makeResult(found, legacyFound === legacy.length ? legacy.length : sections.length, missing, extra);
    // 三项必填模块齐全即视为完成：✅/建议 只是加分项，不应让「在、但没写建议」的
    // 完整质控永远卡在 partial（实测：7013 字质控因缺一个【修改建议汇总】被判不完整，
    // 且 missing 为空、用户看不到原因）。
    if (missing.length === 0 && (found === sections.length || legacyFound === legacy.length)) {
        return { valid: true, missing: [], score: Math.max(85, result.score), level: 'complete' };
    }
    return result;
}

/**
 * 修正类步骤校验（fix / finalFix）
 * 必填：字数达标 / 有对话 / 结构完整
 * @param content - 内容
  * @returns StepValidationResult 实例
 */
function validateFixStep(content: string): StepValidationResult {
    const pureText = content.replace(/^---[\s\S]*?---/, '').trim();
    const wordCount = pureText.length;

    const required = [
        { key: '字数达标（>=2000）', check: () => wordCount >= 2000 },
        { key: '对话描写', check: () => DIALOGUE_TEST.test(pureText) },
        { key: '叙事完整', check: () => /。/.test(pureText) && pureText.length > 500 },
    ];

    const missing: string[] = [];
    let found = 0;
    for (const r of required) {
        if (r.check()) found++;
        else missing.push(r.key);
    }

    const score = Math.min(100, Math.round((wordCount / 3000) * 60) + (found / required.length) * 35);

    let level: StepLevel = 'empty';
    if (found === required.length) {
        level = 'complete';
    } else if (wordCount > 500 || found >= 1) {
        level = 'partial';
    } else if (wordCount > 0) {
        level = 'skeleton';
    }

    return { valid: level === 'complete', missing, score, level };
}

// ============================================================
// 校验器注册表
// ============================================================

// v6.0: selfCheck / continuityCheck 已合并入 qualityControl，不再作为独立步骤
const STEP_VALIDATORS: Record<string, StepValidator> = {
    infoPlan: validateInfoPlan,
    plotDistill: validatePlotDistill,
    outline: validateOutline,
    characterSoul: validateCharacterSoul,
    emotionPlan: validateEmotionPlanWrapper,
    sceneExpand: validateSceneExpandWrapper,
    bodyGeneration: (c) => validateBodyGeneration(c, 2100),
    fix: validateFixStep,
    finalFix: validateFixStep,
    qualityControl: validateQualityControlMerged,
    analysisReport: validateAuditStep,
};

/**
 * 校验步骤内容完整性
 * @param stepKey 步骤 key
 * @param content 步骤内容（纯正文，不含 frontmatter）
  * @returns StepValidationResult 实例
 */
export function validateStepResult(stepKey: string, content: string): StepValidationResult {
    const validator = STEP_VALIDATORS[stepKey];
    if (!validator) {
        const len = content.trim().length;
        if (len > 500) {
            return { valid: true, missing: [], score: 80, level: 'complete' };
        }
        if (len > 100) {
            return { valid: false, missing: ['内容不足'], score: 40, level: 'partial' };
        }
        if (len > 0) {
            return { valid: false, missing: ['内容过短'], score: 15, level: 'skeleton' };
        }
        return { valid: false, missing: ['无内容'], score: 0, level: 'empty' };
    }
    // 规划/审查类步骤：先规范化 Markdown 标记，避免 `**标签**：` 与 `### sceneN:` 被误判缺失
    const normalized = STRUCTURAL_STEPS.has(stepKey) ? normalizeStepMarkup(content) : content;
    return validator(normalized);
}

/** 需要做 Markdown 结构规范化的步骤（正文类步骤不做，避免影响字数/引号判定） */
const STRUCTURAL_STEPS = new Set([
    'infoPlan', 'plotDistill', 'outline', 'characterSoul',
    'emotionPlan', 'sceneExpand', 'qualityControl', 'analysisReport',
]);

/**
 * 判断是否为模板骨架（未实际生成内容）
 *
 * Rev 185：除 `${}` / 待定标记外，骨架还包括「所有标签后都空着」的模板
 * （情节蒸馏、大纲摘要的模板没有变量占位符，旧实现直接放过）。
 * 这里先剔除占位行与 Markdown 标题，再按有效正文长度判断。
 * @param content - 内容
 * @param stepKey - 步骤键
 * @returns 是否成功
 */
export function isTemplateSkeleton(content: string, stepKey?: string): boolean {
    if (!content || content.trim().length < 30) return true;
    if (content.includes('（待 auto_writer') || content.includes('（待定）')) return true;
    // 未替换的模板变量（如 ${chapNum}）说明仍是模板文件，不是生成结果
    if (/\$\{\w+\}/.test(content)) return true;
    const effective = stripPlaceholderLines(content)
        .split('\n')
        .filter((line) => !/^\s*#{1,6}\s/.test(line))
        .join('\n')
        .trim();
    if (effective.length < 30) return true;
    if (stepKey === 'outline' && effective.length < 80) return true;
    return false;
}

/**
 * A4: 步骤结果是否真正完成（供断点续跑/恢复等「文件是否存在」场景使用）。
 * 文件非空不代表完成：模板骨架必须排除，其余交给结构校验。
 * @param stepKey - 步骤键
 * @param content - 内容
 * @returns 是否成功
 */
export function isStepResultComplete(stepKey: string, content: string): boolean {
    const pure = (content || '').replace(/^---[\s\S]*?\n---\n?/, '').trim();
    return !isTemplateSkeleton(pure, stepKey) && validateStepResult(stepKey, pure).valid;
}
