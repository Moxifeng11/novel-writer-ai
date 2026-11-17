/**
 * manuscript-precheck.ts — 发布前文面体检（错别字 / 标点）纯规则引擎
 *
 * 与 export-precheck 的分工：那边看「结构」（未结算、未质控、空单元），
 * 这里看「字面」——错别字对、重复词、中英标点混用、连续标点、引号书名号配对。
 * 全部是本地正则/查表，不调用 AI，因此可以随时在导出前跑一遍。
 *
 * 设计取向：宁可漏报也不误报。每条规则只覆盖「几乎一定是错的」写法，
 * 叠词、省略号、破折号等合法风格用法都放行（或降为 info 级提示）。
 */

/** 规则 id */
export type PrecheckRuleId = 'typo' | 'repeat' | 'punct-mix' | 'punct-repeat' | 'quote-pair' | 'ellipsis' | 'dash';

/** 严重度：error 建议必改，warning 建议确认，info 风格提示 */
export type PrecheckSeverity = 'error' | 'warning' | 'info';

/**
 * PrecheckRuleMeta 类型定义。
 */
export interface PrecheckRuleMeta {
    id: PrecheckRuleId;
    label: string;
    severity: PrecheckSeverity;
}

/** 规则元数据（顺序即问题列表里的展示顺序） */
export const PRECHECK_RULES: readonly PrecheckRuleMeta[] = [
    { id: 'typo', label: '错别字', severity: 'error' },
    { id: 'quote-pair', label: '引号配对', severity: 'error' },
    { id: 'repeat', label: '重复词', severity: 'warning' },
    { id: 'punct-mix', label: '中英标点', severity: 'warning' },
    { id: 'punct-repeat', label: '连续标点', severity: 'warning' },
    { id: 'ellipsis', label: '省略号', severity: 'info' },
    { id: 'dash', label: '破折号', severity: 'info' },
];

/**
 * PrecheckIssue 类型定义。
 */
export interface PrecheckIssue {
    ruleId: PrecheckRuleId;
    severity: PrecheckSeverity;
    /** 相对传入文本的字符偏移 */
    index: number;
    /** 命中片段的字符长度 */
    length: number;
    /** 1 基行号 */
    line: number;
    /** 1 基列号 */
    column: number;
    /** 上下文片段（已折叠换行） */
    snippet: string;
    /** 人话说明 */
    message: string;
}

/**
 * PrecheckChapterInput 类型定义。
 */
export interface PrecheckChapterInput {
    /** 展示名，如「第 1 章 风起」 */
    name: string;
    /** 文件路径（供跳转） */
    path?: string;
    /** 完整文件内容（含 frontmatter，内部会跳过） */
    text: string;
}

/**
 * PrecheckChapterResult 类型定义。
 */
export interface PrecheckChapterResult {
    name: string;
    path?: string;
    issues: PrecheckIssue[];
}

/**
 * PrecheckReport 类型定义。
 */
export interface PrecheckReport {
    chapters: PrecheckChapterResult[];
    total: number;
    byRule: Record<PrecheckRuleId, number>;
    bySeverity: Record<PrecheckSeverity, number>;
}

/** 每章最多报告的问题数，避免超长章节把列表撑爆 */
const MAX_ISSUES_PER_CHAPTER = 200;

/** 错别字对：写错的 → 正确写法（只收「几乎一定是错」的组合） */
const TYPO_PAIRS: readonly (readonly [string, string])[] = [
    ['既使', '即使'], ['以经', '已经'], ['按装', '安装'], ['必竟', '毕竟'], ['即然', '既然'],
    ['做为', '作为'], ['一但', '一旦'], ['再所难免', '在所难免'], ['迫不急待', '迫不及待'],
    ['一股作气', '一鼓作气'], ['题纲', '提纲'], ['帐号', '账号'], ['帐户', '账户'],
    ['松驰', '松弛'], ['精萃', '精粹'], ['冒然', '贸然'], ['道貌暗然', '道貌岸然'],
    ['迫在眉捷', '迫在眉睫'], ['风糜', '风靡'], ['竞竞业业', '兢兢业业'], ['严竣', '严峻'],
    ['渲泄', '宣泄'], ['沉缅', '沉湎'], ['针贬', '针砭'], ['寒喧', '寒暄'], ['妥贴', '妥帖'],
    ['肆业', '肄业'], ['摧眠', '催眠'], ['幅射', '辐射'], ['九宵', '九霄'], ['偏辟', '偏僻'],
    ['既往不究', '既往不咎'], ['谈笑风声', '谈笑风生'], ['人情事故', '人情世故'],
    ['鬼鬼崇崇', '鬼鬼祟祟'], ['不径而走', '不胫而走'], ['心无旁鹜', '心无旁骛'],
    ['插科打浑', '插科打诨'], ['沤心沥血', '呕心沥血'], ['杀戳', '杀戮'], ['相形见拙', '相形见绌'],
    ['一如继往', '一如既往'], ['再接再励', '再接再厉'], ['走头无路', '走投无路'],
    ['美仑美奂', '美轮美奂'], ['金榜提名', '金榜题名'], ['默守成规', '墨守成规'],
    ['不能自己', '不能自已'], ['饮鸠止渴', '饮鸩止渴'], ['鞭辟入理', '鞭辟入里'],
    ['汉流浃背', '汗流浃背'],
];

/** 合法的叠用词：形如「一个一个」「许多许多」不算重复词 */
const REPEAT_WHITELIST = new Set([
    '一个', '一天', '一次', '一遍', '一年', '一群', '一点', '一半', '一边', '一层',
    '一阵', '一会', '一片', '一条', '一句', '一步', '一口', '一身', '一分', '一声',
    '许多', '很久', '很多', '慢慢', '渐渐',
]);

/** 英文标点 → 中文标点 */
const ASCII_TO_CJK: Record<string, string> = {
    ',': '，', '.': '。', '?': '？', '!': '！', ';': '；', ':': '：', '(': '（', ')': '）',
};

/** 成对符号：开 → 关 */
const PAIR_OPEN: Record<string, string> = { '“': '”', '《': '》', '「': '」' };

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

function isCjk(ch: string | undefined): boolean {
    return !!ch && CJK_RE.test(ch);
}

function isDigit(ch: string | undefined): boolean {
    return !!ch && ch >= '0' && ch <= '9';
}

/** 内部：规则原始命中（偏移相对正文） */
interface RawIssue {
    ruleId: PrecheckRuleId;
    severity: PrecheckSeverity;
    index: number;
    length: number;
    message: string;
}

function ruleSeverity(id: PrecheckRuleId): PrecheckSeverity {
    return PRECHECK_RULES.find(rule => rule.id === id)?.severity ?? 'warning';
}

function snippetOf(text: string, index: number, length: number): string {
    const from = Math.max(0, index - 12);
    const to = Math.min(text.length, index + length + 12);
    return text.slice(from, to).replace(/\s+/g, ' ');
}

/** 错别字：查表逐对扫描 */
function scanTypos(body: string): RawIssue[] {
    const issues: RawIssue[] = [];
    for (const [wrong, right] of TYPO_PAIRS) {
        let from = 0;
        for (;;) {
            const at = body.indexOf(wrong, from);
            if (at < 0) break;
            issues.push({
                ruleId: 'typo',
                severity: 'error',
                index: at,
                length: wrong.length,
                message: '「' + wrong + '」应为「' + right + '」',
            });
            from = at + wrong.length;
        }
    }
    return issues;
}

/** 重复词：相邻重复的 2–4 字词组（白名单放行） */
function scanRepeats(body: string): RawIssue[] {
    const issues: RawIssue[] = [];
    const re = /([\u4e00-\u9fff]{2,4})\1/g;
    for (const match of body.matchAll(re)) {
        const unit = match[1];
        if (REPEAT_WHITELIST.has(unit)) continue;
        issues.push({
            ruleId: 'repeat',
            severity: ruleSeverity('repeat'),
            index: match.index ?? 0,
            length: match[0].length,
            message: '重复词「' + match[0] + '」，疑似多敲了一遍',
        });
    }
    return issues;
}

/** 中英标点混用：中文语境里出现英文 , . ? ! ; : ( ) */
function scanPunctMix(body: string): RawIssue[] {
    const issues: RawIssue[] = [];
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        const cjk = ASCII_TO_CJK[ch];
        if (!cjk) continue;
        const prev = body[i - 1];
        const next = body[i + 1];
        if (!isCjk(prev) && !isCjk(next)) continue;
        if (ch === '.' && (prev === '.' || next === '.')) continue;
        if (ch === '.' && isDigit(prev) && isDigit(next)) continue;
        issues.push({
            ruleId: 'punct-mix',
            severity: ruleSeverity('punct-mix'),
            index: i,
            length: 1,
            message: '中文里用了英文标点「' + ch + '」，建议改为「' + cjk + '」',
        });
    }
    return issues;
}

/** 连续标点：同一全角标点连续出现（省略号/破折号不在此列） */
function scanPunctRepeat(body: string): RawIssue[] {
    const issues: RawIssue[] = [];
    const re = /([，。、；：！？])\1+/g;
    for (const match of body.matchAll(re)) {
        const mark = match[1];
        const strong = mark === '！' || mark === '？';
        issues.push({
            ruleId: 'punct-repeat',
            severity: strong ? 'info' : ruleSeverity('punct-repeat'),
            index: match.index ?? 0,
            length: match[0].length,
            message: '连续出现 ' + String(match[0].length) + ' 个「' + mark + '」，一般保留一个',
        });
    }
    return issues;
}

/** 引号 / 书名号配对 */
function scanPairs(body: string): RawIssue[] {
    const issues: RawIssue[] = [];
    const stack: { ch: string; index: number }[] = [];
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        const close = PAIR_OPEN[ch];
        if (close) {
            stack.push({ ch, index: i });
            continue;
        }
        if (ch === '”' || ch === '》' || ch === '」') {
            const top = stack[stack.length - 1];
            if (top && PAIR_OPEN[top.ch] === ch) {
                stack.pop();
                continue;
            }
            issues.push({
                ruleId: 'quote-pair',
                severity: 'error',
                index: i,
                length: 1,
                message: '出现了没有配对的「' + ch + '」',
            });
        }
    }
    for (const left of stack) {
        issues.push({
            ruleId: 'quote-pair',
            severity: 'error',
            index: left.index,
            length: 1,
            message: '「' + left.ch + '」缺少对应的「' + PAIR_OPEN[left.ch] + '」',
        });
    }
    return issues;
}

/** 省略号：英文 ... 与单个 … */
function scanEllipsis(body: string): RawIssue[] {
    const issues: RawIssue[] = [];
    for (const match of body.matchAll(/\.{3,}/g)) {
        issues.push({
            ruleId: 'ellipsis',
            severity: 'warning',
            index: match.index ?? 0,
            length: match[0].length,
            message: '英文省略号「' + match[0] + '」建议改为「……」',
        });
    }
    for (const match of body.matchAll(/…/g)) {
        const at = match.index ?? 0;
        if (body[at - 1] === '…' || body[at + 1] === '…') continue;
        issues.push({
            ruleId: 'ellipsis',
            severity: 'info',
            index: at,
            length: 1,
            message: '单个「…」建议写成「……」',
        });
    }
    return issues;
}

/** 破折号：英文 -- 与单个 — */
function scanDashes(body: string): RawIssue[] {
    const issues: RawIssue[] = [];
    for (const match of body.matchAll(/-{2,}/g)) {
        issues.push({
            ruleId: 'dash',
            severity: 'warning',
            index: match.index ?? 0,
            length: match[0].length,
            message: '英文连字符「' + match[0] + '」建议改为「——」',
        });
    }
    for (const match of body.matchAll(/—/g)) {
        const at = match.index ?? 0;
        if (body[at - 1] === '—' || body[at + 1] === '—') continue;
        issues.push({
            ruleId: 'dash',
            severity: 'info',
            index: at,
            length: 1,
            message: '单个「—」建议写成「——」',
        });
    }
    return issues;
}

/**
 * 拆掉 frontmatter，返回正文起点（保留正文原始偏移，便于跳转回文件行号）。
 *
 * @param content - 文件全文（可含 `---` 包裹的元数据）
 * @returns 去掉元数据后的正文，以及正文在原文中的起始偏移（无元数据时为 0）
 */
export function splitFrontmatter(content: string): { body: string; offset: number } {
    const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
    if (!match) return { body: content, offset: 0 };
    return { body: content.slice(match[0].length), offset: match[0].length };
}

/** 把原始命中换算成带行号/列号/上下文的问题条目 */
function finishIssues(raw: RawIssue[], content: string, bodyOffset: number, body: string): PrecheckIssue[] {
    const sorted = raw
        .slice()
        .sort((a, b) => a.index - b.index)
        .slice(0, MAX_ISSUES_PER_CHAPTER);
    const issues: PrecheckIssue[] = [];
    let cursor = 0;
    let line = 1;
    for (const item of sorted) {
        const absolute = bodyOffset + item.index;
        for (let i = cursor; i < absolute && i < content.length; i++) {
            if (content[i] === '\n') line++;
        }
        cursor = Math.min(absolute, content.length);
        const lineStart = content.lastIndexOf('\n', absolute - 1) + 1;
        issues.push({
            ruleId: item.ruleId,
            severity: item.severity,
            index: absolute,
            length: item.length,
            line,
            column: absolute - lineStart + 1,
            snippet: snippetOf(body, item.index, item.length),
            message: item.message,
        });
    }
    return issues;
}

/**
 * 对一段正文跑全部规则。
 *
 * @param text - 正文（可含 frontmatter，会被跳过且偏移仍相对原文）
 * @returns 问题列表（按偏移升序）
 */
export function checkManuscriptText(text: string): PrecheckIssue[] {
    const content = text || '';
    const { body, offset } = splitFrontmatter(content);
    const raw: RawIssue[] = [
        ...scanTypos(body),
        ...scanPairs(body),
        ...scanRepeats(body),
        ...scanPunctMix(body),
        ...scanPunctRepeat(body),
        ...scanEllipsis(body),
        ...scanDashes(body),
    ];
    return finishIssues(raw, content, offset, body);
}

/**
 * 对多章跑体检并汇总。
 *
 * @param chapters - 章节列表
 * @returns 报告（含按规则/严重度统计）
 */
export function checkManuscript(chapters: readonly PrecheckChapterInput[]): PrecheckReport {
    const byRule = Object.fromEntries(PRECHECK_RULES.map(rule => [rule.id, 0])) as Record<PrecheckRuleId, number>;
    const bySeverity: Record<PrecheckSeverity, number> = { error: 0, warning: 0, info: 0 };
    const results: PrecheckChapterResult[] = [];
    let total = 0;
    for (const chapter of chapters) {
        const issues = checkManuscriptText(chapter.text);
        if (issues.length === 0) continue;
        for (const issue of issues) {
            byRule[issue.ruleId] += 1;
            bySeverity[issue.severity] += 1;
        }
        total += issues.length;
        results.push({ name: chapter.name, path: chapter.path, issues });
    }
    return { chapters: results, total, byRule, bySeverity };
}

/**
 * 一句话摘要（导出提示用）；没有问题时返回 null。
 *
 * @param report - 体检报告
 * @param maxChapters - 最多列出几章，默认 3
 * @returns 摘要文本或 null
 */
export function formatPrecheckSummary(report: PrecheckReport, maxChapters = 3): string | null {
    if (report.total === 0) return null;
    const parts = PRECHECK_RULES
        .filter(rule => report.byRule[rule.id] > 0)
        .map(rule => rule.label + ' ' + String(report.byRule[rule.id]));
    const names = report.chapters
        .slice(0, maxChapters)
        .map(chapter => chapter.name + '（' + String(chapter.issues.length) + '）');
    const more = report.chapters.length > maxChapters ? '…' : '';
    return '🔎 文面体检：发现 ' + String(report.total) + ' 处（' + parts.join('、') + '），涉及 '
        + String(report.chapters.length) + ' 章：' + names.join('、') + more + '。';
}
