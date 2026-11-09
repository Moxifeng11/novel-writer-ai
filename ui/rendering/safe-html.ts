/**
 * safe-html.ts — HTML 字符串落 DOM 的唯一入口
 *
 * 社区审核使用 `no-unsanitized/property|method`：任何 `innerHTML =` / `insertAdjacentHTML`
 * 都算不安全，除非值经过官方 `sanitizeHTMLToDom`。本模块把「先清洗再插入」
 * 收成两个函数，调用点不再直接摸 innerHTML。
 *
 * 注意：`sanitizeHTMLToDom` 会剥离 `contenteditable` 等属性；需要保留可编辑语义时
 * 必须用 DOM 构建（见 ui/polish-editor.ts 的 buildEntityMarkedFragment）。
 */
import { sanitizeHTMLToDom } from 'obsidian';

/**
 * 用清洗后的 HTML 替换元素内容（等价于 `el.innerHTML = html`）。
 *
 * @param el - 目标元素
 * @param html - 待插入的 HTML 字符串
 * @returns 无
 */
export function setSanitizedHtml(el: HTMLElement, html: string): void {
    el.empty();
    appendSanitizedHtml(el, html);
}

/**
 * 把清洗后的 HTML 追加到元素末尾（等价于 `el.innerHTML += html`）。
 *
 * @param el - 目标元素
 * @param html - 待插入的 HTML 字符串
 * @returns 无
 */
export function appendSanitizedHtml(el: HTMLElement, html: string): void {
    if (!html) return;
    el.appendChild(sanitizeHTMLToDom(html));
}
