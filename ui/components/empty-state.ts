/**
 * empty-state.ts — 空状态通用组件
 *
 * 提供统一的空状态展示：图标 + 标题 + 描述 + 可选操作按钮。
 * 用于替代散落在各视图中的内联空状态实现，保证视觉一致性。
 *
 * 设计要点：
 * - 返回 HTMLElement（非字符串），便于外部绑定事件与追加子元素
 * - 内联 SVG 图标（64x64，stroke 描边风格），无外部资源依赖
 * - 使用 Obsidian CSS 变量（var(--nw-*) / var(--text-*)），适配主题切换
 *
 * @example
 * ```ts
 * const empty = createEmptyState({
 *     icon: 'book',
 *     title: '暂无书籍',
 *     description: '点击「导入书籍」开始添加你的第一本参考书籍',
 *     actionText: '导入书籍',
 *     onAction: () => this.handleImportBooks()
 * });
 * container.appendChild(empty);
 * ```
 */

/** 空状态图标类型 */
export type EmptyStateIcon = 'book' | 'chart' | 'data' | 'search' | 'folder' | 'default';

/** 空状态组件选项 */
export interface EmptyStateOptions {
    /** 图标类型，默认 'default' */
    icon?: EmptyStateIcon;
    /** 标题（必填） */
    title: string;
    /** 描述文本（可选） */
    description?: string;
    /** 操作按钮文本（可选，需配合 onAction） */
    actionText?: string;
    /** 操作按钮回调（可选，需配合 actionText） */
    onAction?: () => void;
}

/** 内联 SVG 图标集合（64x64，stroke 描边风格） */
const SVG_ICONS: Record<EmptyStateIcon, string> = {
    // 打开的书本
    book: `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M32 14 L32 54" />
  <path d="M32 14 C25 10 15 10 8 14 L8 52 C15 48 25 48 32 52" />
  <path d="M32 14 C39 10 49 10 56 14 L56 52 C49 48 39 48 32 52" />
  <path d="M14 22 L26 22" />
  <path d="M14 30 L26 30" />
  <path d="M38 22 L50 22" />
  <path d="M38 30 L50 30" />
</svg>`,
    // 柱状图
    chart: `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M10 54 L58 54" />
  <path d="M10 54 L10 10" />
  <rect x="18" y="38" width="9" height="16" rx="1.5" />
  <rect x="31" y="26" width="9" height="28" rx="1.5" />
  <rect x="44" y="18" width="9" height="36" rx="1.5" />
</svg>`,
    // 数据库堆叠层
    data: `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <ellipse cx="32" cy="14" rx="22" ry="7" />
  <path d="M10 14 L10 30 C10 34 20 38 32 38 C44 38 54 34 54 30 L54 14" />
  <path d="M10 30 L10 46 C10 50 20 54 32 54 C44 54 54 50 54 46 L54 30" />
  <path d="M10 46 L10 50 C10 54 20 58 32 58 C44 58 54 54 54 50 L54 46" />
</svg>`,
    // 放大镜
    search: `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="28" cy="28" r="18" />
  <path d="M41.5 41.5 L56 56" />
  <path d="M22 28 L34 28" />
  <path d="M28 22 L28 34" />
</svg>`,
    // 文件夹
    folder: `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8 18 C8 16 10 14 12 14 L24 14 L28 18 L52 18 C54 18 56 20 56 22 L56 50 C56 52 54 54 52 54 L12 54 C10 54 8 52 8 50 Z" />
  <path d="M8 26 L56 26" />
</svg>`,
    // 通用文档
    default: `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M16 8 L40 8 L52 20 L52 56 L16 56 Z" />
  <path d="M40 8 L40 20 L52 20" />
  <path d="M22 30 L46 30" />
  <path d="M22 38 L46 38" />
  <path d="M22 46 L38 46" />
</svg>`
};

/**
 * 创建空状态组件
 *
 * @param options 空状态选项
 * @returns 空状态根元素（已绑定事件，可被外部 appendChild 追加额外子元素）
 */
export function createEmptyState(options: EmptyStateOptions): HTMLElement {
    const { icon = 'default', title, description, actionText, onAction } = options;

    const container = document.createElement('div');
    container.className = 'nw-empty-state';

    // 图标区域
    const iconWrap = document.createElement('div');
    iconWrap.className = 'nw-empty-state-icon';
    iconWrap.innerHTML = SVG_ICONS[icon];
    container.appendChild(iconWrap);

    // 标题
    const titleEl = document.createElement('div');
    titleEl.className = 'nw-empty-state-title';
    titleEl.textContent = title;
    container.appendChild(titleEl);

    // 描述
    if (description) {
        const descEl = document.createElement('div');
        descEl.className = 'nw-empty-state-description';
        descEl.textContent = description;
        container.appendChild(descEl);
    }

    // 操作按钮（需要同时提供 actionText 和 onAction）
    if (actionText && onAction) {
        const btn = document.createElement('button');
        btn.className = 'nw-empty-state-action';
        btn.type = 'button';
        btn.textContent = actionText;
        btn.addEventListener('click', onAction);
        container.appendChild(btn);
    }

    return container;
}
