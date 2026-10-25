/**
 * auto-context-block.ts — 正文「自动注入上下文」块的幂等读写
 *
 * 上下文注入每次点击都会重新检索实体与伏笔。如果直接向正文追加，同一章
 * 会被写入多段「## 自动注入上下文」。这里用 HTML 注释标记圈定块边界，
 * 写入前先清理旧块（含旧版无标记块），保证「注入 N 次 = 正文只有 1 段」。
 */

export const AUTO_CONTEXT_START = '<!-- nw:auto-context:start -->';
export const AUTO_CONTEXT_END = '<!-- nw:auto-context:end -->';

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 新标记块：start → end，可跨行 */
const MARKED_BLOCK_RE = new RegExp(
    `\\n*${escapeRe(AUTO_CONTEXT_START)}[\\s\\S]*?${escapeRe(AUTO_CONTEXT_END)}\\n*`,
    'g',
);

/** 旧版注入块：以 `---` + 标题开头、以 `---` 结尾，无标记 */
const LEGACY_BLOCK_RE = /\n*---\n## 自动注入上下文\n[\s\S]*?\n---\n*/g;

/** 生成带标记的注入块；body 为「### 关联人物」起的内容 */
export function buildAutoContextBlock(body: string): string {
    return `${AUTO_CONTEXT_START}\n---\n## 自动注入上下文\n\n${body.trim()}\n---\n${AUTO_CONTEXT_END}`;
}

/** 清理正文中的自动注入块（先清标记块，再清旧版无标记块） */
export function stripAutoContext(text: string): string {
    return text.replace(MARKED_BLOCK_RE, '\n\n').replace(LEGACY_BLOCK_RE, '\n\n');
}

/**
 * 幂等写入：先清理旧块，再插入新块。
 * 插入位置优先级：`<!-- 正文从这里开始 -->` 标记后 → 一级标题后 → 正文末尾。
 */
export function upsertAutoContext(text: string, body: string, marker: string): string {
    const base = stripAutoContext(text);
    const block = buildAutoContextBlock(body);

    const markerIdx = marker ? base.indexOf(marker) : -1;
    if (markerIdx !== -1) {
        const insertAt = markerIdx + marker.length;
        return joinAt(base, insertAt, block);
    }

    const titleMatch = /^# .*$/m.exec(base);
    if (titleMatch) {
        return joinAt(base, titleMatch.index + titleMatch[0].length, block);
    }

    return `${base.replace(/\s+$/, '')}\n\n${block}\n`;
}

/** 在 insertAt 处插入块，只整理插入点两侧的空行，不压缩正文其余部分 */
function joinAt(text: string, insertAt: number, block: string): string {
    const before = text.slice(0, insertAt).replace(/\n+$/, '');
    const after = text.slice(insertAt).replace(/^\n+/, '');
    return `${before}\n\n${block}\n\n${after}`;
}
