/**
 * skill-tools.ts — 自定义 Skill 相关 Agent 工具
 *
 * list_skills：列出可用技能（名称/触发条件/说明）
 * use_skill：取某个技能的完整提示词，供当前回合遵循
 */

import type { SkillDefinition } from '@/shared/skill-model';
import type { HarnessTool } from './harness-types';

/**
 * 创建 skill 工具集。
 *
 * @param getSkills - 取技能列表（懒加载，避免装配期 IO）
 * @returns 工具数组
 */
export function createSkillTools(getSkills: () => Promise<SkillDefinition[]>): HarnessTool[] {
    return [
        {
            name: 'list_skills',
            kind: 'read',
            description: '列出用户配置的自定义技能（技能/ 目录）。技能是一段写作方法论或流程提示，命中时已自动注入；需要主动查看某技能内容时用 use_skill。',
            parameters: {},
            required: [],
            sideEffect: 'none',
            timeoutMs: 10_000,
            execute: async () => {
                const skills = await getSkills();
                if (skills.length === 0) {
                    return { ok: true, content: '用户还没有配置自定义技能（技能/ 目录为空）。', data: { count: 0 } };
                }
                const lines = skills.map(skill => `- ${skill.name}${skill.when ? `（触发：${skill.when}）` : ''}${skill.description ? `：${skill.description}` : ''}`);
                return { ok: true, content: `可用技能（${skills.length}）：\n${lines.join('\n')}`, data: { count: skills.length } };
            },
        },
        {
            name: 'use_skill',
            kind: 'read',
            description: '读取某个自定义技能的完整内容并按其流程执行（如「场景描写」「对话打磨」）。',
            parameters: {
                name: { type: 'string', description: '技能名称（list_skills 可查）', required: true },
            },
            required: ['name'],
            sideEffect: 'none',
            timeoutMs: 10_000,
            execute: async (args) => {
                const needle = String(args.name || '').trim().toLowerCase();
                const skills = await getSkills();
                const skill = skills.find(item => item.name.toLowerCase() === needle)
                    ?? skills.find(item => item.name.toLowerCase().includes(needle));
                if (!skill) {
                    const names = skills.map(item => item.name).join('、') || '（无）';
                    return { ok: false, content: `找不到技能「${args.name}」。可用：${names}` };
                }
                return {
                    ok: true,
                    content: `【技能：${skill.name}】\n${skill.description ? `${skill.description}\n` : ''}${skill.prompt}`,
                    data: { name: skill.name, path: skill.path },
                };
            },
        },
    ];
}
