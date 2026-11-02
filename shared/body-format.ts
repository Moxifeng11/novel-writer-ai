/**
 * body-format.ts — 正文格式契约的唯一事实源
 *
 * 背景（2026-10-20 审计）：
 * 项目里曾并存 5 套互相矛盾的正文格式契约：
 *   - 协同写作：一句一段、**不要留空行**、段首 **Tab** 缩进
 *   - 项目「写作规则.md」：每段开头 **空两格**、一句一段
 *   - 风格预设「强者语」：**禁止**用空格/Tab/多余空行代替分段
 *   - 批量生成：段落间 **空行**
 *   - 场景扩写：每个段落之间 **空一行**
 * 同一个 prompt 里甚至会同时注入「空两格」与「Tab」，模型输出形态随机。
 *
 * 本模块把「怎么分段」收敛为：
 *   1. deriveBodyFormat()    —— 从项目写作规则推导契约（唯一事实源）
 *   2. normalizeBodyText()   —— 落盘前按契约规整（去模型自带缩进/标题/元叙述）
 *   3. describeBodyFormat()  —— 生成 prompt 里的格式说明（不再手写）
 */
import { stripModelMeta, stripThinkingBlock } from './api-response-utils';

/** 段落分隔符：单换行（一个自然段一行）或空行（传统排版） */
export type BodySeparator = '\n' | '\n\n';
/** 段首缩进：无 / 两个全角空格 / 制表符 */
export type BodyIndent = '' | '\u3000\u3000' | '\t';

/**
 * 正文格式契约结构定义。
 */
export interface BodyFormatContract {
    separator: BodySeparator;
    indent: BodyIndent;
    /** 正文文件是否保留 `# 第X章 标题` 行（落盘统一由写入器加，模型输出时一律禁止） */
    allowTitle: boolean;
    source: 'writing-rules' | 'default';
}

/** 两个全角空格：项目模板「每段开头空两格」的准确写法 */
export const INDENT_TWO_FULL_WIDTH = '\u3000\u3000';

/**
 * 默认契约与项目模板保持一致：一个自然段一行 + 空两格 + 不留空行。
 * 无写作规则文件时用它，保证至少有一种稳定形态。
 */
export const DEFAULT_BODY_FORMAT: BodyFormatContract = {
    separator: '\n',
    indent: INDENT_TWO_FULL_WIDTH,
    allowTitle: false,
    source: 'default',
};

const WANTS_TWO_FULL_WIDTH = /(空两格|两个全角空格|段首[^\n。]{0,4}两格|每段开头[^\n。]{0,4}空两格)/;
const WANTS_TAB = /(段落?[^\n。]{0,6})?缩进[^\n。]{0,4}(一个)?(制表符|Tab)/i;
const FORBIDS_INDENT = /(禁止|不要|不得)[^\n。]{0,10}(用)?(空格|Tab|制表符)[^\n。]{0,6}(缩进|开头)/i;
const WANTS_BLANK_LINE = /((段落|每段|段)[^\n。]{0,6}(之间|之后|间)[^\n。]{0,6}(空行|空一行))|((每段|每个段落)[^\n。]{0,4}空一行)/;
const FORBIDS_BLANK_LINE = /(禁止|不要|不得)[^\n。]{0,10}(空行|两个回车|空一行)/;

/**
 * 从项目「写作规则.md」文本推导正文格式契约。
 * 优先级：明确肯定式（空两格 / 空行）> 禁止式 > 默认值。
 * @param writingRules - 写作规则
  * @returns BodyFormatContract 实例
 */
export function deriveBodyFormat(writingRules: string): BodyFormatContract {
    const rules = (writingRules || '').trim();
    if (!rules) return { ...DEFAULT_BODY_FORMAT };

    const sample = rules.slice(0, 12000);

    // 缩进：先认「空两格」。强者语的「禁止用空格代替分段」不是禁止缩进，不能误判
    const wantsTwo = WANTS_TWO_FULL_WIDTH.test(sample);
    const wantsTab = !wantsTwo && WANTS_TAB.test(sample);
    const forbidsIndent = !wantsTwo && !wantsTab && FORBIDS_INDENT.test(sample);
    const indent: BodyIndent = wantsTwo
        ? INDENT_TWO_FULL_WIDTH
        : wantsTab
            ? '\t'
            : forbidsIndent
                ? ''
                : DEFAULT_BODY_FORMAT.indent;

    // 分隔：禁止空行优先（「一段一句 + 不要留空行」是最常见的自相矛盾来源）
    const forbidsBlank = FORBIDS_BLANK_LINE.test(sample);
    const wantsBlank = !forbidsBlank && WANTS_BLANK_LINE.test(sample);
    const separator: BodySeparator = wantsBlank ? '\n\n' : '\n';

    return { separator, indent, allowTitle: false, source: 'writing-rules' };
}

/**
 * 规范化正文选项列表结构定义。
 */
export interface NormalizeBodyOptions {
    /** 是否剥离模型写在首行的「好的，我将…」类元叙述，默认 true */
    stripLeadingMeta?: boolean;
    /** 是否剥离 Markdown / 纯文本章节标题行，默认按契约 allowTitle */
    stripTitle?: boolean;
}

const META_LEAD = /^(好的|当然|以下是|这是|根据|按照|收到|明白|没问题|我将|下面)/;
const META_HINT = /(我将|以下是|根据您|按照您|为您|续写|撰写|内容如下|如下)/;
const MD_HEADING = /^#{1,6}\s+/;
const PLAIN_CHAPTER_TITLE = /^第[0-9一二三四五六七八九十百千]+章(\s|$|：|:)/;

/**
 * 按契约规整正文。用于**落盘前**，不作为展示层的文本变换。
 *
 * 处理顺序：
 * 1. 剥离 <think> 段
 * 2. 统一换行、去行首尾空白
 * 3. 剥离模型自带标题与首行元叙述
 * 4. 按契约决定段落分隔（单换行模式压掉空行，空行模式保留段落）
 * 5. 按契约统一段首缩进（先清掉模型自带的空格/Tab/全角空格）
 * @param raw - 原始
 * @param contract - 正文契约
 * @param opts - 选项
 * @returns 文本结果
 */
export function normalizeBodyText(
    raw: string,
    contract: BodyFormatContract = DEFAULT_BODY_FORMAT,
    opts: NormalizeBodyOptions = {}
): string {
    if (!raw) return '';

    let text = stripThinkingBlock(raw);
    // 先处理「有空行分段」的元叙述；单换行文本该函数会原样返回
    text = stripModelMeta(text);
    text = text.replace(/\r\n?/g, '\n');

    const stripTitle = opts.stripTitle ?? !contract.allowTitle;
    const stripLeadingMeta = opts.stripLeadingMeta !== false;

    // 逐行清洗
    const lines: string[] = [];
    for (const rawLine of text.split('\n')) {
        const line = rawLine.replace(/^[ \t\u3000]+/, '').replace(/[ \t\u3000]+$/, '');
        if (!line) {
            lines.push('');
            continue;
        }
        if (stripTitle && (MD_HEADING.test(line) || (PLAIN_CHAPTER_TITLE.test(line) && line.length <= 40))) {
            continue;
        }
        lines.push(line);
    }

    // 去掉首部空行与首行元叙述（最多 2 行）
    let start = 0;
    while (start < lines.length && lines[start] === '') start++;
    if (stripLeadingMeta) {
        let dropped = 0;
        while (dropped < 2 && start < lines.length) {
            const line = lines[start];
            if (line.length <= 200 && META_LEAD.test(line) && META_HINT.test(line)) {
                start++;
                dropped++;
                while (start < lines.length && lines[start] === '') start++;
                continue;
            }
            break;
        }
    }

    // 去掉尾部空行
    let end = lines.length;
    while (end > start && lines[end - 1] === '') end--;

    const body = lines.slice(start, end);

    // 按契约重组段落
    let out: string[];
    if (contract.separator === '\n') {
        // 自然段一行：空行全部压掉，每个非空行独立成段
        out = body.filter((l) => l !== '');
    } else {
        // 空行分段：把连续 2 个以上空行压成 1 个
        out = [];
        for (const line of body) {
            if (line === '' && out.length > 0 && out[out.length - 1] === '') continue;
            out.push(line);
        }
    }

    if (contract.indent) {
        out = out.map((line) => (line ? contract.indent + line : line));
    }

    // 注意：这里不能再 trim()——全角空格（U+3000）属于空白字符，
    // trim 会把首段刚加上的「空两格」缩进一并去掉。
    return out.join('\n');
}

/**
 * 生成 prompt 中的输出格式说明。所有正文类调用点都应使用它，
 * 禁止再手写「空两格/Tab/空行」等互相矛盾的条目。
 *
 * @param contract 格式契约；`allowTitle` 决定是否要求输出 `# 第X章 标题` 行
 * @returns 文本结果
 */
export function describeBodyFormat(contract: BodyFormatContract = DEFAULT_BODY_FORMAT): string {
    const parts: string[] = ['【输出格式（硬性约束）】'];
    if (contract.separator === '\n') {
        parts.push('- 一个自然段写成一行。每段 2–6 句、80–220 字，段内不要换行；只有强调、转折或对话交锋时才一句话独立成段。');
        parts.push('- 段与段之间只用一个换行，不要留空行，不要用两个回车。');
    } else {
        parts.push('- 每个段落之间空一行。');
    }

    if (contract.indent === INDENT_TWO_FULL_WIDTH) {
        parts.push('- 每段开头空两格（两个全角空格）。');
    } else if (contract.indent === '\t') {
        parts.push('- 每段开头缩进一个制表符（Tab）。');
    } else {
        parts.push('- 段首不要用空格或制表符缩进。');
    }

    if (contract.allowTitle) {
        parts.push('- 第一行写章节标题：`# 第X章 标题`（2-15字），正文从下一行开始。');
        parts.push('- 除标题行外只输出正文：不要解释、不要标注、不要用 Markdown 列表/加粗。');
    } else {
        parts.push('- 只输出正文：不要写章节标题、不要解释、不要标注、不要用 Markdown 标题/列表/加粗。');
    }
    return parts.join('\n');
}
