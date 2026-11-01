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

import { listFolderFiles, type VaultTreePort } from './vault-tree';

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

/**
 * 正文可能所在的顶层内容根（当前布局）。
 * 统计扫描只进这三棵树，不再对整库 getFiles()——用户 vault 里的其它笔记与插件无关。
 * 旧版「书名直接当项目根」的布局不在扫描范围：其变更仍由 vault 事件增量记账。
 */
export const BODY_CONTENT_ROOTS = ['长篇小说', '短篇创作', '剧本创作'] as const;

/**
 * 列出三个内容根下的全部章节正文。
 * 用目录树遍历（getAbstractFileByPath + children）而不是 vault.getFiles()：
 * 前者只碰项目目录，后者每次都要构造整库文件数组。
 */
export function listChapterBodyFiles<T extends { path: string }>(vault: VaultTreePort): T[] {
    const seen = new Set<string>();
    const files: T[] = [];
    for (const root of BODY_CONTENT_ROOTS) {
        for (const file of listFolderFiles<T>(vault, root, { recursive: true })) {
            if (!file?.path || seen.has(file.path)) continue;
            if (!isChapterBodyPath(file.path)) continue;
            seen.add(file.path);
            files.push(file);
        }
    }
    return files;
}
