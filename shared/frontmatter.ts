/** Frontmatter 解析工具 — 被 ui/ 和 engine/ 共享 */

/** HTML 净化（在 shared 层独立实现，避免循环依赖 helpers.ts） */
function stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '');
}

/** Markdown 内容结构（带章节层级信息） */
export interface MarkdownContent {
    raw: string;
    sections: MarkdownSection[];
}

export interface MarkdownSection {
    title: string;
    level: number;
    content: string[];
}

/** 从 Markdown 文件内容中解析 YAML frontmatter 为键值对象 */
export function parseFrontmatter(content: string): Record<string, string> {
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) return {};

    const result: Record<string, string> = {};
    const lines = fm[1].split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^([^:]+):\s*(.*)$/);
        if (match) {
            const key = match[1].trim();
            let value = match[2].trim();
            // 跨行值：当前值为空时检查下一行是否不含冒号（AI 生成的文件常见格式）
            if (!value && i + 1 < lines.length) {
                const nextLine = lines[i + 1];
                if (nextLine && !nextLine.includes(':')) {
                    value = nextLine.trim();
                    i++;
                }
            }
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1);
            }
            result[key] = value;
        }
    }

    return result;
}

/** 将 Markdown 内容解析为 raw + sections 结构（与 context-manager 的实现一致） */
export function parseMarkdownContent(content: string): MarkdownContent {
    const lines = content.split('\n');
    const sections: MarkdownSection[] = [];
    let currentSection: MarkdownSection = { title: '', level: 0, content: [] };

    for (const line of lines) {
        if (line.startsWith('#')) {
            if (currentSection.title) {
                sections.push(currentSection);
            }
            currentSection = {
                title: line.replace(/^#+\s*/, ''),
                level: line.match(/^#+/)?.[0]?.length || 1,
                content: []
            };
        } else {
            currentSection.content.push(line);
        }
    }

    if (currentSection.title) {
        sections.push(currentSection);
    }

    return { raw: content, sections };
}
