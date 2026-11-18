/**
 * find-replace.ts — 编辑器内查找/替换（2026-11-16，E-01 / B1）
 *
 * 背景：协同视图此前没有查找/替换，Ctrl+F 会被 Obsidian 全局搜索接管并跳走，
 * 长章节改一个词只能肉眼翻。这里提供：
 *   - 纯函数：命中计算、替换计算（单次/全部），便于穷举单测；
 *   - 顶部内联查找条（不弹窗、不打断写作），Ctrl+F 打开、Esc 关闭、Enter 下一个。
 */

import { t } from '@/i18n';

/** 查找选项 */
export interface FindOptions {
    /** 区分大小写 */
    caseSensitive: boolean;
    /** 全词匹配（对中文按「前后非字母数字汉字」判定） */
    wholeWord: boolean;
    /** 正则模式 */
    regex: boolean;
}

/** 一次命中 */
export interface FindMatch {
    /** 起始偏移 */
    start: number;
    /** 结束偏移（不含） */
    end: number;
}

/** 默认选项 */
export const DEFAULT_FIND_OPTIONS: FindOptions = { caseSensitive: false, wholeWord: false, regex: false };

/**
 * 计算全部命中。
 *
 * @param text - 正文
 * @param query - 查找词
 * @param options - 选项
 * @returns 命中列表（按出现顺序）；空查询或非法正则返回空数组
 * @example
 * findMatches('abc ABC', 'abc'); // [{start:0,end:3},{start:4,end:7}]
 */
export function findMatches(text: string, query: string, options: FindOptions = DEFAULT_FIND_OPTIONS): FindMatch[] {
    const source = String(text ?? '');
    const needle = String(query ?? '');
    if (!needle) return [];
    const matches: FindMatch[] = [];
    if (options.regex) {
        let pattern: RegExp;
        try {
            pattern = new RegExp(needle, options.caseSensitive ? 'g' : 'gi');
        } catch {
            return [];
        }
        let hit: RegExpExecArray | null;
        // 零宽匹配保护：避免死循环
        while ((hit = pattern.exec(source)) !== null) {
            if (hit[0].length === 0) {
                pattern.lastIndex += 1;
                continue;
            }
            matches.push({ start: hit.index, end: hit.index + hit[0].length });
        }
        return matches;
    }
    const haystack = options.caseSensitive ? source : source.toLowerCase();
    const target = options.caseSensitive ? needle : needle.toLowerCase();
    let from = 0;
    while (from <= haystack.length) {
        const index = haystack.indexOf(target, from);
        if (index < 0) break;
        const end = index + target.length;
        if (!options.wholeWord || isWholeWordAt(source, index, end)) {
            matches.push({ start: index, end });
        }
        from = end > index ? end : index + 1;
    }
    return matches;
}

/**
 * 判断命中位置是否为「完整词」（前后不接字母/数字/汉字）。
 *
 * @param text - 正文
 * @param start - 起点
 * @param end - 终点
 * @returns 是否完整词
 * @example
 * isWholeWordAt('a cat b', 2, 5); // true
 */
export function isWholeWordAt(text: string, start: number, end: number): boolean {
    const wordChar = /[A-Za-z0-9_\u4e00-\u9fff]/;
    const before = start > 0 ? text[start - 1] : '';
    const after = end < text.length ? text[end] : '';
    return !(before && wordChar.test(before)) && !(after && wordChar.test(after));
}

/**
 * 相对当前光标位置找「下一个」/「上一个」命中。
 *
 * @param matches - 命中列表
 * @param cursor - 当前光标/选区起点
 * @param direction - 1 下一个 / -1 上一个
 * @returns 目标命中下标；无命中返回 -1
 * @example
 * nextMatchIndex([{start:0,end:1},{start:5,end:6}], 2, 1); // 1
 */
export function nextMatchIndex(matches: readonly FindMatch[], cursor: number, direction: 1 | -1): number {
    if (matches.length === 0) return -1;
    if (direction === 1) {
        const index = matches.findIndex(match => match.start > cursor);
        return index >= 0 ? index : 0;
    }
    for (let index = matches.length - 1; index >= 0; index -= 1) {
        if (matches[index].start < cursor) return index;
    }
    return matches.length - 1;
}

/**
 * 替换一处（由调用方传入目标命中）。
 *
 * @param text - 正文
 * @param match - 要替换的命中
 * @param replacement - 替换文本
 * @returns 新正文与替换后光标位置
 * @example
 * replaceOne('abc', {start:0,end:3}, 'X'); // { text: 'X', cursor: 1 }
 */
export function replaceOne(text: string, match: FindMatch, replacement: string): { text: string; cursor: number } {
    const before = text.slice(0, match.start);
    const after = text.slice(match.end);
    return { text: before + replacement + after, cursor: before.length + replacement.length };
}

/**
 * 替换全部命中。
 *
 * 从后往前替换，避免偏移失效。
 *
 * @param text - 正文
 * @param matches - 命中列表
 * @param replacement - 替换文本
 * @returns 新正文与替换数量
 * @example
 * replaceAll('aXa', [{start:0,end:1},{start:2,end:3}], 'B').count; // 2
 */
export function replaceAll(text: string, matches: readonly FindMatch[], replacement: string): { text: string; count: number } {
    let result = text;
    let count = 0;
    for (let index = matches.length - 1; index >= 0; index -= 1) {
        const match = matches[index];
        result = result.slice(0, match.start) + replacement + result.slice(match.end);
        count += 1;
    }
    return { text: result, count };
}

/** 查找条 DOM 句柄 */
export interface FindBarHandles {
    /** 根容器（含 input 与按钮） */
    root: HTMLElement;
    /** 查找输入框 */
    input: HTMLInputElement;
    /** 替换输入框 */
    replaceInput: HTMLInputElement;
    /** 命中计数文案 */
    counter: HTMLElement;
    /** 切换替换行显隐 */
    setReplaceVisible(visible: boolean): void;
}

/** 查找条回调 */
export interface FindBarActions {
    /** 查找词/选项变化 */
    onQueryChange(query: string, options: FindOptions): void;
    /** 上一个/下一个 */
    onNavigate(direction: 1 | -1): void;
    /** 替换当前命中 */
    onReplaceOne(replacement: string): void;
    /** 全部替换 */
    onReplaceAll(replacement: string): void;
    /** 关闭 */
    onClose(): void;
}

/**
 * 渲染内联查找条（顶部，不遮挡正文）。
 *
 * @param parent - 编辑器容器
 * @param actions - 回调
 * @returns 句柄
 * @example
 * const bar = renderFindBar(editorWrap, actions);
 * bar.input.focus();
 */
export function renderFindBar(parent: HTMLElement, actions: FindBarActions): FindBarHandles {
    const root = parent.createDiv({ cls: 'nw-cowrite-findbar' });
    const row = root.createDiv({ cls: 'nw-cowrite-findbar-row' });
    const input = row.createEl('input', {
        cls: 'nw-cowrite-findbar-input',
        attr: { type: 'text', placeholder: t('cowrite.find.searchPlaceholder'), spellcheck: 'false' },
    }) as HTMLInputElement;
    const counter = row.createSpan({ cls: 'nw-cowrite-findbar-counter', text: '0/0' });
    const prevBtn = row.createEl('button', { cls: 'nw-cowrite-findbar-btn', text: '↑', attr: { title: t('cowrite.find.prevTip') } });
    const nextBtn = row.createEl('button', { cls: 'nw-cowrite-findbar-btn', text: '↓', attr: { title: t('cowrite.find.nextTip') } });
    const toggleReplace = row.createEl('button', { cls: 'nw-cowrite-findbar-btn', text: '⇄', attr: { title: t('cowrite.find.toggleReplaceTip') } });
    const caseBtn = row.createEl('button', { cls: 'nw-cowrite-findbar-btn', text: 'Aa', attr: { title: t('cowrite.find.caseTip') } });
    const wordBtn = row.createEl('button', { cls: 'nw-cowrite-findbar-btn', text: '\\b', attr: { title: t('cowrite.find.wordTip') } });
    const closeBtn = row.createEl('button', { cls: 'nw-cowrite-findbar-btn', text: '✕', attr: { title: t('cowrite.find.closeTip') } });

    const replaceRow = root.createDiv({ cls: 'nw-cowrite-findbar-row nw-cowrite-findbar-replace' });
    const replaceInput = replaceRow.createEl('input', {
        cls: 'nw-cowrite-findbar-input',
        attr: { type: 'text', placeholder: t('cowrite.find.replacePlaceholder'), spellcheck: 'false' },
    }) as HTMLInputElement;
    const replaceOneBtn = replaceRow.createEl('button', { cls: 'nw-cowrite-findbar-btn nw-cowrite-findbar-btn-wide', text: t('cowrite.find.replaceBtn') });
    const replaceAllBtn = replaceRow.createEl('button', { cls: 'nw-cowrite-findbar-btn nw-cowrite-findbar-btn-wide', text: t('cowrite.find.replaceAllBtn') });
    replaceRow.addClass('nw-u-d-none');

    const options: FindOptions = { ...DEFAULT_FIND_OPTIONS };
    const emit = (): void => actions.onQueryChange(input.value, { ...options });
    input.addEventListener('input', emit);
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            actions.onNavigate(event.shiftKey ? -1 : 1);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            actions.onClose();
        }
    });
    prevBtn.addEventListener('click', () => actions.onNavigate(-1));
    nextBtn.addEventListener('click', () => actions.onNavigate(1));
    toggleReplace.addEventListener('click', () => {
        const hidden = replaceRow.hasClass('nw-u-d-none');
        replaceRow.toggleClass('nw-u-d-none', !hidden);
        if (hidden) replaceInput.focus();
    });
    caseBtn.addEventListener('click', () => {
        options.caseSensitive = !options.caseSensitive;
        caseBtn.toggleClass('nw-cowrite-findbar-btn-on', options.caseSensitive);
        emit();
    });
    wordBtn.addEventListener('click', () => {
        options.wholeWord = !options.wholeWord;
        wordBtn.toggleClass('nw-cowrite-findbar-btn-on', options.wholeWord);
        emit();
    });
    closeBtn.addEventListener('click', () => actions.onClose());
    replaceOneBtn.addEventListener('click', () => actions.onReplaceOne(replaceInput.value));
    replaceAllBtn.addEventListener('click', () => actions.onReplaceAll(replaceInput.value));
    replaceInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            actions.onReplaceOne(replaceInput.value);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            actions.onClose();
        }
    });

    return {
        root,
        input,
        replaceInput,
        counter,
        setReplaceVisible: (visible: boolean) => replaceRow.toggleClass('nw-u-d-none', !visible),
    };
}
