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
    ENTITY_SHORT_TITLE_ALIASES,
    CHARACTER_SHORT_TITLE_ALIASES,
    FACTION_FRONTMATTER_KEYS,
    LOCATION_FRONTMATTER_KEYS,
    ITEM_FRONTMATTER_KEYS,
} from './format-constants';

// === YAML 字段校验辅助 ===
// 修正版：支持单行值 + YAML 多行块标量(>) + 多行文字块(|)

function yamlFieldHasValue(yamlContent: string, field: string): boolean {
    const escaped = field.replace(/[/]/g, '\\/');
    // 单行值：字段: 值（.+ 宽容匹配含空格和引号的值）
    if (new RegExp(`^${escaped}\\s*:\\s*.+`, 'm').test(yamlContent)) return true;
    // 块标量：字段: >
    if (new RegExp(`^${escaped}\\s*:\\s*>`, 'm').test(yamlContent)) return true;
    // 文字块：字段: |
    if (new RegExp(`^${escaped}\\s*:\\s*\\|`, 'm').test(yamlContent)) return true;
    return false;
}

// === 正文分节校验辅助 ===
// 修正版：大小写不敏感 + 空格宽松

function bodySectionExists(content: string, section: string): boolean {
    const escaped = section.replace(/[\/]/g, '\\/');
    return new RegExp(`##\\s*${escaped}`, 'i').test(content);
}

function bodySectionOrAliasExists(content: string, section: string, aliasesMap?: Record<string, string[]>): boolean {
    if (bodySectionExists(content, section)) return true;
    const map = aliasesMap ?? ENTITY_SHORT_TITLE_ALIASES;
    const aliasList = map[section];
    if (!aliasList) return false;
    return aliasList.some(alias => bodySectionExists(content, alias));
}

export interface ValidationResult {
    valid: boolean;
    missingFields: string[];
    errorType?: string;
}

export interface TimelineRow {
    [key: string]: string;
}

export interface FanficRules {
    mustFollow: string[];
    adaptScope: string;
    redlines: string[];
}

export interface TimelineStrategy {
    strategy: 'fanfic' | 'original';
    timelines: string[];
    rules: boolean;
    fanficSettingsPath?: string;
}

// ============================================================
// 同人设定校验
// ============================================================
export function validateFanficSettings(content: string): ValidationResult {
    const missing: string[] = [];

    // Frontmatter
    for (const key of FF_FRONTMATTER_KEYS) {
        const re = new RegExp(`${key}:\\s*(.+)`);
        if (!re.test(content)) missing.push(`frontmatter.${key}`);
    }

    // Core settings
    for (const key of FF_CORE_KEYS) {
        const re = new RegExp(`- \\*\\*${key}\\*\\*[：:]\\s*(.+)`);
        if (!re.test(content)) missing.push(key);
    }

    // Rule fields
    for (const key of FF_RULE_KEYS) {
        const re = new RegExp(`- \\*\\*${key}\\*\\*[：:]\\s*(.+)`);
        if (!re.test(content)) missing.push(key);
    }

    // Canon timeline table must have at least 1 data row
    const canonSection = content.match(/## 原作剧情时间线[\s\S]*?(?=\n## |$)/);
    if (!canonSection) {
        missing.push('原作剧情时间线(表格)');
    } else {
        const canonRows = canonSection[0].match(/^\|.+\|.+\|/gm);
        if (!canonRows || canonRows.length < 3) { // header + separator + at least 1 data
            missing.push('原作剧情时间线(需要至少1行数据)');
        }
    }

    // Fan timeline table
    const fanSection = content.match(/## 故事背景时间线[\s\S]*?(?=\n## |$)/);
    if (!fanSection) {
        missing.push('故事背景时间线(表格)');
    } else {
        const fanRows = fanSection[0].match(/^\|.+\|.+\|/gm);
        if (!fanRows || fanRows.length < 3) {
            missing.push('故事背景时间线(需要至少1行数据)');
        }
    }

    return { valid: missing.length === 0, missingFields: missing };
}

// ============================================================
// 世界观输出校验
// ============================================================
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
// 通用要点格式检测
// ============================================================
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
export function parseCanonTimelineTable(content: string): TimelineRow[] {
    const section = content.match(/## 原作剧情时间线[\s\S]*?(?=\n## |$)/);
    if (!section) return [];

    return parseMarkdownTable(section[0], FF_CANON_TIMELINE_COLS as unknown as string[]);
}

export function parseFanTimelineTable(content: string): TimelineRow[] {
    const section = content.match(/## 故事背景时间线[\s\S]*?(?=\n## |$)/);
    if (!section) return [];

    return parseMarkdownTable(section[0], FF_FAN_TIMELINE_COLS as unknown as string[]);
}

export function parseTimelineBoardTable(content: string): TimelineRow[] {
    const section = content.match(/##\s+纪元\s*\/\s*时间轴[\s\S]*$/);
    if (!section) return [];

    return parseMarkdownTable(section[0], ['#', '事件名称', '时间', '地点', '涉及人物', '章节', '类型']);
}

// ============================================================
// 同人/原创流程识别
// ============================================================
export function detectTimelineStrategy(projectDotFileContent: string): TimelineStrategy {
    // v31: `.project` 写入端统一写英文枚举值（original/fanfic），
    // 但旧逻辑只认中文「同人」，导致同人项目永远退化为 original，
    // 使得 context-manager 的同人时间线/OOC 规则加载全部失效。
    // 这里同时兼容英文 fanfic 与中文 同人，且兼容「## 类型\n值」换行式与「类型：值」行内式。
    const isFanfic = /##\s*类型\s*\r?\n\s*(?:fanfic|同人)/i.test(projectDotFileContent) ||
        /类型[：:]\s*(?:fanfic|同人)/i.test(projectDotFileContent);

    if (isFanfic) {
        const pathMatch = projectDotFileContent.match(/##\s*同人设定路径\s*\n\s*(.+)/);
        return {
            strategy: 'fanfic',
            timelines: ['canon', 'fan', 'board'],
            rules: true,
            fanficSettingsPath: pathMatch?.[1]?.trim(),
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
            const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
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
export function loadFanficRules(content: string): FanficRules {
    const mustFollowMatch = content.match(/- \*\*必须遵守的原作规则\*\*[：:](.+)/);
    const adaptScopeMatch = content.match(/- \*\*允许改编的范围\*\*[：:](.+)/);
    const redlinesMatch = content.match(/- \*\*禁止触及的红线\*\*[：:](.+)/);

    return {
        mustFollow: mustFollowMatch?.[1]?.split(/[；;]/).map(s => s.trim()).filter(Boolean) || [],
        adaptScope: adaptScopeMatch?.[1]?.trim() || '',
        redlines: redlinesMatch?.[1]?.split(/[；;]/).map(s => s.trim()).filter(Boolean) || [],
    };
}

/**
 * 校验单个人物卡的 YAML frontmatter 字段是否完整 + 正文分节是否齐全
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

    // 3. 检查正文分节（V2 字段 + 短标题别名回退）
    for (const section of CHARACTER_BODY_SECTIONS_V2) {
        if (!bodySectionOrAliasExists(content, section, CHARACTER_SHORT_TITLE_ALIASES)) {
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
 */
export function validateFactionOutput(content: string): ValidationResult {
    const missingFields: string[] = [];

    // YAML 闭合
    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!yamlMatch) {
        return { valid: false, missingFields: ['YAML frontmatter 未闭合'], errorType: 'PARSE_ERROR' };
    }
    const yamlContent = yamlMatch[1];

    // YAML 字段（修正版 helper —— 支持多行值）
    for (const field of FACTION_FRONTMATTER_KEYS) {
        if (!yamlFieldHasValue(yamlContent, field)) missingFields.push(field);
    }

    // tags 特殊检查（宽容匹配）
    if (!/tags:\s*\[.*?势力.*?\]/.test(yamlContent) && !missingFields.includes('tags')) {
        missingFields.push('tags 缺失 [势力] 标签');
    }

    // 正文分节（修正版 helper）
    for (const section of ENTITY_BODY_SECTIONS) {
        if (!bodySectionOrAliasExists(content, section)) {
            missingFields.push(`正文分节: ${section}`);
        }
    }

    return { valid: missingFields.length === 0, missingFields };
}

/**
 * 校验地点卡格式
 */
export function validateLocationOutput(content: string): ValidationResult {
    const missingFields: string[] = [];

    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!yamlMatch) {
        return { valid: false, missingFields: ['YAML frontmatter 未闭合'], errorType: 'PARSE_ERROR' };
    }
    const yamlContent = yamlMatch[1];

    for (const field of LOCATION_FRONTMATTER_KEYS) {
        if (!yamlFieldHasValue(yamlContent, field)) missingFields.push(field);
    }

    if (!/tags:\s*\[.*?地点.*?\]/.test(yamlContent) && !missingFields.includes('tags')) {
        missingFields.push('tags 缺失 [地点] 标签');
    }

    for (const section of ENTITY_BODY_SECTIONS) {
        if (!bodySectionOrAliasExists(content, section)) {
            missingFields.push(`正文分节: ${section}`);
        }
    }

    return { valid: missingFields.length === 0, missingFields };
}

/**
 * 校验物品功法卡格式
 */
export function validateItemOutput(content: string): ValidationResult {
    const missingFields: string[] = [];

    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!yamlMatch) {
        return { valid: false, missingFields: ['YAML frontmatter 未闭合'], errorType: 'PARSE_ERROR' };
    }
    const yamlContent = yamlMatch[1];

    for (const field of ITEM_FRONTMATTER_KEYS) {
        if (!yamlFieldHasValue(yamlContent, field)) missingFields.push(field);
    }

    if (!/tags:\s*\[.*?物品功法.*?\]/.test(yamlContent) && !missingFields.includes('tags')) {
        missingFields.push('tags 缺失 [物品功法] 标签');
    }

    for (const section of ENTITY_BODY_SECTIONS) {
        if (!bodySectionOrAliasExists(content, section)) {
            missingFields.push(`正文分节: ${section}`);
        }
    }

    return { valid: missingFields.length === 0, missingFields };
}

/**
 * 批量解析人物卡输出，返回结构化数据 + 完整性校验结果
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
