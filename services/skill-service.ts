/**
 * skill-service.ts — 自定义 Skill 扫描与匹配
 *
 * 扫描 vault 根 `技能/*.md`，解析成 SkillDefinition；带缓存，可主动失效。
 */

import { App, TFile, TFolder } from 'obsidian';
import { createLogger } from '@/shared/logger';
import { parseSkillFile, SKILL_DIR, type SkillDefinition } from '@/shared/skill-model';

const log = createLogger('SkillService');

/**
 * Skill 服务：扫描/列出/匹配。
 */
export class SkillService {
    private cache: SkillDefinition[] | null = null;

    /**
     * @param app - Obsidian 应用
     */
    constructor(private readonly app: App) {}

    /**
     * 列出全部 skill（带缓存）。
     *
     * @param force - 是否强制重新扫描
     * @returns skill 列表
     */
    async list(force = false): Promise<SkillDefinition[]> {
        if (this.cache && !force) return this.cache;
        const folder = this.app.vault.getAbstractFileByPath(SKILL_DIR);
        if (!(folder instanceof TFolder)) {
            this.cache = [];
            return this.cache;
        }
        const skills: SkillDefinition[] = [];
        for (const child of folder.children) {
            if (!(child instanceof TFile) || !child.path.toLowerCase().endsWith('.md')) continue;
            try {
                const parsed = parseSkillFile(await this.app.vault.read(child), child.path);
                if (parsed) skills.push(parsed);
            } catch (error) {
                // silent-ok: 单个 skill 读取失败跳过，不影响其它技能与会话
                log.warn('skill 读取失败:', child.path, error);
            }
        }
        this.cache = skills.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
        return this.cache;
    }

    /**
     * 清空缓存（文件变动后调用）。
     */
    invalidate(): void {
        this.cache = null;
    }

    /**
     * 按 id/名称取 skill。
     *
     * @param id - 名称或路径
     * @returns skill 或 null
     */
    async get(id: string): Promise<SkillDefinition | null> {
        const needle = String(id || '').trim().toLowerCase();
        if (!needle) return null;
        const skills = await this.list();
        return skills.find(skill => skill.name.toLowerCase() === needle || skill.path.toLowerCase() === needle)
            ?? skills.find(skill => skill.name.toLowerCase().includes(needle))
            ?? null;
    }
}
