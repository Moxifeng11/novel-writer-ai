/**
 * 主角识别（纯函数）。
 *
 * 人物「身份」字段可能是字符串或数组，且历史数据里有「主角」「主人公」两种写法。
 * 协同写作（按人物文件名判定）与场景兜底扩写（按内存人物列表判定）共用这里的判断，
 * 避免两处口径漂移。
 */

/**
 * 判断「身份」字段是否指向主角
 *
 * @param role - 角色
 * @returns 是否成功
 */
export function roleIndicatesProtagonist(role: unknown): boolean {
    const text = Array.isArray(role) ? role.join('') : String(role ?? '');
    return text.includes('主角') || text.includes('主人公');
}

/**
 * 从人物 frontmatter 列表里取主角名；找不到返回空串
 *
 * @param characters - 角色列表
 * @returns 文本结果
 */
export function findProtagonistName(
    characters: Array<Record<string, unknown>> | undefined | null,
): string {
    if (!characters || characters.length === 0) return '';

    for (const c of characters) {
        if (!roleIndicatesProtagonist(c['身份'])) continue;
        const raw = c.name ?? c['姓名'] ?? c.fileName;
        if (typeof raw !== 'string') continue;
        const name = raw.trim().replace(/\.md$/, '');
        if (name) return name;
    }
    return '';
}
