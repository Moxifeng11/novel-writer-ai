/**
 * body-path.ts — 「这是不是章节正文」的唯一判定（v4.27）
 *
 * 用途：工作台的 `file-open` 只应在「打开正文」时切换章节上下文；
 * 打开设定/大纲/旁注等笔记不能重置当前章节（P1-13）。
 *
 * 覆盖三种结构：
 *   - 长篇：`长篇小说/<项目>/03-大纲与章节/正文/<第N卷>/第N章[_标题]_正文.md`
 *   - 短篇：`短篇小说/<项目>/短篇创作/03-正文/第N节[_标题].md`
 *   - 剧本：`剧本/<项目>/剧本创作/03-剧本/第N集[_标题].md`
 *   - 旧兼容：短篇/剧本沿用长篇结构时按长篇规则识别
 */

import { MODE_LIBRARY_ROOT_LIST } from './creation-mode';
import { listFolderFiles, type VaultTreePort } from './vault-tree';

function normalizePath(path: string): string {
    return String(path || '').split(String.fromCharCode(92)).join('/');
}

/**
 * 是否章节正文路径。
 * @param path - 路径
 * @returns 是否成功
 */
export function isChapterBodyPath(path: string): boolean {
    const normalized = normalizePath(path);
    if (!normalized) return false;
    if (/\/03-大纲与章节\/正文\/[^/]+\/第\d+章[^/]*_正文\.md$/.test(normalized)) return true;
    if (/\/03-正文\/第\d+节[^/]*\.md$/.test(normalized)) return true;
    if (/\/03-剧本\/第\d+集[^/]*\.md$/.test(normalized)) return true;
    return false;
}

/**
 * 正文可能所在的顶层内容根（当前布局，唯一来源 `MODE_LIBRARY_ROOTS`）。
 * 统计扫描只进这三棵树，不再对整库 getFiles()——用户 vault 里的其它笔记与插件无关。
 * 注意根是项目库根（`长篇小说`/`短篇小说`/`剧本`）；短篇/剧本的内容目录
 * （`短篇创作`/`剧本创作`）位于项目目录之下，不能再当顶层根。
 */
export const BODY_CONTENT_ROOTS: readonly string[] = MODE_LIBRARY_ROOT_LIST;

/**
 * 列出三个内容根下的全部章节正文。
 * 用目录树遍历（getAbstractFileByPath + children）而不是 vault.getFiles()：
 * 前者只碰项目目录，后者每次都要构造整库文件数组。
 * @param vault - 仓库（Vault）
 * @returns 结果数组
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
