/**
 * domain/serializers/frontmatter-serializer.ts — Frontmatter 序列化器
 *
 * 统一 frontmatter 解析和序列化逻辑，集中管理 frontmatter 格式。
 */

import { Frontmatter } from '../value-objects';

/**
 * Frontmatter 序列化器
 * 负责 Markdown frontmatter 字符串与 Frontmatter 值对象之间的双向转换
 */
export class FrontmatterSerializer {
    /**
     * 从 Markdown 内容中解析 frontmatter
     * 返回 Frontmatter 对象和去除 frontmatter 的正文
     */
    static parse(content: string): { frontmatter: Frontmatter; body: string } {
        const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
        if (!match) {
            return {
                frontmatter: Frontmatter.empty(),
                body: content,
            };
        }

        const fmText = match[1];
        const body = content.slice(match[0].length);
        const data = FrontmatterSerializer.parseYaml(fmText);

        return {
            frontmatter: Frontmatter.from(data),
            body,
        };
    }

    /**
     * 简单 YAML frontmatter 解析
     * 支持：
     * - 基本键值对：key: value
     * - 数组：key: [a, b, c] 或 多行缩进
     * - 多行字符串（下一行缩进）
     * - 引号包裹的字符串
     */
    private static parseYaml(text: string): Record<string, any> {
        const result: Record<string, any> = {};
        const lines = text.split('\n');
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];

            if (!line.trim() || line.trim().startsWith('#')) {
                i++;
                continue;
            }

            const match = line.match(/^([^:]+):\s*(.*)$/);
            if (!match) {
                i++;
                continue;
            }

            const key = match[1].trim();
            let value: string | string[] | boolean | number = match[2].trim();

            if (value.startsWith('[') && value.endsWith(']')) {
                value = value.slice(1, -1).split(',').map((s: string) => s.trim()).filter(Boolean);
            } else if (value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1);
            } else if (value.startsWith("'") && value.endsWith("'")) {
                value = value.slice(1, -1);
            } else if (value === '' && i + 1 < lines.length) {
                const nextLines: string[] = [];
                let j = i + 1;
                while (j < lines.length && (lines[j].startsWith('  ') || lines[j].startsWith('\t') || lines[j].trim() === '')) {
                    if (lines[j].trim() !== '') {
                        const itemMatch = lines[j].match(/^[\s-]+(.+)$/);
                        if (itemMatch) {
                            nextLines.push(itemMatch[1].trim());
                        } else {
                            nextLines.push(lines[j].trim());
                        }
                    }
                    j++;
                }
                if (nextLines.length > 0) {
                    if (lines[i + 1].trim().startsWith('-')) {
                        value = nextLines;
                    } else {
                        value = nextLines.join('\n');
                    }
                    i = j - 1;
                }
            }

            if (value === 'true') value = true;
            else if (value === 'false') value = false;
            else if (typeof value === 'string' && !isNaN(Number(value)) && value !== '') {
                const num = Number(value);
                if (String(num) === value || (num.toString() === value && value.includes('.'))) {
                    value = num;
                }
            }

            result[key] = value;
            i++;
        }

        return result;
    }

    /**
     * 将 Frontmatter 序列化为 YAML 字符串
     */
    static serialize(frontmatter: Frontmatter): string {
        const lines: string[] = ['---'];
        const data = frontmatter.toObject();

        for (const [key, value] of Object.entries(data)) {
            if (value === undefined || value === null) {
                continue;
            }
            lines.push(FrontmatterSerializer.serializeField(key, value));
        }

        lines.push('---');
        return lines.join('\n');
    }

    /**
     * 序列化单个字段
     */
    private static serializeField(key: string, value: any): string {
        if (Array.isArray(value)) {
            if (value.length === 0) {
                return `${key}: []`;
            }
            const items = value.map(v => FrontmatterSerializer.escapeYamlValue(String(v))).join(', ');
            return `${key}: [${items}]`;
        }

        if (typeof value === 'object') {
            return `${key}:\n${FrontmatterSerializer.serializeObject(value, 2)}`;
        }

        const strValue = String(value);
        if (strValue.includes('\n')) {
            const indented = strValue.split('\n').map(line => `  ${line}`).join('\n');
            return `${key}:\n${indented}`;
        }

        return `${key}: ${FrontmatterSerializer.escapeYamlValue(strValue)}`;
    }

    /**
     * 序列化嵌套对象
     */
    private static serializeObject(obj: Record<string, any>, indent: number): string {
        const prefix = ' '.repeat(indent);
        const lines: string[] = [];

        for (const [key, value] of Object.entries(obj)) {
            if (value === undefined || value === null) continue;

            if (typeof value === 'object' && !Array.isArray(value)) {
                lines.push(`${prefix}${key}:\n${FrontmatterSerializer.serializeObject(value, indent + 2)}`);
            } else if (Array.isArray(value)) {
                if (value.length === 0) {
                    lines.push(`${prefix}${key}: []`);
                } else {
                    lines.push(`${prefix}${key}:`);
                    for (const item of value) {
                        lines.push(`${prefix}- ${FrontmatterSerializer.escapeYamlValue(String(item))}`);
                    }
                }
            } else {
                lines.push(`${prefix}${key}: ${FrontmatterSerializer.escapeYamlValue(String(value))}`);
            }
        }

        return lines.join('\n');
    }

    /**
     * 转义 YAML 值
     */
    private static escapeYamlValue(value: string): string {
        if (value === '') return '""';
        if (/^\d+$/.test(value)) return value;
        if (/^\d+\.\d+$/.test(value)) return value;
        if (
            value.includes(':') ||
            value.includes('#') ||
            value.startsWith(' ') ||
            value.endsWith(' ') ||
            value.startsWith('"') ||
            value.startsWith("'") ||
            value === 'true' ||
            value === 'false' ||
            value === 'null' ||
            value === 'yes' ||
            value === 'no' ||
            /^\d/.test(value)
        ) {
            return `"${value.replace(/"/g, '\\"')}"`;
        }
        return value;
    }

    /**
     * 将 Frontmatter + body 组合为完整 Markdown
     */
    static toMarkdown(frontmatter: Frontmatter, body: string): string {
        if (frontmatter.isEmpty()) {
            return body;
        }
        const fmStr = FrontmatterSerializer.serialize(frontmatter);
        const normalizedBody = body.startsWith('\n') ? body.slice(1) : body;
        return `${fmStr}\n${normalizedBody}`;
    }

    /**
     * 从 Markdown 字符串创建 Frontmatter（仅解析，不返回 body）
     */
    static parseFrontmatterOnly(content: string): Frontmatter {
        return FrontmatterSerializer.parse(content).frontmatter;
    }
}
