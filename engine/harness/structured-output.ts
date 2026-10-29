/**
 * structured-output.ts - schema-free structured output contracts.
 *
 * We deliberately avoid provider-specific JSON schema flags: local models and
 * many OpenAI-compatible proxies do not support them. Instead each contract
 * declares required fields, validators and repair hints.
 */

export interface OutputField {
    key: string;
    /** array = 任意元素类型的数组（结构化列表，如逐维度修订说明） */
    type: 'string' | 'string[]' | 'object' | 'number' | 'array';
    required: boolean;
    description: string;
}

export interface OutputContract<T = unknown> {
    id: string;
    format: 'json' | 'delimited';
    fields?: OutputField[];
    /** For delimited format: section key -> delimiter heading */
    delimiters?: Record<string, string>;
    parse: (raw: string) => T | null;
    describe: () => string;
}

function extractJsonBlock(raw: string): string | null {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const text = fenced ? fenced[1] : raw;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return text.slice(start, end + 1);
}

export function parseJsonObject<T = Record<string, unknown>>(raw: string): T | null {
    try {
        const block = extractJsonBlock(raw);
        if (!block) return null;
        const parsed = JSON.parse(block);
        return typeof parsed === 'object' && parsed !== null ? parsed as T : null;
    } catch {
        return null;
    }
}

export function parseDelimitedSections(raw: string, delimiters: Record<string, string>): Record<string, string> | null {
    const result: Record<string, string> = {};
    const entries = Object.entries(delimiters);
    for (const [key, heading] of entries) {
        const pattern = new RegExp(`${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n?([\\s\\S]*?)(?=(?:${entries
            .map(([, h]) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|')})\\s*\\n|$)`);
        const match = raw.match(pattern);
        if (!match) return null;
        result[key] = match[1].trim();
    }
    return Object.keys(result).length === entries.length ? result : null;
}

export function describeJsonFields(fields: OutputField[]): string {
    return fields
        .map(field => `- ${field.key} (${field.type}${field.required ? ', required' : ''}): ${field.description}`)
        .join('\n');
}

export function validateFields<T extends Record<string, unknown>>(value: T, fields: OutputField[]): string[] {
    const issues: string[] = [];
    for (const field of fields) {
        const present = Object.prototype.hasOwnProperty.call(value, field.key);
        if (field.required && (!present || value[field.key] === undefined || value[field.key] === null)) {
            issues.push(`缺少必填字段 ${field.key}`);
            continue;
        }
        if (!present) continue;
        const actual = value[field.key];
        if (field.type === 'string' && typeof actual !== 'string') issues.push(`${field.key} 应为字符串`);
        if (field.type === 'number' && typeof actual !== 'number') issues.push(`${field.key} 应为数字`);
        if (field.type === 'string[]' && (!Array.isArray(actual) || actual.some(item => typeof item !== 'string'))) {
            issues.push(`${field.key} 应为字符串数组`);
        }
        if (field.type === 'object' && (typeof actual !== 'object' || Array.isArray(actual))) {
            issues.push(`${field.key} 应为对象`);
        }
        if (field.type === 'array' && !Array.isArray(actual)) {
            issues.push(`${field.key} 应为数组`);
        }
    }
    return issues;
}
