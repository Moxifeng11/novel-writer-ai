import { App, TFile, TFolder } from 'obsidian';
import { PJ_TEMPLATE_DIR, sanitizeName } from '../shared/paths';
import { mkdirp } from '../utils/helpers';
import { validateWritingStyleOutput } from '../shared/template-validator';

/** 内置与用户扩展共用的文笔风格预设目录（随模板自举写入 vault） */
export const STYLE_PRESET_DIR = `${PJ_TEMPLATE_DIR}/文笔风格预设`;

export interface WritingStylePreset {
    /** 文件名（不含扩展名） */
    id: string;
    name: string;
    description: string;
    order: number;
    /** 键为章节标题，值为该章节正文 */
    sections: Record<string, string>;
    /** 「零、参考样本」整段原文 */
    reference: string;
}

const SUB_SECTION_PARENT = '二、文笔特征';

function normalize(raw: string): string {
    return raw.replace(/\r\n/g, '\n');
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return { meta: {}, body: raw };
    const meta: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
        const idx = line.indexOf(':');
        if (idx <= 0) continue;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim().replace(/^["']+|["']+$/g, '');
        if (key) meta[key] = value;
    }
    return { meta, body: raw.slice(match[0].length) };
}

/**
 * 取 `## 标题` 到下一个 `## ` 之间的内容
 *
 * @param body - 正文
 * @param heading - 标题
 * @returns 文本结果
 */
export function extractSection(body: string, heading: string): string {
    const marker = `## ${heading}`;
    const idx = body.indexOf(marker);
    if (idx === -1) return '';
    const after = body.indexOf('\n', idx);
    if (after === -1) return '';
    const next = body.indexOf('\n## ', after);
    return body.slice(after + 1, next === -1 ? body.length : next).trim();
}

/**
 * 取 `### 子标题` 到下一个 `### ` 之间的内容
 *
 * @param section - 分区
 * @param sub - 子项
 * @returns 文本结果
 */
export function extractSubSection(section: string, sub: string): string {
    const marker = `### ${sub}`;
    const idx = section.indexOf(marker);
    if (idx === -1) return '';
    const after = idx + marker.length;
    const next = section.indexOf('\n### ', after);
    return section.slice(after, next === -1 ? section.length : next).trim();
}

const TOP_LEVEL_KEYS = [
    '一、叙事视角',
    '三、对话风格',
    '四、描写风格',
    '五、叙事节奏',
    '六、情感表达方式',
    '七、禁用/慎用',
    '八、参考作品',
    '九、番茄小说格式要求',
];

const SUB_KEYS = ['总体风格', '句式特征', '用语习惯'];

/**
 * 解析单个预设文件。章节键统一用标题名，方便 UI 直接映射。
 * 缺少 frontmatter 时以文件名兜底，保证用户随手新增的文件也能被识别。
 * @param id - 标识
 * @param raw - 原始
  * @returns WritingStylePreset 实例
 */
export function parseStylePreset(id: string, raw: string): WritingStylePreset {
    const text = normalize(raw);
    const { meta, body } = parseFrontmatter(text);

    const sections: Record<string, string> = {};
    for (const heading of TOP_LEVEL_KEYS) {
        const content = extractSection(body, heading);
        if (content) sections[heading] = content;
    }

    const featureBlock = extractSection(body, SUB_SECTION_PARENT);
    if (featureBlock) {
        for (const sub of SUB_KEYS) {
            const content = extractSubSection(featureBlock, sub);
            if (content) sections[sub] = content;
        }
    }

    const order = Number.parseInt(meta.order || '', 10);

    return {
        id,
        name: meta.name || id.replace(/^\d+[-_]/, ''),
        description: meta.description || '',
        order: Number.isFinite(order) ? order : 999,
        sections,
        reference: extractSection(body, '零、参考样本'),
    };
}

/**
 * 读取 vault 中全部预设；目录不存在时返回空数组
 *
 * @param app - Obsidian 应用实例
 * @returns 结果数组
 */
export async function loadStylePresets(app: App): Promise<WritingStylePreset[]> {
    const folder = app.vault.getAbstractFileByPath(STYLE_PRESET_DIR);
    if (!(folder instanceof TFolder)) return [];

    const presets: WritingStylePreset[] = [];
    for (const child of folder.children) {
        if (!(child instanceof TFile) || !child.path.endsWith('.md')) continue;
        try {
            const raw = await app.vault.read(child);
            presets.push(parseStylePreset(child.basename, raw));
        } catch {
            // 单个预设损坏不影响其余预设
        }
    }

    return presets.sort((a, b) => (a.order === b.order ? a.name.localeCompare(b.name, 'zh') : a.order - b.order));
}

export interface StylePresetDraft {
    name: string;
    description?: string;
    /** 键为「一、叙事视角」等标题；二、文笔特征下的子节用「总体风格」等键 */
    sections: Record<string, string>;
    sample?: string;
}

const PRESET_TOP_LEVEL_ORDER = [
    '一、叙事视角',
    '二、文笔特征',
    '三、对话风格',
    '四、描写风格',
    '五、叙事节奏',
    '六、情感表达方式',
    '七、禁用/慎用',
    '八、参考作品',
    '九、番茄小说格式要求',
];

function yamlQuote(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildPresetMarkdown(draft: StylePresetDraft, order: number): string {
    const lines: string[] = [
        '---',
        `name: ${yamlQuote(draft.name)}`,
        `order: ${order}`,
        `description: ${yamlQuote(draft.description || '')}`,
        '---',
        '',
        '## 零、参考样本',
        '',
        (draft.sample || '').trim() || '（暂无参考样本，可在写作风格模态中补充）',
        '',
    ];

    for (const heading of PRESET_TOP_LEVEL_ORDER) {
        if (heading === '二、文笔特征') {
            lines.push('## 二、文笔特征', '');
            for (const sub of SUB_KEYS) {
                lines.push(`### ${sub}`, '', (draft.sections[sub] || '').trim() || '—', '');
            }
            continue;
        }
        lines.push(`## ${heading}`, '', (draft.sections[heading] || '').trim() || '—', '');
    }

    return lines.join('\n').trimEnd() + '\n';
}

/**
 * 保存一个新预设到 vault 预设目录。
 * 返回落盘路径；同名预设已存在时抛错（不覆盖用户已有预设）。
 * 内容不完整（缺分节 / 分节为空 / 占位符）时同样抛错，避免写入不可用预设。
 * @param app - Obsidian 应用实例
 * @param draft - 草稿
 * @returns 文本结果
 */
export async function saveStylePreset(app: App, draft: StylePresetDraft): Promise<string> {
    const name = draft.name.trim();
    if (!name) throw new Error('预设名称不能为空');

    const existing = await loadStylePresets(app);
    if (existing.some(p => p.name.trim() === name)) {
        throw new Error(`已存在同名预设「${name}」`);
    }

    const folder = app.vault.getAbstractFileByPath(STYLE_PRESET_DIR);
    if (!(folder instanceof TFolder)) {
        await mkdirp(app, STYLE_PRESET_DIR);
    }

    const maxOrder = existing.reduce((max, p) => (Number.isFinite(p.order) && p.order < 999 ? Math.max(max, p.order) : max), 0);
    const order = maxOrder + 1;
    const fileName = `${String(order).padStart(2, '0')}-${sanitizeName(name)}.md`;
    const path = `${STYLE_PRESET_DIR}/${fileName}`;

    if (app.vault.getAbstractFileByPath(path)) {
        throw new Error(`预设文件已存在：${fileName}`);
    }

    const markdown = buildPresetMarkdown(draft, order);
    const validation = validateWritingStyleOutput(markdown);
    if (!validation.valid) {
        const missing = validation.missingFields.slice(0, 6).join('、');
        const more = validation.missingFields.length > 6 ? ' 等' : '';
        throw new Error(`预设内容不完整：${missing}${more}。请先点「AI 生成内容」或手动补全`);
    }

    await app.vault.create(path, markdown);
    return path;
}
