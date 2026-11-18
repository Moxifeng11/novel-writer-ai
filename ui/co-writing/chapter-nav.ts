/**
 * chapter-nav.ts — 协同视图内的章节流转（2026-11-16，E-02 / C1）
 *
 * 背景：视图内无法切章，每写完一章都要「回工作台 → 找章节 → 再进来」，连续写作断流。
 * 这里提供：
 *   - 纯函数：按当前章定位上一章/下一章（含跨卷、边界处理）；
 *   - 状态栏内联章节选择器 + 上/下一章按钮（不占额外空间）。
 */
import { t } from '@/i18n';

/** 章节条目（与 project-utils.ChapterListEntry 对齐的最小子集） */
export interface NavChapter {
    /** 章节名，如「第3章」 */
    chapter: string;
    /** 卷名，如「第1卷」 */
    volume: string;
    /** 章节标题 */
    title?: string;
    /** 章号（用于 AI 上下文与保存路径） */
    number: number;
}

/** 相邻章节解析结果 */
export interface ChapterNeighbors {
    /** 当前章下标；未找到为 -1 */
    index: number;
    /** 总章数 */
    total: number;
    /** 上一章（首章为 null） */
    previous: NavChapter | null;
    /** 下一章（末章为 null） */
    next: NavChapter | null;
}

/**
 * 从「第N章」中解析章号。
 *
 * @param chapter - 章节名
 * @returns 章号；解析失败返回 0
 * @example
 * parseChapterNumber('第12章'); // 12
 */
export function parseChapterNumber(chapter: string): number {
    const matched = String(chapter ?? '').match(/第\s*(\d+)\s*[章节集回幕]/);
    if (!matched) return 0;
    const value = parseInt(matched[1], 10);
    return Number.isFinite(value) ? value : 0;
}

/**
 * 计算上一章/下一章。
 *
 * 按章号升序排列后定位；当前章不在列表时按章号插入位置推断邻居（仍可前后翻）。
 *
 * @param chapters - 章节列表（任意顺序）
 * @param currentChapter - 当前章节名
 * @returns 相邻章节信息
 * @example
 * findChapterNeighbors(list, '第2章').next?.chapter; // '第3章'
 */
export function findChapterNeighbors(chapters: readonly NavChapter[], currentChapter: string): ChapterNeighbors {
    const sorted = [...chapters]
        .map(item => ({ ...item, number: item.number || parseChapterNumber(item.chapter) }))
        .sort((a, b) => a.number - b.number);
    const current = String(currentChapter ?? '');
    const index = sorted.findIndex(item => item.chapter === current);
    if (index >= 0) {
        return {
            index,
            total: sorted.length,
            previous: index > 0 ? sorted[index - 1] : null,
            next: index < sorted.length - 1 ? sorted[index + 1] : null,
        };
    }
    const currentNumber = parseChapterNumber(current);
    if (sorted.length === 0) return { index: -1, total: 0, previous: null, next: null };
    if (currentNumber <= 0) return { index: -1, total: sorted.length, previous: null, next: sorted[0] };
    const previous = [...sorted].reverse().find(item => item.number < currentNumber) ?? null;
    const next = sorted.find(item => item.number > currentNumber) ?? null;
    return { index: -1, total: sorted.length, previous, next };
}

/** 章节流转条回调 */
export interface ChapterNavActions {
    /** 选择某章 */
    onSelect(chapter: NavChapter): void;
    /** 上一章/下一章（-1/1） */
    onStep(direction: 1 | -1): void;
}

/**
 * 在状态栏渲染章节流转控件（选择器 + 上/下一章）。
 *
 * @param container - 状态栏容器（会被清空后重建）
 * @param chapters - 章节列表
 * @param currentChapter - 当前章节名
 * @param actions - 回调
 * @returns 相邻章节信息（供调用方禁用按钮判断）
 * @example
 * renderChapterNav(statusBar, chapters, '第2章', { onSelect: fn, onStep: fn });
 */
export function renderChapterNav(
    container: HTMLElement,
    chapters: readonly NavChapter[],
    currentChapter: string,
    actions: ChapterNavActions,
): ChapterNeighbors {
    const nav = container.createDiv({ cls: 'nw-cowrite-chapter-nav' });
    const neighbors = findChapterNeighbors(chapters, currentChapter);

    const prevBtn = nav.createEl('button', {
        cls: 'nw-cowrite-chapter-nav-btn',
        text: '‹',
        attr: { title: neighbors.previous ? t('cowrite.nav.prevChapterTip', { chapter: neighbors.previous.chapter }) : t('cowrite.nav.firstChapter'), type: 'button' },
    });
    prevBtn.disabled = !neighbors.previous;
    prevBtn.addEventListener('click', event => {
        event.stopPropagation();
        if (neighbors.previous) actions.onSelect(neighbors.previous);
    });

    const select = nav.createEl('select', {
        cls: 'nw-cowrite-chapter-nav-select',
        attr: { title: t('cowrite.nav.switchTip') },
    });
    if (chapters.length === 0) {
        select.createEl('option', { text: t('cowrite.nav.noChapters'), value: '' });
    }
    const sorted = [...chapters].sort((a, b) => (a.number || 0) - (b.number || 0));
    for (const item of sorted) {
        const label = item.title ? `${item.chapter} ${item.title}` : item.chapter;
        const option = select.createEl('option', { text: label, value: item.chapter });
        if (item.chapter === currentChapter) option.selected = true;
    }
    if (neighbors.index < 0 && currentChapter) {
        const option = select.createEl('option', { text: currentChapter, value: currentChapter });
        option.selected = true;
    }
    select.addEventListener('change', () => {
        const target = sorted.find(item => item.chapter === select.value);
        if (target) actions.onSelect(target);
    });

    const nextBtn = nav.createEl('button', {
        cls: 'nw-cowrite-chapter-nav-btn',
        text: '›',
        attr: { title: neighbors.next ? t('cowrite.nav.nextChapterTip', { chapter: neighbors.next.chapter }) : t('cowrite.nav.lastChapter'), type: 'button' },
    });
    nextBtn.disabled = !neighbors.next;
    nextBtn.addEventListener('click', event => {
        event.stopPropagation();
        if (neighbors.next) actions.onSelect(neighbors.next);
    });

    return neighbors;
}
