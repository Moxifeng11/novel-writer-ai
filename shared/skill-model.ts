/**
 * skill-model.ts — 自定义 Skill 模型（纯函数）
 *
 * Skill 是一个 Markdown 文件（vault 根 `技能/` 目录），frontmatter 声明元数据：
 *
 * ```md
 * ---
 * name: 场景描写
 * description: 需要环境/氛围描写时使用
 * when: 场景|环境|氛围
 * tools: read_file,patch_file
 * ---
 * 提示词正文……
 * ```
 *
 * - `when`：正则（不区分大小写），命中用户输入时把正文注入系统提示
 * - `tools`：可选，声明该 skill 只用这些工具（仅作提示，不强制）
 */

/** Skill 定义 */
export interface SkillDefinition {
    /** 文件路径（vault 相对） */
    path: string;
    /** 名称（缺省取文件名） */
    name: string;
    /** 一句话说明 */
    description: string;
    /** 触发正则（字符串形式；空表示只能手动使用） */
    when: string;
    /** 提示词正文 */
    prompt: string;
    /** 建议工具白名单 */
    tools: string[];
}

/** Skill 目录（vault 根，全库共享） */
export const SKILL_DIR = '技能';

/** frontmatter 最大行数（防止异常文件拖慢扫描） */
const MAX_FRONTMATTER_LINES = 40;

/**
 * 解析 frontmatter + 正文。
 *
 * @param raw - 文件全文
 * @param path - 文件路径（用于兜底名称）
 * @returns Skill 定义或 null（无正文）
 */
export function parseSkillFile(raw: string, path = ''): SkillDefinition | null {
    const text = String(raw ?? '').replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    let meta: Record<string, string> = {};
    let bodyStart = 0;
    if (lines[0]?.trim() === '---') {
        for (let i = 1; i < Math.min(lines.length, MAX_FRONTMATTER_LINES); i++) {
            if (lines[i].trim() === '---') {
                bodyStart = i + 1;
                break;
            }
            const match = lines[i].match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
            if (match) meta[match[1].toLowerCase()] = match[2].trim().replace(/^["']|["']$/g, '');
        }
    }
    const prompt = lines.slice(bodyStart).join('\n').trim();
    if (!prompt) return null;
    const fallbackName = path.split('/').pop()?.replace(/\.md$/i, '') || '未命名技能';
    return {
        path,
        name: meta.name || fallbackName,
        description: meta.description || '',
        when: meta.when || '',
        prompt,
        tools: (meta.tools || '').split(/[,，\s]+/).filter(Boolean),
    };
}

/**
 * 判断 skill 是否命中一段用户输入。
 *
 * @param skill - skill
 * @param text - 用户输入
 * @returns 命中返回 true
 */
export function skillMatches(skill: SkillDefinition, text: string): boolean {
    if (!skill.when) return false;
    const input = String(text ?? '');
    if (!input.trim()) return false;
    try {
        return new RegExp(skill.when, 'i').test(input);
    } catch {
        // silent-ok: when 写错正则时按「不命中」处理，不影响其它 skill
        return false;
    }
}

/**
 * 从候选里挑出命中的 skill。
 *
 * @param skills - 全部 skill
 * @param text - 用户输入
 * @returns 命中的 skill
 */
export function matchSkills(skills: readonly SkillDefinition[], text: string): SkillDefinition[] {
    return skills.filter(skill => skillMatches(skill, text));
}

/**
 * 渲染注入系统提示的 skill 段。
 *
 * @param skills - 要注入的 skill
 * @returns 提示词段落（无命中返回空串）
 */
export function renderSkillsSection(skills: readonly SkillDefinition[]): string {
    if (skills.length === 0) return '';
    const blocks = skills.map(skill => `### 技能：${skill.name}\n${skill.description ? `${skill.description}\n` : ''}${skill.prompt}`);
    return `【已启用的自定义技能（按用户当前需求自动注入）】\n${blocks.join('\n\n')}`;
}
