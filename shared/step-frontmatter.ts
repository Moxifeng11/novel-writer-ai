import type { StepStatus } from './types';

export type { StepStatus };

export interface BuildStepFrontmatterOptions {
    tag: string;
    volume?: string;
    chapter?: string;
    status?: StepStatus;
    model?: string;
    timestamp?: string;
    extra?: Record<string, unknown>;
}

export interface ParsedStepFrontmatter {
    tags: string[];
    volume?: string;
    chapter?: string;
    step_status?: StepStatus;
    step_model?: string;
    step_timestamp?: string;
    [key: string]: unknown;
}

function yamlEscape(value: unknown): string {
    if (value === null || value === undefined) return '""';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    const str = String(value);
    return `"${str.replace(/"/g, '\\"')}"`;
}

export function buildStepFrontmatter(options: BuildStepFrontmatterOptions): string {
    const {
        tag,
        volume = '',
        chapter = '',
        status = 'generated',
        model = '',
        timestamp,
        extra = {},
    } = options;

    const ts = timestamp || new Date().toISOString();

    const lines: string[] = [];
    lines.push('---');
    lines.push(`tags: [${tag}, 步骤结果]`);
    lines.push(`卷: ${yamlEscape(volume)}`);
    lines.push(`章: ${yamlEscape(chapter)}`);
    lines.push(`step_status: ${status}`);
    lines.push(`step_model: ${yamlEscape(model)}`);
    lines.push(`step_timestamp: ${yamlEscape(ts)}`);

    const extraKeys = Object.keys(extra).sort();
    for (const key of extraKeys) {
        const value = extra[key];
        if (Array.isArray(value)) {
            const items = value.map(v => yamlEscape(v)).join(', ');
            lines.push(`${key}: [${items}]`);
        } else {
            lines.push(`${key}: ${yamlEscape(value)}`);
        }
    }

    lines.push('---');
    return lines.join('\n');
}

export function parseStepFrontmatter(content: string): ParsedStepFrontmatter | null {
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) {
        const emptyFm = content.match(/^---\r?\n---/);
        if (!emptyFm) return null;
        return { tags: [] };
    }

    const result: ParsedStepFrontmatter = {
        tags: [],
    };

    const lines = fm[1].split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^([^:]+):\s*(.*)$/);
        if (!match) continue;

        const key = match[1].trim();
        let value = match[2].trim();

        if (!value && i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            if (nextLine && !nextLine.includes(':')) {
                value = nextLine.trim();
                i++;
            }
        }

        if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1).replace(/\\"/g, '"');
        }

        if (key === 'tags') {
            const arrMatch = value.match(/^\[(.*)\]$/);
            if (arrMatch) {
                result.tags = arrMatch[1]
                    .split(',')
                    .map(t => t.trim().replace(/^"|"$/g, ''))
                    .filter(t => t.length > 0);
            } else {
                result.tags = [value];
            }
        } else if (key === '卷') {
            result.volume = value;
        } else if (key === '章') {
            result.chapter = value;
        } else if (key === 'step_status') {
            result.step_status = value as StepStatus;
        } else if (key === 'step_model') {
            result.step_model = value;
        } else if (key === 'step_timestamp') {
            result.step_timestamp = value;
        } else {
            const arrMatch = value.match(/^\[(.*)\]$/);
            if (arrMatch) {
                result[key] = arrMatch[1]
                    .split(',')
                    .map(t => t.trim().replace(/^"|"$/g, ''))
                    .filter(t => t.length > 0);
            } else {
                result[key] = value;
            }
        }
    }

    return result;
}
