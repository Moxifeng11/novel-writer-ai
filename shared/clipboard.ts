/**
 * clipboard.ts — 剪贴板写入的单源封装（含降级）
 *
 * 背景：移动端/无安全上下文（非 https、部分 WebView）里 `navigator.clipboard` 可能为
 * undefined 或 writeText 抛错，直接调用会让复制按钮静默失效。这里统一降级到
 * textarea + execCommand（老旧实现），仍失败则返回 false 由调用方提示。
 */

/**
 * 复制文本到剪贴板。
 *
 * @param text - 要复制的文本
 * @returns 是否成功
 */
export async function copyText(text: string): Promise<boolean> {
    const value = String(text ?? '');
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
    } catch { // silent-ok: 权限/安全上下文限制，继续走 execCommand 降级
    }
    try {
        if (typeof document === 'undefined') return false;
        const area = createEl('textarea');
        area.value = value;
        area.setAttribute('readonly', 'true');
        // 样式走 CSS 类（仓库禁止内联 style）
        area.className = 'nw-clipboard-probe';
        document.body.appendChild(area);
        area.select();
        // execCommand 已废弃，但仍是老 Obsidian / 受限安全上下文里唯一可用的同步复制通道；
        // 通过结构类型访问，避免把废弃 API 直接挂在 Document 上触发类型告警。
        const legacyDocument = document as unknown as { execCommand?: (command: string) => boolean };
        const ok = typeof legacyDocument.execCommand === 'function' && legacyDocument.execCommand('copy');
        document.body.removeChild(area);
        return Boolean(ok);
    } catch { // silent-ok: 降级也失败时由调用方给出「复制失败」提示
        return false;
    }
}
