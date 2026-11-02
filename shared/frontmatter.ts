/** Frontmatter 解析工具 — 被 ui/ 和 engine/ 共享 */

/**
 * HTML 净化（在 shared 层独立实现，避免循环依赖 helpers.ts）
 *
 * @param html - HTML
 * @returns 文本结果
 */
function stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '');
}

/** Markdown 内容结构（带章节层级信息） */
export interface MarkdownContent {
    raw: string;
    sections: MarkdownSection[];
}

/**
 * MarkdownSection 类型定义。
 */
export interface MarkdownSection {
    title: string;
    level: number;
    content: string[];
}

/**
 * 从 Markdown 文件内容中解析 YAML frontmatter 为键值对象
 *
 * @param content - 内容
 * @returns 映射结果
 */
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

/**
 * 将 Markdown 内容解析为 raw + sections 结构（与 context-manager 的实现一致）
 *
 * @param content - 内容
  * @returns MarkdownContent 实例
 */
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

/**
 * frontmatter 写入护栏：历史数据里可能出现同名重复键
 * （旧版 `updateFrontmatterField` 对空值行 `key:` 匹配失败后又在顶部插入同名键）。
 * Obsidian 的 processFrontMatter 解析 YAML 时会抛
 * `Map keys must be unique`，导致结算等写操作整体失败。
 */

const FM_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const TOP_LEVEL_KEY = /^([^\s#][^:]*)[ \t]*:/;

/**
 * 去除 frontmatter 中的重复顶层键：保留首次出现，丢弃后续重复。
 * frontmatter 之外的正文不动；缩进行（列表/嵌套）不视为键。
 *
 * @param content - 完整 Markdown 文本
 * @returns 去重后的文本（无 frontmatter 或无重复时原样返回）
 */
export function dedupeFrontmatterKeys(content: string): string {
    const match = content.match(FM_BLOCK);
    if (!match) return content;

    const lines = match[1].split(/\r?\n/);
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const line of lines) {
        const keyMatch = line.match(TOP_LEVEL_KEY);
        if (keyMatch) {
            const key = keyMatch[1].trim();
            if (seen.has(key)) continue;
            seen.add(key);
        }
        kept.push(line);
    }

    const deduped = kept.join('\n');
    if (deduped === match[1]) return content;
    const rest = content.slice(match[0].length);
    return `---\n${deduped}\n---${rest.startsWith('\n') || rest === '' ? rest : `\n${rest}`}`;
}

/**
 * 设置 frontmatter 顶层键的值（字符串/数字/布尔）。
 *
 * 与旧的字符串级 `updateFrontmatterField` 相比：
 * - 空值行 `key:` 也能命中（旧正则要求冒号后至少 1 个字符，命中失败后会在
 *   顶部再插一个同名键，制造重复）；
 * - 已有重复键时会收敛成一行，而不是继续追加；
 * - 不存在时插入到 frontmatter 开头。
 *
 * @param content - 完整 Markdown 文本
 * @param key - 顶层键名
 * @param value - 写入值（原样序列化，不做引号处理）
 * @returns 更新后的文本
 */
export function setFrontmatterValue(content: string, key: string, value: string | number | boolean): string {
    const fm = content.match(FM_BLOCK);
    if (!fm) return content;

    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 不带 g：逐行 test 时 lastIndex 会跨行推进，导致漏判重复键
    const keyLine = new RegExp(`^[ \t]*${escaped}[ \t]*:.*$`, 'm');
    const lines = fm[1].split(/\r?\n/);
    const newLine = `${key}: ${value}`;
    let replaced = false;
    const out: string[] = [];
    for (const line of lines) {
        if (keyLine.test(line)) {
            if (!replaced) {
                out.push(newLine);
                replaced = true;
            }
            // 其余同名重复行直接丢弃
            continue;
        }
        out.push(line);
    }
    if (!replaced) out.unshift(newLine);

    return content.replace(FM_BLOCK, `---\n${out.join('\n')}\n---\n`);
}
