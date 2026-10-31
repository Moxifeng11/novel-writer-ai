/**
 * body-path.ts — 「这是不是章节正文」的唯一判定（v4.27）
 *
 * 用途：工作台的 `file-open` 只应在「打开正文」时切换章节上下文；
 * 打开设定/大纲/旁注等笔记不能重置当前章节（P1-13）。
 *
 * 覆盖两种结构：
 *   - 长篇：`<项目>/03-大纲与章节/正文/<第N卷>/第N章[_标题]_正文.md`
 *   - 短篇/剧本（新）：`<项目>/03-正文/第N节.md`、`第N集.md`
 *   - 短篇/剧本（旧兼容）：沿用长篇结构
 */

function normalizePath(path: string): string {
    return String(path || '').split(String.fromCharCode(92)).join('/');
}

export function isChapterBodyPath(path: string): boolean {
    const normalized = normalizePath(path);
    if (!normalized) return false;
    if (/\/03-大纲与章节\/正文\/[^/]+\/第\d+章[^/]*_正文\.md$/.test(normalized)) return true;
    if (/\/03-正文\/第\d+(?:节|集)[^/]*\.md$/.test(normalized)) return true;
    return false;
}
