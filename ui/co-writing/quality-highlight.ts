/**
 * quality-highlight.ts — 质量问题文本高亮
 *
 * 从 `ui/co-writing-view.ts` 抽出：只遍历预览 DOM 并按问题定位文本打标记，
 * 交互回调由宿主提供，不持有视图状态。
 */
import type { QualityIssue } from './quality-report';

/** 高亮标记的交互回调。 */
export interface QualityHighlightHandlers {
    /** 鼠标进入标记 */
    showPopup(event: MouseEvent, issue: QualityIssue): void;
    /** 鼠标离开标记 */
    hidePopup(): void;
    /** 右键标记 */
    showContextMenu(event: MouseEvent, issue: QualityIssue): void;
}

/**
 * 在已渲染的预览 DOM 中搜索质量问题文字并高亮。
 *
 * 同一文本节点只命中第一个问题；命中后以 `<mark>` 替换该节点。
 *
 * @param root - 预览根节点
 * @param issues - 质量问题列表
 * @param handlers - 交互回调
 * @example
 * ```ts
 * applyQualityHighlights(previewEl, issues, {
 *   showPopup: (e, issue) => this.showQualityPopup(e, issue),
 *   hidePopup: () => this.hideQualityPopup(),
 *   showContextMenu: (e, issue) => this.showQualityContextMenu(e, issue),
 * });
 * ```
 */
export function applyQualityHighlights(
    root: HTMLElement,
    issues: QualityIssue[],
    handlers: QualityHighlightHandlers,
): void {
    if (issues.length === 0) return;
    walkTextNodes(root, (textNode) => {
        const text = textNode.textContent || '';
        if (text.length < 3) return;
        for (const issue of issues) {
            if (!issue.locationText || issue.locationText.length < 2) continue;
            const idx = text.indexOf(issue.locationText);
            if (idx < 0) continue;
            const parent = textNode.parentNode;
            if (!parent) continue;
            const before = text.slice(0, idx);
            const match = text.slice(idx, idx + issue.locationText.length);
            const after = text.slice(idx + issue.locationText.length);
            const frag = document.createDocumentFragment();
            if (before) frag.appendChild(document.createTextNode(before));
            const hColor = issue.priority === 'high' ? '#ff4444' : issue.priority === 'medium' ? '#ffaa00' : '#88ccff';
            const mark = document.createElement('mark');
            mark.className = 'nw-quality-highlight';
            mark.textContent = match;
            mark.style.cssText = `background:${hColor}33; border-bottom:2px solid ${hColor}; cursor:pointer; border-radius:2px; padding:0 1px;`;
            mark.dataset.issueId = issue.id;
            mark.addEventListener('mouseenter', (e) => { handlers.showPopup(e, issue); });
            mark.addEventListener('mouseleave', () => { handlers.hidePopup(); });
            mark.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                handlers.showContextMenu(e, issue);
            });
            frag.appendChild(mark);
            if (after) frag.appendChild(document.createTextNode(after));
            parent.replaceChild(frag, textNode);
            return;
        }
    });
}

/**
 * 递归遍历 DOM 文本节点（跳过 SCRIPT / STYLE / MARK）。
 *
 * @param node - 起始节点
 * @param fn - 文本节点回调
 * @example
 * ```ts
 * walkTextNodes(root, (node) => { node.textContent = node.textContent?.trim() ?? ''; });
 * ```
 */
export function walkTextNodes(node: Node, fn: (textNode: Text) => void): void {
    if (node.nodeType === Node.TEXT_NODE) {
        fn(node as Text);
        return;
    }
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.nodeName === 'SCRIPT' || child.nodeName === 'STYLE' || child.nodeName === 'MARK') continue;
        if (child.nodeType === Node.TEXT_NODE) {
            fn(child as Text);
        } else {
            walkTextNodes(child, fn);
        }
    }
}
