/**
 * 模板字段级校验器
 * 
 * 对 AI 生成的文件输出进行程序化字段级校验，
 * 确保输出与元文件模板一致。
 */
import {
    WV_SECTIONS,
    WV_SECTION_FIELDS,
    WV_PROSE_MAX_LENGTH,
    FF_FRONTMATTER_KEYS,
    FF_CORE_KEYS,
    FF_RULE_KEYS,
    FF_CANON_TIMELINE_COLS,
    FF_FAN_TIMELINE_COLS,
    OUTLINE_REQUIRED_KEYS,
    OUTLINE_TABLE_HEADER,
    ENTITY_BODY_SECTIONS,
    CHARACTER_MANDATORY_FIELDS,
    CHARACTER_BODY_SECTIONS,
    CHARACTER_SOUL_FIELDS,
    CHARACTER_BODY_SECTIONS_V2,
    CHARACTER_NESTED_FIELD_GROUPS,
    ENTITY_SHORT_TITLE_ALIASES,
    CHARACTER_SHORT_TITLE_ALIASES,
    FACTION_FRONTMATTER_KEYS,
    FACTION_REQUIRED_VALUE_KEYS,
    LOCATION_FRONTMATTER_KEYS,
    LOCATION_REQUIRED_VALUE_KEYS,
    ITEM_FRONTMATTER_KEYS,
    ITEM_REQUIRED_VALUE_KEYS,
    SL_SECTIONS,
} from './format-constants';
// 同人设定路径解析唯一入口，避免校验侧与读取侧的正则漂移（如 CRLF）
import { extractFanficRuleValue, parseFanficTimeline, parseFanficTimelineRows, parseProjectMeta } from './fanfic-rules';

// === YAML 字段校验辅助 ===
// 修正版：支持单行值 + YAML 多行块标量(>) + 多行文字块(|)

const PLACEHOLDER_VALUES = new Set([
    '待补充', '待填写', '待生成', '待定', '未知', '无', '暂无',
    'none', 'null', 'n/a', 'na', 'tbd', 'todo',
    '（无）', '(无)', '（待补充）', '(待补充)', '...', '…', '—', '-',
]);

function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 判断一个 YAML/正文值是否是「实质内容」。
 * 严格模式：空字符串、引号空串、纯占位词、纯符号都视为未填写。
 * 这是完整性校验的核心——此前 `姓名: ""` 会被当成已填写。
 * @param raw - 原始
 * @returns 是否成功
 */
export function isMeaningfulValue(raw: string | undefined | null): boolean {
    if (raw == null) return false;
    let value = String(raw).trim();
    if (!value) return false;
    // 去掉行尾 YAML 注释
    value = value.replace(/\s+#.*$/, '').trim();
    if (!value) return false;
    // 去掉外层引号
    const quoted = value.match(/^(["'])([\s\S]*)\1$/);
    if (quoted) value = quoted[2].trim();
    if (!value) return false;
    if (PLACEHOLDER_VALUES.has(value.toLowerCase()) || PLACEHOLDER_VALUES.has(value)) return false;
    if (/^[—\-_.。·…\s]+$/.test(value)) return false;
    return true;
}

/**
 * 读取某个顶层 YAML 字段的原始值（支持块标量）
 *
 * @param yamlContent - YAML内容
 * @param field - 字段
  * @returns 文本结果 或 undefined
 */
function readYamlFieldValue(yamlContent: string, field: string): string | undefined {
    const re = new RegExp(`^${escapeRegex(field)}\\s*:\\s*(.*)$`, 'm');
    const match = re.exec(yamlContent);
    if (!match) return undefined;

    const inline = match[1].trim();
    if (inline.startsWith('>') || inline.startsWith('|')) {
        const startIndex = (match.index ?? 0) + match[0].length;
        const lines = yamlContent.slice(startIndex).split('\n');
        const block: string[] = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) {
                if (block.length > 0) block.push('');
                continue;
            }
            if (!/^\s+/.test(line)) break;
            block.push(line.trim());
        }
        return block.join(' ').trim();
    }
    return inline;
}

function yamlFieldHasValue(yamlContent: string, field: string): boolean {
    return isMeaningfulValue(readYamlFieldValue(yamlContent, field));
}

/**
 * 字段键是否存在（允许空值，用于 entity_status 等系统字段）
 *
 * @param yamlContent - YAML内容
 * @param field - 字段
 * @returns 是否成功
 */
function yamlFieldExists(yamlContent: string, field: string): boolean {
    return readYamlFieldValue(yamlContent, field) !== undefined;
}

/**
 * 读取嵌套组（如 character_core:）下的子字段值
 *
 * @param yamlContent - YAML内容
 * @param parent - 父级
 * @param child - 子节点
 * @returns 是否成功
 */
function yamlNestedFieldHasValue(yamlContent: string, parent: string, child: string): boolean {
    const parentRe = new RegExp(`^${escapeRegex(parent)}\\s*:\\s*$`, 'm');
    const parentMatch = parentRe.exec(yamlContent);
    if (!parentMatch) return false;

    const rest = yamlContent.slice((parentMatch.index ?? 0) + parentMatch[0].length);
    const lines = rest.split('\n');
    const childRe = new RegExp(`^\\s+${escapeRegex(child)}\\s*:\\s*(.*)$`);
    for (const line of lines) {
        if (line.trim() && !/^\s+/.test(line)) break;
        const m = line.match(childRe);
        if (m) return isMeaningfulValue(m[1]);
    }
    return false;
}

function yamlNestedGroupExists(yamlContent: string, parent: string): boolean {
    return new RegExp(`^${escapeRegex(parent)}\\s*:\\s*$`, 'm').test(yamlContent);
}

// === 正文分节校验辅助 ===
// 修正版：大小写不敏感 + 空格宽松 + 内容非空

/**
 * 判断一段正文是否包含实质内容（排除「- 外貌：」这类空标签行）
 *
 * @param text - 文本内容
 * @returns 是否成功
 */
function textHasContent(text: string): boolean {
    return text.split('\n').some(raw => {
        let line = raw.trim();
        if (!line) return false;
        line = line.replace(/^[-*+>]\s*/, '').replace(/^\d+[.、]\s*/, '').trim();
        if (!line) return false;
        // 「标签：」或「[[链接]] :」但没有值
        if (/^[^：:]{1,30}[：:]\s*$/.test(line)) return false;
        if (/^\[\[[^\]]+\]\]\s*[：:]?\s*$/.test(line)) return false;
        return isMeaningfulValue(line);
    });
}

/**
 * 宽松查找分节正文：允许标题带序号前缀（如「## 一、叙事视角」）
 *
 * @param content - 内容
 * @param section - 分区
  * @returns 文本结果 或 null
 */
function findSectionBody(content: string, section: string): string | null {
    const re = new RegExp(
        // 注意：末尾必须用 (?![\\s\\S]) 表示「字符串结束」；若用 $（配合 m 标志）
        // 会把分节正文截断到标题行的行尾，导致多行内容与子节永远读不到。
        `^##[^\\n]*${escapeRegex(section)}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|^#\\s|(?![\\s\\S]))`,
        'im'
    );
    const match = content.match(re);
    return match ? match[1] : null;
}

/**
 * 分节不仅要有标题，标题下还必须有实质内容
 *
 * @param content - 内容
 * @param section - 分区
 * @returns 是否成功
 */
function bodySectionHasContent(content: string, section: string): boolean {
    const body = findSectionBody(content, section);
    return body !== null && textHasContent(body);
}

function bodySectionOrAliasHasContent(content: string, section: string, aliasesMap?: Record<string, string[]>): boolean {
    if (bodySectionHasContent(content, section)) return true;
    const map = aliasesMap ?? ENTITY_SHORT_TITLE_ALIASES;
    const aliasList = map[section];
    if (!aliasList) return false;
    return aliasList.some(alias => bodySectionHasContent(content, alias));
}

/**
 * 校验结果。
 */
export interface ValidationResult {
    valid: boolean;
    missingFields: string[];
    errorType?: string;
}

/**
 * 时间线表格行。
 */
export interface TimelineRow {
    [key: string]: string;
}

/**
 * 同人规则。
 */
export interface FanficRules {
    mustFollow: string[];
    adaptScope: string;
    redlines: string[];
}

/**
 * 时间线策略。
 */
export interface TimelineStrategy {
    strategy: 'fanfic' | 'original';
    timelines: string[];
    rules: boolean;
    fanficSettingsPath?: string;
}

// ============================================================
// 同人设定校验
// ============================================================

/**
 * 同人设定的「未填写」判定。
 *
 * 生成骨架与 AI 提示词都要求未确定内容写「待补充」；这些值只要能通过校验，
 * 用户就会看到「✅ 已保存并绑定」，而 prompt 侧 `parseFanficRules` 会把它们全部丢弃，
 * 实际是零同人约束。与 `isMeaningfulValue` 的区别：这里保留「未知 / 无」为合法值
 * （作者未知、没有额外红线都是用户可以明确表达的内容）。
 */
const FANFIC_EMPTY_VALUES = new Set([
    '待补充', '待填写', '（待补充）', '(待补充)', '（待填写）', '(待填写)', '...', '…', '—', '-',
]);

/**
 * 判断同人字段是否已填。
 *
 * @param raw - 原始值
 * @returns 布尔值
 */
export function isFanficValueFilled(raw: string | undefined | null): boolean {
    if (raw == null) return false;
    let value = String(raw).trim();
    // 去掉行尾 YAML 注释与成对引号：`作品名称: "（待补充）"` 同样是空占位
    value = value.replace(/\s+#.*$/, '').trim();
    const quoted = value.match(/^(["'])([\s\S]*)\1$/);
    if (quoted) value = quoted[2].trim();
    return value !== '' && !FANFIC_EMPTY_VALUES.has(value);
}

/**
 * 同人校验选项。
 */
export interface FanficValidationOptions {
    /**
     * 是否要求两张时间线各至少 1 行真实数据（默认 true）。
     *
     * 向导表单只收集 9 个字段、不收集时间线，步骤回读必须传 false：
     * 否则用户保存成功后重启插件，步骤会被自身骨架里的占位行判成未完成。
     */
    requireTimelineData?: boolean;
}

const FANFIC_TIMELINE_SECTIONS: Array<{ title: string; dataMissingLabel: string }> = [
    { title: '原作剧情时间线', dataMissingLabel: '原作剧情时间线(需要至少1行真实数据)' },
    { title: '故事背景时间线', dataMissingLabel: '故事背景时间线(需要至少1行真实数据)' },
];

/**
 * 校验同人设定。
 *
 * @param content - 内容
 * @param options - 配置项
 * @returns 校验结果
 */
export function validateFanficSettings(content: string, options: FanficValidationOptions = {}): ValidationResult {
    const requireTimelineData = options.requireTimelineData !== false;
    const missing: string[] = [];

    // Frontmatter
    for (const key of FF_FRONTMATTER_KEYS) {
        if (!isFanficValueFilled(readYamlFieldValue(content, key))) missing.push(`frontmatter.${key}`);
    }

    // Core settings + Rule fields：骨架里未填的字段写「（待补充）」，占位不是内容
    for (const key of [...FF_CORE_KEYS, ...FF_RULE_KEYS]) {
        const value = content.match(
            new RegExp(`^[ \\t]*-[ \\t]*\\*\\*${escapeRegex(key)}\\*\\*[：:][ \\t]*(.*)$`, 'm')
        )?.[1];
        if (!isFanficValueFilled(value)) missing.push(key);
    }

    // 时间线表格：结构必须存在；真实数据行的口径与 prompt 注入侧一致
    // （`parseFanficTimeline` 会丢弃表头、分隔行与整行占位）
    for (const { title, dataMissingLabel } of FANFIC_TIMELINE_SECTIONS) {
        const section = content.match(new RegExp(`## ${escapeRegex(title)}[\\s\\S]*?(?=\\n## |$)`));
        if (!section || !/^\|.*\|\s*$/m.test(section[0])) {
            missing.push(`${title}(表格)`);
            continue;
        }
        if (requireTimelineData && parseFanficTimeline(content, title).length === 0) {
            missing.push(dataMissingLabel);
        }
    }

    return { valid: missing.length === 0, missingFields: missing };
}

// ============================================================
// 世界观输出校验
// ============================================================
/**
 * 校验世界观输出。
 *
 * @param content - 内容
 * @returns 校验结果
 */
export function validateWorldviewOutput(content: string): ValidationResult {
    const missing: string[] = [];

    // Check all 9 sections exist
    const normalized = content.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ');
    for (const section of WV_SECTIONS) {
        if (!normalized.includes(`## ${section}`)) {
            missing.push(`模块: ${section}`);
        }
    }

    // Check each section's required fields
    for (const [section, fields] of Object.entries(WV_SECTION_FIELDS)) {
        if (fields.length === 0) continue;
        
        const sectionMatch = content.match(new RegExp(`## ${section}\\s*\\n([\\s\\S]*?)(?=\\n## |\\n---|$)`));
        if (!sectionMatch) continue;

        const sectionContent = sectionMatch[1];
        for (const field of fields) {
            const re = new RegExp(`- \\*\\*${field}\\*\\*[：:]`);
            if (!re.test(sectionContent)) {
                missing.push(`${section}.${field}`);
            }
        }
    }

    // Prose detection
    const proseResult = validateBulletFormat(content);
    if (!proseResult.valid) {
        missing.push(...proseResult.missingFields);
    }

    return { valid: missing.length === 0, missingFields: missing };
}

// ============================================================
// 分卷大纲输出校验
// ============================================================
/**
 * 校验大纲输出。
 *
 * @param content - 内容
 * @returns 校验结果
 */
export function validateOutlineOutput(content: string): ValidationResult {
    const missing: string[] = [];

    // Check each volume has the required fields
    const volumeMatches = content.matchAll(/###\s+(第\d+卷)[\s\S]*?(?=\n### |$)/g);
    let volumeCount = 0;

    for (const match of volumeMatches) {
        volumeCount++;
        const volContent = match[0];
        const volName = match[1];

        for (const key of OUTLINE_REQUIRED_KEYS) {
            const re = new RegExp(`- \\*\\*${key}\\*\\*[：:]`);
            if (!re.test(volContent)) {
                missing.push(`${volName}.${key}`);
            }
        }

        // Check chapter range format
        if (!/第\d+章\s*-\s*第\d+章/.test(volContent)) {
            missing.push(`${volName}.章节范围格式(需为"第X章 - 第Y章")`);
        }

        // Check chapter allocation table
        if (!volContent.includes(OUTLINE_TABLE_HEADER)) {
            missing.push(`${volName}.章节分配表(需为"| 章号 | 核心冲突 |")`);
        }
    }

    if (volumeCount === 0) {
        missing.push('未找到任何分卷(### 第N卷)');
    }

    return { valid: missing.length === 0, missingFields: missing };
}

// ============================================================
// 设定库输出校验
// ============================================================

/**
 * 校验设定库输出。
 *
 * @param content - 内容
 * @returns 校验结果
 */
export function validateSettingLibOutput(content: string): ValidationResult {
    const missingFields: string[] = [];
    if (!content.trim()) {
        return { valid: false, missingFields: ['内容为空'] };
    }

    for (const section of SL_SECTIONS) {
        if (!findSectionBody(content, section)) {
            missingFields.push(`模块: ${section}`);
            continue;
        }
        if (!bodySectionHasContent(content, section)) {
            missingFields.push(`模块内容为空: ${section}`);
        }
    }

    return { valid: missingFields.length === 0, missingFields };
}

// ============================================================
// 文笔风格输出校验
// ============================================================

/** 文笔风格必填的 9 个一级分节（与写作模态、内置预设保持一致） */
export const WRITING_STYLE_REQUIRED_SECTIONS = [
    '一、叙事视角',
    '二、文笔特征',
    '三、对话风格',
    '四、描写风格',
    '五、叙事节奏',
    '六、情感表达方式',
    '七、禁用/慎用',
    '八、参考作品',
    '九、番茄小说格式要求',
] as const;

const WRITING_STYLE_SUB_SECTIONS: Record<string, readonly string[]> = {
    '二、文笔特征': ['总体风格', '句式特征', '用语习惯'],
};

/**
 * 校验文笔风格输出。
 *
 * @param content - 内容
 * @returns 校验结果
 */
export function validateWritingStyleOutput(content: string): ValidationResult {
    const missingFields: string[] = [];
    if (!content.trim()) {
        return { valid: false, missingFields: ['内容为空'] };
    }

    for (const section of WRITING_STYLE_REQUIRED_SECTIONS) {
        const body = findSectionBody(content, section);
        if (body === null) {
            missingFields.push(`分节: ${section}`);
            continue;
        }
        // 子节结构（如「二、文笔特征」下的 ### 总体风格）
        const subSections = WRITING_STYLE_SUB_SECTIONS[section];
        if (subSections) {
            for (const sub of subSections) {
                const subRe = new RegExp(`^###[^\\n]*${escapeRegex(sub)}[^\\n]*\\n([\\s\\S]*?)(?=^###\\s|^##\\s|(?![\\s\\S]))`, 'im');
                const subMatch = body.match(subRe);
                if (!subMatch || !textHasContent(subMatch[1])) {
                    missingFields.push(`${section} → ${sub}`);
                }
            }
            continue;
        }
        if (!textHasContent(body)) {
            missingFields.push(`分节内容为空: ${section}`);
        }
    }

    return { valid: missingFields.length === 0, missingFields };
}

// ============================================================
// 通用要点格式检测
// ============================================================
/**
 * 校验要点格式。
 *
 * @param content - 内容
 * @returns 校验结果
 */
export function validateBulletFormat(content: string): ValidationResult {
    // Check for prose: continuous Chinese chars without newline
    const prosePattern = /[\u4e00-\u9fff]{200,}/;
    
    if (prosePattern.test(content)) {
        return {
            valid: false,
            missingFields: ['散文段落检测：发现连续200+中文字符无换行的大段叙述'],
            errorType: 'prose_detected',
        };
    }

    return { valid: true, missingFields: [] };
}

// ============================================================
// 时间线表格解析
// ============================================================
/**
 * 原始单元格 → 列名对象。
 * 单元格与列一一对应，空单元格保留为空串：旧实现先过滤空单元格再映射，
 * 中间某列为空时后续列整体左移，面板会把「章节参考」显示在「涉及人物」下。
 * @param rows - 行列表
 * @param columns - 列列表
 * @returns 结果数组
 */
function toTimelineRows(rows: string[][], columns: readonly string[]): TimelineRow[] {
    return rows.map((cells) => {
        const row: TimelineRow = {};
        columns.forEach((col, index) => { row[col] = cells[index] ?? ''; });
        return row;
    });
}

/**
 * 解析原作时间线表。
 *
 * @param content - 内容
 * @returns 行数组
 */
export function parseCanonTimelineTable(content: string): TimelineRow[] {
    // 与 prompt 注入共用 `parseFanficTimelineRows`：面板与 prompt 必须同口径
    return toTimelineRows(parseFanficTimelineRows(content, '原作剧情时间线'), FF_CANON_TIMELINE_COLS);
}

/**
 * 解析同人时间线表。
 *
 * @param content - 内容
 * @returns 行数组
 */
export function parseFanTimelineTable(content: string): TimelineRow[] {
    return toTimelineRows(parseFanficTimelineRows(content, '故事背景时间线'), FF_FAN_TIMELINE_COLS);
}

/**
 * 解析时间线看板表。
 *
 * @param content - 内容
 * @returns 行数组
 */
export function parseTimelineBoardTable(content: string): TimelineRow[] {
    const section = content.match(/##\s+纪元\s*\/\s*时间轴[\s\S]*$/);
    if (!section) return [];

    return parseMarkdownTable(section[0], ['#', '事件名称', '时间', '地点', '涉及人物', '章节', '类型']);
}

// ============================================================
// 同人/原创流程识别
// ============================================================
/**
 * 检测项目采用的时间线策略。
 *
 * @param projectDotFileContent - 项目文件内容
 * @returns 策略
 */
export function detectTimelineStrategy(projectDotFileContent: string): TimelineStrategy {
    // v31: `.project` 写入端统一写英文枚举值（original/fanfic），
    // 但旧逻辑只认中文「同人」，导致同人项目永远退化为 original，
    // 使得 context-manager 的同人时间线/OOC 规则加载全部失效。
    // 这里同时兼容英文 fanfic 与中文 同人，且兼容「## 类型\n值」换行式与「类型：值」行内式。
    const isFanfic = /##\s*类型\s*\r?\n\s*(?:fanfic|同人)/i.test(projectDotFileContent) ||
        /类型[：:]\s*(?:fanfic|同人)/i.test(projectDotFileContent);

    if (isFanfic) {
        return {
            strategy: 'fanfic',
            timelines: ['canon', 'fan', 'board'],
            rules: true,
            fanficSettingsPath: parseProjectMeta(projectDotFileContent).fanficPath || undefined,
        };
    }

    return {
        strategy: 'original',
        timelines: ['board'],
        rules: false,
    };
}

// ============================================================
// 内部工具函数
// ============================================================
function parseMarkdownTable(content: string, columns: string[]): TimelineRow[] {
    const lines = content.split('\n');
    const rows: TimelineRow[] = [];

    // Skip lines until we find the table header (must match first column)
    let headerFound = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (!headerFound) {
            if (line.startsWith('|') && line.includes(columns[0])) {
                headerFound = true;
            }
            continue;
        }

        // Skip separator line
        if (/^\|[\s\-|:]+$/.test(line)) continue;

        // Parse data row
        if (line.startsWith('|') && line.endsWith('|')) {
            // 只去掉首尾竖线，保留中间空单元格：过滤空单元格会让后续列整体左移
            const raw = line.split('|');
            if (raw.length > 0 && raw[0].trim() === '') raw.shift();
            if (raw.length > 0 && raw[raw.length - 1].trim() === '') raw.pop();
            const cells = raw.map((c) => c.trim());
            if (cells.length === 0) continue;

            const row: TimelineRow = {};
            for (let j = 0; j < Math.min(columns.length, cells.length); j++) {
                row[columns[j]] = cells[j];
            }
            rows.push(row);
            continue;
        }

        // Stop if we hit a new section or empty non-table line after data
        if (rows.length > 0 && (line.startsWith('##') || line.startsWith('#'))) break;
    }

    return rows;
}

// ============================================================
// 加载 fanfic 规则
// ============================================================
/**
 * 加载同人规则。
 *
 * @param content - 内容
 * @returns 规则
 */
export function loadFanficRules(content: string): FanficRules {
    // 与 prompt 侧 `parseFanficRules` 共用 `extractFanficRuleValue`：
    // 旧实现用单行正则 `.+`，用户把规则写成续行时面板会漏掉后半段，prompt 里却带着。
    const adaptScope = extractFanficRuleValue(content, '允许改编的范围').trim();

    return {
        mustFollow: splitFanficRules(extractFanficRuleValue(content, '必须遵守的原作规则')),
        adaptScope: isFanficValueFilled(adaptScope) ? adaptScope : '',
        redlines: splitFanficRules(extractFanficRuleValue(content, '禁止触及的红线')),
    };
}

/**
 * 同人规则按分号/换行拆条（面板按条展示），占位与空条目直接丢弃
 *
 * @param raw - 原始
 * @returns 结果数组
 */
function splitFanficRules(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw.split(/[；;\n]/).map(s => s.trim()).filter(isFanficValueFilled);
}

/**
 * 校验单个人物卡的 YAML frontmatter 字段是否完整 + 正文分节是否齐全
 * @param content - 内容
  * @returns ValidationResult 实例
 */
export function validateCharacterOutput(content: string): ValidationResult {
    const missingFields: string[] = [];

    // 1. YAML 闭合检查（兼容 AI 输出无闭合符的简化格式）
    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let yamlContent: string;
    if (yamlMatch) {
        yamlContent = yamlMatch[1];
    } else {
        // 回退：尝试匹配无闭合符的 YAML（AI 有时只输出开头的 ---，无尾部 ---）
        // 捕获后概念上补全 ---，再用 yamlContent 校验字段
        const openOnlyMatch = content.match(/^---\n([\s\S]*)/);
        if (!openOnlyMatch) {
            return { valid: false, missingFields: ['YAML frontmatter 未闭合'], errorType: 'PARSE_ERROR' };
        }
        yamlContent = openOnlyMatch[1];
    }

    // 2. 检查 YAML 字段（使用修正版 helper —— 支持多行值）
    for (const field of CHARACTER_MANDATORY_FIELDS) {
        if (!yamlFieldHasValue(yamlContent, field)) {
            missingFields.push(field);
        }
    }

    // tags 特殊检查：必须有 [人物]（宽容匹配 tags: [人物, 主角] 等）
    if (!/tags:\s*\[.*?人物.*?\]/.test(yamlContent) && !missingFields.includes('tags')) {
        missingFields.push('tags 缺失 [人物] 标签');
    }

    // 3. 检查嵌套必填组（character_core / 性格三层 / 角色弧光）
    for (const [parent, children] of Object.entries(CHARACTER_NESTED_FIELD_GROUPS)) {
        if (!yamlNestedGroupExists(yamlContent, parent)) {
            missingFields.push(`${parent}（YAML 嵌套组）`);
            continue;
        }
        for (const child of children) {
            if (!yamlNestedFieldHasValue(yamlContent, parent, child)) {
                missingFields.push(`${parent}.${child}`);
            }
        }
    }

    // 4. 检查正文分节（V2 字段 + 短标题别名回退），且分节必须有实际内容
    for (const section of CHARACTER_BODY_SECTIONS_V2) {
        if (!bodySectionOrAliasHasContent(content, section, CHARACTER_SHORT_TITLE_ALIASES)) {
            missingFields.push(`正文分节: ${section}`);
        }
    }

    return {
        valid: missingFields.length === 0,
        missingFields,
    };
}

/**
 * 校验势力卡格式
 * @param content - 内容
  * @returns ValidationResult 实例
 */
export function validateFactionOutput(content: string): ValidationResult {
    const missingFields: string[] = [];

    // YAML 闭合
    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!yamlMatch) {
        return { valid: false, missingFields: ['YAML frontmatter 未闭合'], errorType: 'PARSE_ERROR' };
    }
    const yamlContent = yamlMatch[1];

    // YAML 字段：键必须存在；内容字段必须有非空值
    const requiredValueKeys = new Set<string>([...FACTION_REQUIRED_VALUE_KEYS]);
    for (const field of FACTION_FRONTMATTER_KEYS) {
        if (!yamlFieldExists(yamlContent, field)) {
            missingFields.push(field);
            continue;
        }
        if (requiredValueKeys.has(field) && !yamlFieldHasValue(yamlContent, field)) {
            missingFields.push(`${field}（值为空）`);
        }
    }

    // tags 特殊检查（宽容匹配）
    if (!/tags:\s*\[.*?势力.*?\]/.test(yamlContent) && !missingFields.includes('tags')) {
        missingFields.push('tags 缺失 [势力] 标签');
    }

    // 正文分节必须存在且有实际内容
    for (const section of ENTITY_BODY_SECTIONS) {
        if (!bodySectionOrAliasHasContent(content, section)) {
            missingFields.push(`正文分节: ${section}`);
        }
    }

    return { valid: missingFields.length === 0, missingFields };
}

/**
 * 校验地点卡格式
 * @param content - 内容
  * @returns ValidationResult 实例
 */
export function validateLocationOutput(content: string): ValidationResult {
    const missingFields: string[] = [];

    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!yamlMatch) {
        return { valid: false, missingFields: ['YAML frontmatter 未闭合'], errorType: 'PARSE_ERROR' };
    }
    const yamlContent = yamlMatch[1];

    const requiredValueKeys = new Set<string>([...LOCATION_REQUIRED_VALUE_KEYS]);
    for (const field of LOCATION_FRONTMATTER_KEYS) {
        if (!yamlFieldExists(yamlContent, field)) {
            missingFields.push(field);
            continue;
        }
        if (requiredValueKeys.has(field) && !yamlFieldHasValue(yamlContent, field)) {
            missingFields.push(`${field}（值为空）`);
        }
    }

    if (!/tags:\s*\[.*?地点.*?\]/.test(yamlContent) && !missingFields.includes('tags')) {
        missingFields.push('tags 缺失 [地点] 标签');
    }

    for (const section of ENTITY_BODY_SECTIONS) {
        if (!bodySectionOrAliasHasContent(content, section)) {
            missingFields.push(`正文分节: ${section}`);
        }
    }

    return { valid: missingFields.length === 0, missingFields };
}

/**
 * 校验物品功法卡格式
 * @param content - 内容
  * @returns ValidationResult 实例
 */
export function validateItemOutput(content: string): ValidationResult {
    const missingFields: string[] = [];

    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!yamlMatch) {
        return { valid: false, missingFields: ['YAML frontmatter 未闭合'], errorType: 'PARSE_ERROR' };
    }
    const yamlContent = yamlMatch[1];

    const requiredValueKeys = new Set<string>([...ITEM_REQUIRED_VALUE_KEYS]);
    for (const field of ITEM_FRONTMATTER_KEYS) {
        if (!yamlFieldExists(yamlContent, field)) {
            missingFields.push(field);
            continue;
        }
        if (requiredValueKeys.has(field) && !yamlFieldHasValue(yamlContent, field)) {
            missingFields.push(`${field}（值为空）`);
        }
    }

    if (!/tags:\s*\[.*?物品功法.*?\]/.test(yamlContent) && !missingFields.includes('tags')) {
        missingFields.push('tags 缺失 [物品功法] 标签');
    }

    for (const section of ENTITY_BODY_SECTIONS) {
        if (!bodySectionOrAliasHasContent(content, section)) {
            missingFields.push(`正文分节: ${section}`);
        }
    }

    return { valid: missingFields.length === 0, missingFields };
}

/**
 * 批量解析人物卡输出，返回结构化数据 + 完整性校验结果
 * @param content - 内容
 * @returns 结果数组
 */
export function parseCharacterBlocks(content: string): ParsedCharacterBlock[] {
    const blocks = content.split(/^(?=---\s*$)/m).filter(b => b.trim());
    const results: ParsedCharacterBlock[] = [];

    for (const block of blocks) {
        const trimmed = block.trim();

        // YAML 闭合检查
        const yamlMatch = trimmed.match(/^---\n([\s\S]*?)\n---/);
        if (!yamlMatch) {
            results.push({
                name: '',
                yamlFields: {},
                bodySections: [],
                rawContent: trimmed,
                valid: false,
                missingFields: ['YAML frontmatter 未闭合'],
            });
            continue;
        }

        const yamlContent = yamlMatch[1];
        const yamlFields: Record<string, string> = {};
        
        // 提取所有 YAML 键值对
        const yamlKvRegex = /^(\S+?)\s*:\s*(.+)$/gm;
        let kvMatch: RegExpExecArray | null;
        while ((kvMatch = yamlKvRegex.exec(yamlContent)) !== null) {
            yamlFields[kvMatch[1]] = kvMatch[2].trim().replace(/^["']|["']$/g, '');
        }

        // 提取姓名
        let name = yamlFields['姓名'] || '';
        if (!name) {
            const titleMatch = trimmed.match(/^#\s+(.+?)\s*$/m);
            if (titleMatch) name = titleMatch[1].trim();
        }

        // 提取正文分节
        const bodySections: string[] = [];
        const sectionRegex = /^##\s+(.+)$/gm;
        let secMatch: RegExpExecArray | null;
        while ((secMatch = sectionRegex.exec(trimmed)) !== null) {
            bodySections.push(secMatch[1].trim());
        }

        // 校验
        const validation = validateCharacterOutput(trimmed);

        results.push({
            name,
            yamlFields,
            bodySections,
            rawContent: trimmed,
            valid: validation.valid,
            missingFields: validation.missingFields,
        });
    }

    return results;
}

/** 解析后的人物块 */
export interface ParsedCharacterBlock {
    name: string;
    yamlFields: Record<string, string>;
    bodySections: string[];
    rawContent: string;
    valid: boolean;
    missingFields: string[];
}


// ============================================================
// normalize 函数已迁至 ./validators/normalizers-entity.ts (P2-1 拆分)
// 通过 re-export 保持外部调用方零修改。
// ============================================================
export type { NormalizeResult } from './validators/normalizers-entity';
export {
    normalizeCharacterOutput,
    normalizeFactionOutput,
    normalizeLocationOutput,
    normalizeItemOutput,
} from './validators/normalizers-entity';
