/**
 * info-plan-fields.ts — 信息规划（章纲）的结构化字段
 *
 * 对标云笔 AI 的 outline 节点字段（开头承接/钩子设计/关联伏笔）：
 * 这些字段是「数据模型级反 AI」的一部分——信息规划文件里显式存在、
 * 解析成类型化数据、注入正文生成、并在结算时参与伏笔闭环核对。
 *
 * 纯函数，不依赖 Obsidian。
 */

export interface InfoPlanFields {
    /** 上一章末句（开头承接的锚点） */
    prevTail: string;
    /** 本章首句如何承接（延续的人物/动作/对话） */
    carryElement: string;
    /** 钩子类型：悬念 / 信息释放 / 承接下章 */
    hookType: string;
    /** 钩子内容 */
    hookContent: string;
    /** 章纲计划回收的旧伏笔名 */
    foreshadowRecycle: string[];
    /** 章纲计划埋下的新伏笔名 */
    foreshadowPlant: string[];
}

const EMPTY_FIELDS: InfoPlanFields = {
    prevTail: '',
    carryElement: '',
    hookType: '',
    hookContent: '',
    foreshadowRecycle: [],
    foreshadowPlant: [],
};

/**
 * 取小节正文（到下一个同级小节或文件尾）。
 * 兼容两种存量写法：`## 伏笔操作` 标题，以及 `**伏笔操作（本章埋设）**：` 加粗行。
 * 旧版信息规划模板用的是加粗行，只认 `##` 会让这些项目解析出空字段（章纲约束静默失效）。
 */
function extractSection(content: string, title: string): string {
    const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
    const titlePattern = new RegExp(`^(?:#{2,4}\\s*|\\*\\*)\\s*${title}`);
    const start = lines.findIndex((line) => titlePattern.test(line));
    if (start < 0) return '';
    const end = lines.findIndex((line, index) => index > start && /^(?:#{2,4}\s|\*\*)/.test(line));
    return (end < 0 ? lines.slice(start) : lines.slice(start, end)).join('\n');
}

/** 取小节里 `- 字段名（可带括号说明）：值` 的值（容忍字段名与冒号之间的括号说明） */
function readListItem(section: string, label: string): string {
    const pattern = new RegExp(`^[-*]\\s*${label}[^：:\\n]*[：:]\\s*(.*)$`, 'm');
    const matched = section.match(pattern);
    return matched ? matched[1].trim() : '';
}

/** 把「A、B；C」或多行列表拆成名称数组 */
function splitNames(raw: string): string[] {
    if (!raw) return [];
    const names: string[] = [];
    for (const line of raw.split('\n')) {
        const text = line.replace(/^[-*\d.、\s]+/, '').replace(/^[^：:]{0,12}[：:]/, '').trim();
        if (!text) continue;
        for (const part of text.split(/[、，,；;]+/)) {
            const name = part.trim();
            if (name) names.push(name);
        }
    }
    return names;
}

/** 表格兜底：取 markdown 表格第一列（跳过表头与分隔行）；旧版伏笔操作是表格写法 */
function readTableFirstColumn(section: string): string[] {
    const names: string[] = [];
    for (const line of section.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|')) continue;
        // 分隔行（|---|:--:|）没有内容
        if (/^\|[\s:|-]+\|?$/.test(trimmed)) continue;
        const cells = trimmed.split('|').map((cell) => cell.trim());
        // cells[0] 是首个竖线之前的空串
        const first = (cells[1] || '').replace(/^[*_`]+|[*_`]+$/g, '').trim();
        if (!first) continue;
        if (/^(伏笔|名称|字段|项目)$/.test(first)) continue;
        names.push(first);
    }
    return names;
}

/**
 * 从信息规划正文解析结构化字段。
 * 旧版信息规划没有这几个小节时全部返回空串——调用方按「字段缺失」处理，
 * 不阻塞生成。
 */
export function parseInfoPlanFields(content: string): InfoPlanFields {
    const text = String(content || '').replace(/\r\n/g, '\n');
    if (!text.trim()) return { ...EMPTY_FIELDS, foreshadowRecycle: [], foreshadowPlant: [] };

    const carrySection = extractSection(text, '开头承接');
    const hookSection = extractSection(text, '章末钩子');
    const foreshadowSection = extractSection(text, '伏笔操作');

    const recycleRaw = readListItem(foreshadowSection, '需回收的旧伏笔');
    const plantRaw = readListItem(foreshadowSection, '需埋下的新伏笔');
    const tableNames = readTableFirstColumn(foreshadowSection);

    // 列表写法优先；旧版表格写法兜底（表格里只有「本章埋设」，即 plant 侧）
    return {
        prevTail: readListItem(carrySection, '上一章末句'),
        carryElement: readListItem(carrySection, '本章首句承接方式'),
        hookType: readListItem(hookSection, '钩子类型'),
        hookContent: readListItem(hookSection, '钩子内容'),
        foreshadowRecycle: recycleRaw ? splitNames(recycleRaw) : [],
        foreshadowPlant: plantRaw ? splitNames(plantRaw) : tableNames,
    };
}

/**
 * 把字段格式化成可注入正文生成的提示词块。
 * 只输出已填写的部分；全部为空时返回空串（调用方跳过注入）。
 */
export function formatInfoPlanPromptBlock(fields: InfoPlanFields): string {
    const lines: string[] = ['【章纲硬要求（来自信息规划，最高优先级）】'];
    let hasAny = false;

    if (fields.prevTail || fields.carryElement) {
        hasAny = true;
        lines.push(`- 开头承接：本章第一句必须自然衔接上一章${fields.prevTail ? `（上一章末句：「${fields.prevTail}」）` : ''}${fields.carryElement ? `，延续其中的${fields.carryElement}` : ''}；不要时间硬切或另起炉灶。`);
    }
    if (fields.hookType || fields.hookContent) {
        hasAny = true;
        lines.push(`- 章末钩子（${fields.hookType || '悬念'}）：${fields.hookContent || '在最后一段埋下推动下一章的钩子'}。全章最后一句落在对话、动作或该钩子上，不要落在景物或感叹上。`);
    }
    if (fields.foreshadowRecycle.length > 0) {
        hasAny = true;
        lines.push(`- 伏笔回收：本章必须推进或揭示以下旧伏笔：${fields.foreshadowRecycle.join('、')}。`);
    }
    if (fields.foreshadowPlant.length > 0) {
        hasAny = true;
        lines.push(`- 伏笔埋设：本章必须埋下以下新伏笔：${fields.foreshadowPlant.join('、')}。`);
    }

    return hasAny ? lines.join('\n') : '';
}
