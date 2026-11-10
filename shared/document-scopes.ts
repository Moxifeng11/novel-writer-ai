/**
 * document-scopes.ts — 插件 UI 所在的全部 document（主窗口 + popout 第二窗口）。
 *
 * 为什么需要：Obsidian 允许把标签页/弹窗拖进第二窗口，popout 有**自己的**
 * documentElement 与 FontFaceSet。写在主窗口 `document.documentElement` 上的
 * `--nw-*` 主题/布局变量、加到主窗口 `document.fonts` 的自定义字体都不会跨窗口
 * 生效，表现为 popout 里回落到默认配色/字体。这里维护 popout 文档登记表，
 * 由 main.ts 在 `workspace.on('window-open'/'window-close')` 时登记/注销。
 */

const extraDocuments = new Set<Document>();

/**
 * 登记一个 popout 窗口的 document。
 *
 * @param doc - popout 的 document；空值忽略
 */
export function registerDocumentScope(doc: Document | null | undefined): void {
    if (doc) extraDocuments.add(doc);
}

/**
 * 注销一个 popout 窗口的 document（窗口关闭时调用）。
 *
 * @param doc - 待注销的 document；空值忽略
 */
export function unregisterDocumentScope(doc: Document | null | undefined): void {
    if (doc) extraDocuments.delete(doc);
}

/**
 * 清空全部 popout 登记（插件卸载时调用，避免模块单例残留旧窗口）。
 */
export function clearDocumentScopes(): void {
    extraDocuments.clear();
}

/**
 * 列出当前需要注入样式变量的全部 document：主窗口在前，popout 按登记顺序。
 *
 * @returns document 列表；非浏览器环境（单测）返回空数组
 */
export function listDocumentScopes(): Document[] {
    const documents: Document[] = [];
    if (typeof document !== 'undefined') documents.push(document);
    for (const doc of extraDocuments) {
        if (!documents.includes(doc)) documents.push(doc);
    }
    return documents;
}
