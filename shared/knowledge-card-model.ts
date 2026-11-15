/**
 * knowledge-card-model.ts — 世界观 / 设定库卡片化（纯函数）
 *
 * M13 剩余项：这两份此前是「单一 md + 多级 H2」，本次拆成条目卡并由卡片渲染派生视图。
 */

/** 世界观/设定条目 */
export interface KnowledgeEntryCard {
    /** 条目 ID（WLD-/SET-） */
    id: string;
    /** 小标题 */
    title: string;
    /** 正文 */
    content: string;
    /** 上级分类（多级 H2 的父标题，可空） */
    category: string;
}

/**
 * 解析多级 H2 文档为条目。
 *
 * @param text - 文档全文
 * @param fallbackPrefix - 临时 ID 前缀（WLD/SET）
 * @returns 条目
 */
export function parseKnowledgeEntries(text: string, fallbackPrefix: string): KnowledgeEntryCard[] {
    const source = String(text ?? '').replace(/\r\n/g, '\n');
    const lines = source.split('\n');
    const cards: KnowledgeEntryCard[] = [];
    let current: { title: string; buffer: string[] } | null = null;
    const flush = (): void => {
        if (!current) return;
        const content = current.buffer.join('\n').trim();
        if (current.title || content) {
            cards.push({
                id: `TMP-${fallbackPrefix}-${cards.length + 1}`,
                title: current.title,
                content,
                category: '',
            });
        }
        current = null;
    };
    for (const line of lines) {
        const heading = line.match(/^##\s+(.+)$/);
        if (heading) {
            flush();
            current = { title: heading[1].trim(), buffer: [] };
            continue;
        }
        if (current) current.buffer.push(line);
    }
    flush();
    return cards;
}

/**
 * 渲染世界观总览（派生视图）。
 *
 * @param cards - 条目
 * @returns Markdown
 */
export function renderWorldview(cards: readonly KnowledgeEntryCard[]): string {
    const lines = ['# 世界观总览', '', '> 本文件由插件根据世界观条目生成，请勿手改。', ''];
    for (const card of cards) {
        lines.push(`## ${card.title || card.id}`, '');
        lines.push(card.content || '（暂无内容）', '');
    }
    return lines.join('\n');
}

/**
 * 渲染设定库（派生视图）。
 *
 * @param cards - 条目
 * @returns Markdown
 */
export function renderSettingLib(cards: readonly KnowledgeEntryCard[]): string {
    const lines = ['# 设定库', '', '> 本文件由插件根据设定条目生成，请勿手改。', ''];
    for (const card of cards) {
        lines.push(`## ${card.title || card.id}`, '');
        lines.push(card.content || '（暂无内容）', '');
    }
    return lines.join('\n');
}

/**
 * 渲染条目卡文件内容。
 *
 * @param card - 条目
 * @param frontmatter - 附加 frontmatter 行（id/type 等）
 * @returns Markdown
 */
export function renderKnowledgeCard(card: KnowledgeEntryCard, frontmatter: Record<string, string>): string {
    const lines: string[] = ['---'];
    for (const [key, value] of Object.entries(frontmatter)) lines.push(`${key}: ${value}`);
    lines.push('---', '', `# ${card.title || card.id}`, '');
    if (card.content) lines.push(card.content);
    return `${lines.join('\n')}\n`;
}
