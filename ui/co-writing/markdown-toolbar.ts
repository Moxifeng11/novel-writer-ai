/**
 * markdown-toolbar.ts — 协同编辑器 Markdown 工具条
 *
 * 从 co-writing-view.ts 抽出的纯构建函数：只依赖宿主提供的编辑器访问与
 * 文本编辑回调，不持有视图状态。按钮集合与快捷键提示保持不变。
 */
import { t } from '@/i18n';
import {
    INDENT_TWO_FULL_WIDTH,
    type BodyFormatContract,
} from '@/shared/body-format';
import {
    convertToChineseQuotes,
    indentParagraphs,
    insertBlock,
    mergeSelectedParagraphs,
    splitParagraphAtCursor,
    toggleFirstLineIndent,
    toggleLinePrefix,
    wrapSelection,
    type TextEdit,
} from '@/shared/novel-format';

/** 工具条宿主接口。 */
export interface MarkdownToolbarHost {
    /** 当前编辑器（可能尚未挂载） */
    getEditor(): HTMLTextAreaElement | null;
    /** 当前格式契约（缩进/拆段规则） */
    getContract(): BodyFormatContract;
    /** 应用一次文本编辑（视图负责保存/状态刷新） */
    applyTextEdit(edit: TextEdit): void;
    /** 一键排版（按项目写作规则） */
    applyNovelFormat(): void | Promise<void>;
}

/**
 * 构建 Markdown 工具条（不含字体选择器，由调用方先行插入）。
 *
 * @param wrap - 宿主容器
 * @param host - 编辑器访问与回调
 */
export function buildMarkdownToolbar(wrap: HTMLElement, host: MarkdownToolbarHost): void {
    const toolbar = wrap.createDiv({ cls: 'nw-cowrite-md-toolbar' });
    let group = toolbar.createDiv({ cls: 'nw-cowrite-md-group' });
    const addSeparator = (): void => {
        toolbar.createDiv({ cls: 'nw-cowrite-md-sep' });
        group = toolbar.createDiv({ cls: 'nw-cowrite-md-group' });
    };
    const addButton = (label: string, title: string, handler: () => void, cls = ''): void => {
        const button = group.createEl('button', {
            text: label,
            cls: `nw-cowrite-md-btn ${cls}`.trim(),
            attr: { type: 'button', title, 'aria-label': title },
        });
        button.addEventListener('click', (event) => {
            event.preventDefault();
            handler();
        });
    };
    const selection = (): { start: number; end: number } => ({
        start: host.getEditor()?.selectionStart ?? 0,
        end: host.getEditor()?.selectionEnd ?? 0,
    });
    const indent = (): string => host.getContract().indent || INDENT_TWO_FULL_WIDTH;
    const applyEdit = (fn: (text: string, start: number, end: number) => TextEdit): void => {
        const editor = host.getEditor();
        if (!editor) return;
        const { start, end } = selection();
        host.applyTextEdit(fn(editor.value, start, end));
    };

    addButton('B', t('cowrite.md.bold'), () => applyEdit((text, s, e) => wrapSelection(text, s, e, '**')));
    addButton('I', t('cowrite.md.italic'), () => applyEdit((text, s, e) => wrapSelection(text, s, e, '*')));
    addButton('H', t('cowrite.md.h2'), () => applyEdit((text, s, e) => toggleLinePrefix(text, s, e, '## ')));
    addButton('❝', t('cowrite.md.quote'), () => applyEdit((text, s, e) => toggleLinePrefix(text, s, e, '> ')));
    addButton('•', t('cowrite.md.bullet'), () => applyEdit((text, s, e) => toggleLinePrefix(text, s, e, '- ')));
    addButton('―', t('cowrite.md.hr'), () => {
        const { start } = selection();
        const editor = host.getEditor();
        if (editor) host.applyTextEdit(insertBlock(editor.value, start, '---'));
    });

    addSeparator();
    addButton('⇥', t('cowrite.md.indentFirst'), () => applyEdit((text, s, e) => toggleFirstLineIndent(text, s, e, indent())));
    addButton('↹', t('cowrite.md.indentMore'), () => applyEdit((text, s, e) => indentParagraphs(text, s, e, indent(), 1)));
    addButton('⇤', t('cowrite.md.indentLess'), () => applyEdit((text, s, e) => indentParagraphs(text, s, e, indent(), -1)));
    addButton('¶', t('cowrite.md.mergeParas'), () => applyEdit((text, s, e) => mergeSelectedParagraphs(text, s, e)));
    addButton('↵', t('cowrite.md.splitPara'), () => {
        const { start } = selection();
        const editor = host.getEditor();
        if (editor) host.applyTextEdit(splitParagraphAtCursor(editor.value, start, host.getContract()));
    });
    addButton('“”', t('cowrite.md.cnQuotes'), () => applyEdit((text, s, e) => convertToChineseQuotes(text, s, e)));

    addSeparator();
    addButton('⚡ ' + t('cowrite.auxOneKeyFormat'), t('cowrite.md.formatAllTip'), () => void host.applyNovelFormat(), 'is-primary');
}
