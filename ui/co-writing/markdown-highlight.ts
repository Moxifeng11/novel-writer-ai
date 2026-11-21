/**
 * markdown-highlight.ts — 编辑器 Markdown 着色镜像层（2026-11-16，E-11）
 *
 * 背景：正文是 textarea，无法原生着色，长文里标题/引用/加粗混在正文中不易分辨。
 *
 * 方案：在 textarea 下方放一层「镜像」div（同字体、同字号、同行距、同内边距、
 * 同宽度、同换行规则），textarea 文字透明、只留光标，镜像层负责显示着色文本；
 * 滚动事件同步 translateY。这样不替换 textarea，输入法/撤销/选区行为完全不变。
 *
 * 对齐前提（任何一条不满足都会错位，务必与 CSS 同步）：
 *   font-family / font-size / line-height / padding / border / letter-spacing /
 *   white-space: pre-wrap / overflow-wrap: break-word / tab-size。
 *
 * 纯函数 tokenize + buildHighlightHtml 便于单测（含 HTML 转义）。
 */

/** 着色片段类别 */
export type HighlightKind =
    | 'plain'
    | 'heading'
    | 'bold'
    | 'italic'
    | 'quote'
    | 'list'
    | 'hr'
    | 'marker';

/** 一个着色片段 */
export interface HighlightSegment {
    kind: HighlightKind;
    text: string;
}

/**
 * HTML 转义（镜像层用 innerHTML 渲染，必须转义）。
 *
 * @param text - 原文
 * @returns 转义后文本
 * @example
 * escapeHtml('<b>'); // '&lt;b&gt;'
 */
export function escapeHtml(text: string): string {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * 解析单行内容为着色片段（行内：加粗 / 斜体 / 标记符）。
 *
 * @param line - 单行文本（不含换行符）
 * @returns 片段列表
 * @example
 * tokenizeLine('**重点**').some(s => s.kind === 'bold'); // true
 */
export function tokenizeLine(line: string): HighlightSegment[] {
    const segments: HighlightSegment[] = [];
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ kind: 'plain', text: line.slice(lastIndex, match.index) });
        }
        const token = match[0];
        if (token.startsWith('**')) {
            segments.push({ kind: 'marker', text: '**' });
            segments.push({ kind: 'bold', text: token.slice(2, -2) });
            segments.push({ kind: 'marker', text: '**' });
        } else if (token.startsWith('`')) {
            segments.push({ kind: 'marker', text: '`' });
            segments.push({ kind: 'italic', text: token.slice(1, -1) });
            segments.push({ kind: 'marker', text: '`' });
        } else {
            segments.push({ kind: 'marker', text: '*' });
            segments.push({ kind: 'italic', text: token.slice(1, -1) });
            segments.push({ kind: 'marker', text: '*' });
        }
        lastIndex = match.index + token.length;
    }
    if (lastIndex < line.length) {
        segments.push({ kind: 'plain', text: line.slice(lastIndex) });
    }
    return segments;
}

/**
 * 解析整篇正文为「带行级样式」的片段（保留换行符，保证与 textarea 行数一致）。
 *
 * @param text - 正文
 * @returns 片段列表（含换行片段）
 * @example
 * tokenizeText('# 标题\n正文').filter(s => s.kind === 'heading').length; // 1
 */
export function tokenizeText(text: string): HighlightSegment[] {
    const source = String(text ?? '');
    if (!source) return [];
    const lines = source.split('\n');
    const segments: HighlightSegment[] = [];
    lines.forEach((line, index) => {
        const prefixKind = classifyLine(line);
        if (prefixKind === 'hr') {
            segments.push({ kind: 'hr', text: line });
        } else if (prefixKind) {
            const prefixMatch = line.match(/^(\s*)(#{1,6}\s|>\s?|-\s)/);
            if (prefixMatch) {
                segments.push({ kind: prefixKind, text: prefixMatch[2] });
                const rest = line.slice(prefixMatch[0].length);
                segments.push(...tokenizeLine(rest).map(segment => ({
                    ...segment,
                    kind: segment.kind === 'plain' ? prefixKind : segment.kind,
                })));
            } else {
                segments.push({ kind: prefixKind, text: line });
            }
        } else {
            segments.push(...tokenizeLine(line));
        }
        if (index < lines.length - 1) segments.push({ kind: 'plain', text: '\n' });
    });
    return segments;
}

/**
 * 判断行级样式。
 *
 * @param line - 单行文本
 * @returns 行级样式；普通行返回 null
 * @example
 * classifyLine('# 标题'); // 'heading'
 */
function classifyLine(line: string): 'heading' | 'quote' | 'list' | 'hr' | null {
    if (/^\s*#{1,6}\s/.test(line)) return 'heading';
    if (/^\s*---\s*$/.test(line)) return 'hr';
    if (/^\s*>\s?/.test(line)) return 'quote';
    if (/^\s*-\s/.test(line)) return 'list';
    return null;
}

/**
 * 生成镜像层 HTML（已转义）。
 *
 * @param text - 正文
 * @returns HTML 字符串；空正文返回空串
 * @example
 * buildHighlightHtml('# 标题');
 */
export function buildHighlightHtml(text: string): string {
    const segments = tokenizeText(text);
    if (segments.length === 0) return '';
    return segments.map(segment => {
        const safe = escapeHtml(segment.text);
        if (segment.kind === 'plain') return safe;
        return `<span class="nw-md-${segment.kind}">${safe}</span>`;
    }).join('');
}

/**
 * 同步镜像层滚动（与 textarea 的 scrollTop/scrollLeft 保持一致）。
 *
 * @param backdrop - 镜像层
 * @param editor - 编辑器
 * @example
 * syncHighlightScroll(backdrop, editor);
 */
export function syncHighlightScroll(backdrop: HTMLElement | null, editor: HTMLElement | null): void {
    if (!backdrop || !editor) return;
    backdrop.scrollTop = editor.scrollTop;
    backdrop.scrollLeft = editor.scrollLeft;
}

/**
 * 把 textarea 的真实盒模型样式复制到镜像层。
 *
 * 为什么不用 CSS 并排写两套：编辑器还有 has-md-chrome / 主题变量等多层覆盖，
 * 任何一处不一致都会让着色文本与光标错位。直接复制计算样式是唯一可靠做法。
 * 字体族/字号/行距由 applyEditorMetrics 单独设置（三处必须同源）。
 *
 * @param editor - 编辑器
 * @param backdrop - 镜像层
 * @example
 * copyEditorBoxStyles(textarea, backdrop);
 */
export function copyEditorBoxStyles(editor: HTMLElement | null, backdrop: HTMLElement | null): void {
    if (!editor || !backdrop) return;
    const computed = getComputedStyle(editor);
    const props: Array<[string, string]> = [
        ['paddingTop', computed.paddingTop],
        ['paddingRight', computed.paddingRight],
        ['paddingBottom', computed.paddingBottom],
        ['paddingLeft', computed.paddingLeft],
        ['borderTopWidth', computed.borderTopWidth],
        ['borderRightWidth', computed.borderRightWidth],
        ['borderBottomWidth', computed.borderBottomWidth],
        ['borderLeftWidth', computed.borderLeftWidth],
        ['borderStyle', computed.borderStyle],
        ['borderColor', computed.borderColor],
        ['borderRadius', computed.borderRadius],
        ['letterSpacing', computed.letterSpacing],
        ['wordSpacing', computed.wordSpacing],
        ['textIndent', computed.textIndent],
        ['tabSize', computed.tabSize],
        ['boxSizing', computed.boxSizing],
        ['fontFamily', computed.fontFamily],
        ['fontWeight', computed.fontWeight],
        // 字号/行高必须跟编辑器完全一致：镜像层若在应用 metrics 前创建，
        // 会沿用父级行高（实测 19.5px vs 27px），长文下整篇错位。
        ['fontSize', computed.fontSize],
        ['lineHeight', computed.lineHeight],
        ['whiteSpace', computed.whiteSpace],
        ['overflowWrap', computed.overflowWrap],
        ['wordBreak', computed.wordBreak],
    ];
    // 注意：style.setProperty 只接受 kebab-case（padding-top），
    // 传驼峰（paddingTop）会被静默忽略 —— 这正是首版镜像层不内边距的原因。
    // 直接给 style 对象赋值可以安全使用驼峰属性。
    const style = backdrop.style as unknown as Record<string, string>;
    for (const [prop, value] of props) {
        if (value) style[prop] = value;
    }
    // 滚动条补偿：textarea 有滚动条时内容宽度比 backdrop 窄一个滚动条，
    // 两者换行结果会不同 → 长文下着色文本与正文整体错位。
    // 把滚动条宽度加到 backdrop 的右内边距里，使两侧内容宽度一致。
    const scrollbar = Math.max(0, editor.offsetWidth - editor.clientWidth);
    if (scrollbar > 0) {
        const paddingRight = parseFloat(computed.paddingRight) || 0;
        style.paddingRight = `${paddingRight + scrollbar}px`;
    }
}

/**
 * 用 DOM 节点渲染着色内容（不使用 innerHTML，天然免疫 XSS）。
 *
 * 与 buildHighlightHtml 等价，但走 createSpan + textContent，
 * 避免 no-unsanitized 规则报错，也省掉一次 HTML 解析。
 *
 * @param backdrop - 镜像层容器
 * @param text - 正文
 * @example
 * renderHighlightDom(backdrop, editor.value);
 */
export function renderHighlightDom(backdrop: HTMLElement, text: string): void {
    backdrop.empty();
    const segments = tokenizeText(text);
    for (const segment of segments) {
        if (segment.kind === 'plain') {
            backdrop.appendChild(document.createTextNode(segment.text));
            continue;
        }
        const span = createSpan();
        span.className = `nw-md-${segment.kind}`;
        span.textContent = segment.text;
        backdrop.appendChild(span);
    }
}
