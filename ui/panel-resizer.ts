/**
 * panel-resizer.ts — 统一的拖拽分隔条原语
 *
 * 背景（2026-10-29 第 4 轮）：
 * 插件里原本有三套各自为政的拖拽实现——工作台用 mousedown+mousemove 写
 * inline style、协同写作写 ratio、浮窗面板用 pointer 事件。三套的边界、
 * 持久化、禁用选择的处理各不相同，加一个可拖面板就要再抄一遍。
 *
 * 这里抽成一份：
 *   - Pointer Events（支持鼠标 / 触摸 / 手写笔），setPointerCapture 保证拖出边界不丢；
 *   - 键盘可达（role="separator" + 方向键 ±步长），无障碍；
 *   - 双击复位默认值；
 *   - 只负责「算出新尺寸并回调」，持久化交给调用方（不同面板存不同字段）。
 */
import { resolveNodeDoc } from '@/shared/dom-window';

/**
 * 分隔条配置项。
 */
export interface PanelResizerOptions {
    /** 分隔条挂载到哪个容器（element 未提供时用于创建节点） */
    container: HTMLElement;
    /**
     * 复用调用方已插入到正确位置的分隔条节点。
     * 某些视图需要在两个面板之间插入（DOM 顺序敏感），
     * 先自己 createDiv 再交给原语接管交互与样式。
     */
    element?: HTMLElement;
    /** 拖动影响的目标面板 */
    target: HTMLElement;
    /** 方向：left/right 调宽度，top/bottom 调高度 */
    orientation?: 'horizontal' | 'vertical';
    /**
     * 目标在分隔条的哪一侧：
     * - 'before'：目标在分隔条左侧/上方，向右拖变大
     * - 'after' ：目标在分隔条右侧/下方，向右拖变小
     */
    side?: 'before' | 'after';
    /** 尺寸下限（px；unit=percent 时为百分比数值，如 40） */
    min: number;
    /** 尺寸上限（px；unit=percent 时为百分比数值，如 85） */
    max: number;
    /** 当前值（用于首次应用与双击复位） */
    value: number;
    /** 默认值（双击复位目标） */
    defaultValue?: number;
    /** 键盘步长（px；unit=percent 时为百分比步长，如 2） */
    step?: number;
    /**
     * 尺寸单位：
     * - 'px'（默认）按像素计算，写入 --nw-panel-size
     * - 'percent' 按父容器宽度的百分比计算，写入指定变量
     *
     * 协同写作的「编辑区 / 建议区」分割本来存的是比例，
     * 用 percent 模式可以直接沿用，不必换算成像素。
     */
    unit?: 'px' | 'percent';
    /** 写入哪个 CSS 变量；缺省 --nw-panel-size */
    cssVar?: string;
    /** 拖动结束（含键盘操作）时回调，调用方负责持久化 */
    onCommit: (size: number) => void;
    /** 额外类名 */
    className?: string;
    /** 无障碍标签 */
    ariaLabel?: string;
}

/**
 * PanelResizerHandle 类型定义。
 */
export interface PanelResizerHandle {
    /** 分隔条元素 */
    el: HTMLElement;
    /** 用代码设置尺寸（不触发 onCommit） */
    setSize: (size: number) => void;
    destroy: () => void;
}

/** 拖动期间禁用文本选择与光标跳变的 body 类 */
export const RESIZING_BODY_CLASS = 'nw-panel-resizing';

/**
 * 解析分隔条元素当前所在的 body。
 *
 * M3-2：popout 第二窗口里的分隔条拖拽必须把类加在**该窗口**的 body 上；
 * 加在主窗口 body 上时 popout 内仍可选择文本、光标不变。
 *
 * @param el - 分隔条元素
 * @returns 元素所属文档的 body；游离节点回退主窗口 document.body
 */
function resolveResizeBody(el: HTMLElement): HTMLElement | null {
    return resolveNodeDoc(el)?.body ?? (typeof document !== 'undefined' ? document.body : null);
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/**
 * 创建一个可拖拽分隔条。
 *
 * 尺寸以 CSS 自定义属性写到目标元素上（`--nw-panel-size`），
 * 这样样式与 JS 都读同一个值，不会出现 inline style 与 CSS 打架。
 * @param options - 配置项
  * @returns PanelResizerHandle 实例
 */
export function createPanelResizer(options: PanelResizerOptions): PanelResizerHandle {
    const {
        container,
        target,
        orientation = 'horizontal',
        side = 'before',
        min,
        max,
        value,
        defaultValue,
        step = 8,
        unit = 'px',
        cssVar = '--nw-panel-size',
        onCommit,
        element,
        className,
        ariaLabel = '拖动调整面板大小（方向键微调，双击复位）',
    } = options;

    const isHorizontal = orientation === 'horizontal';
    const isPercent = unit === 'percent';
    let current = clamp(value, min, max);

    const el = element ?? container.createDiv({
        cls: [
            'nw-panel-resizer',
            isHorizontal ? 'nw-panel-resizer-h' : 'nw-panel-resizer-v',
            className,
        ].filter(Boolean).join(' '),
        attr: {
            role: 'separator',
            tabindex: '0',
            'aria-orientation': isHorizontal ? 'vertical' : 'horizontal',
            'aria-label': ariaLabel,
            title: ariaLabel,
        },
    });

    const apply = (size: number): void => {
        current = clamp(size, min, max);
        target.style.setProperty(cssVar, isPercent ? `${current}%` : `${current}px`);
    };
    if (element) {
        element.addClass('nw-panel-resizer');
        element.addClass(isHorizontal ? 'nw-panel-resizer-h' : 'nw-panel-resizer-v');
        if (className) for (const cls of className.split(/\s+/).filter(Boolean)) element.addClass(cls);
        element.setAttr('role', 'separator');
        element.setAttr('tabindex', '0');
        element.setAttr('aria-orientation', isHorizontal ? 'vertical' : 'horizontal');
        element.setAttr('aria-label', ariaLabel);
        element.setAttr('title', ariaLabel);
    }

    apply(current);

    const commit = (): void => onCommit(Math.round(current));

    let activePointer: number | null = null;
    let startPos = 0;
    let startSize = 0;
    /** 拖动期间持有 body 类的那个文档的 body（拖动中元素被移动也按原文档移除） */
    let dragBody: HTMLElement | null = null;

    const onPointerDown = (event: PointerEvent): void => {
        if (event.button !== 0) return;
        event.preventDefault();
        activePointer = event.pointerId;
        el.setPointerCapture(event.pointerId);
        startPos = isHorizontal ? event.clientX : event.clientY;
        startSize = isPercent
            ? current
            : target.getBoundingClientRect()[isHorizontal ? 'width' : 'height'];
        el.addClass('is-dragging');
        dragBody = resolveResizeBody(el);
        dragBody?.addClass(RESIZING_BODY_CLASS);
    };

    const onPointerMove = (event: PointerEvent): void => {
        if (activePointer === null || event.pointerId !== activePointer) return;
        const pos = isHorizontal ? event.clientX : event.clientY;
        const delta = pos - startPos;
        let amount = delta;
        if (isPercent) {
            // 百分比模式下把像素位移换算成父容器尺寸的占比
            const host = target.parentElement;
            const hostSize = host
                ? host.getBoundingClientRect()[isHorizontal ? 'width' : 'height']
                : 0;
            amount = hostSize > 0 ? (delta / hostSize) * 100 : 0;
        }
        // side='before'：目标在前，向右拖变大；'after'：目标在后，向右拖变小
        const next = side === 'before' ? startSize + amount : startSize - amount;
        apply(Math.round(next * 100) / 100);
    };

    const endDrag = (event: PointerEvent): void => {
        if (activePointer === null || event.pointerId !== activePointer) return;
        activePointer = null;
        try {
            el.releasePointerCapture(event.pointerId);
        } catch {
            // capture 已被浏览器释放，忽略
        }
        el.removeClass('is-dragging');
        dragBody?.removeClass(RESIZING_BODY_CLASS);
        dragBody = null;
        commit();
    };

    /** 键盘：方向键微调，Home 回默认 */
    const onKeyDown = (event: KeyboardEvent): void => {
        const decKey = isHorizontal ? 'ArrowLeft' : 'ArrowUp';
        const incKey = isHorizontal ? 'ArrowRight' : 'ArrowDown';
        let next = current;
        if (event.key === decKey) next = current - step;
        else if (event.key === incKey) next = current + step;
        else if (event.key === 'Home' && defaultValue !== undefined) next = defaultValue;
        else return;
        event.preventDefault();
        // 方向键语义固定为「减小/增大」，与 side 无关
        apply(next);
        commit();
    };

    const onDoubleClick = (): void => {
        if (defaultValue === undefined) return;
        apply(defaultValue);
        commit();
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('dblclick', onDoubleClick);

    return {
        el,
        setSize: (size: number) => apply(size),
        destroy: () => {
            el.removeEventListener('pointerdown', onPointerDown);
            el.removeEventListener('pointermove', onPointerMove);
            el.removeEventListener('pointerup', endDrag);
            el.removeEventListener('pointercancel', endDrag);
            el.removeEventListener('keydown', onKeyDown);
            el.removeEventListener('dblclick', onDoubleClick);
            dragBody?.removeClass(RESIZING_BODY_CLASS);
            dragBody = null;
            el.remove();
        },
    };
}
