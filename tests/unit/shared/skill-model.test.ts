/**
 * 自定义 Skill 模型与工具测试
 */

import { describe, expect, it } from 'vitest';
import {
    matchSkills,
    parseSkillFile,
    renderSkillsSection,
    SKILL_DIR,
    skillMatches,
} from '@/shared/skill-model';
import { createSkillTools } from '@/engine/agent/harness/skill-tools';

const SAMPLE = `---
name: 场景描写
description: 需要环境/氛围描写时使用
when: 场景|环境|氛围
tools: read_file, patch_file
---

写场景时先定「五感锚点」，再补一个能承载情绪的物件。`;

describe('parseSkillFile', () => {
    it('解析 frontmatter 与正文', () => {
        const skill = parseSkillFile(SAMPLE, `${SKILL_DIR}/场景.md`);
        expect(skill?.name).toBe('场景描写');
        expect(skill?.when).toBe('场景|环境|氛围');
        expect(skill?.tools).toEqual(['read_file', 'patch_file']);
        expect(skill?.prompt).toContain('五感锚点');
    });

    it('无 frontmatter 时用文件名当名称', () => {
        const skill = parseSkillFile('直接写提示词', `${SKILL_DIR}/对话打磨.md`);
        expect(skill?.name).toBe('对话打磨');
        expect(skill?.when).toBe('');
    });

    it('空正文返回 null', () => {
        expect(parseSkillFile('---\nname: x\n---\n\n', 'a.md')).toBeNull();
    });

    it('CRLF 也能解析', () => {
        const skill = parseSkillFile(SAMPLE.replace(/\n/g, '\r\n'), 'a.md');
        expect(skill?.name).toBe('场景描写');
    });
});

describe('skillMatches / matchSkills', () => {
    const skill = parseSkillFile(SAMPLE, 'a.md')!;

    it('命中关键词', () => {
        expect(skillMatches(skill, '帮我写一段战斗场景')).toBe(true);
    });

    it('未命中返回 false', () => {
        expect(skillMatches(skill, '帮我列章节')).toBe(false);
    });

    it('空 when 不命中', () => {
        expect(skillMatches({ ...skill, when: '' }, '场景')).toBe(false);
    });

    it('正则写错按不命中处理', () => {
        expect(skillMatches({ ...skill, when: '([' }, '场景')).toBe(false);
    });

    it('matchSkills 过滤出命中项', () => {
        const other = parseSkillFile('---\nname: 对话\nwhen: 对话|台词\n---\n正文', 'b.md')!;
        expect(matchSkills([skill, other], '场景描写').map(item => item.name)).toEqual(['场景描写']);
    });
});

describe('renderSkillsSection', () => {
    it('无技能返回空串', () => {
        expect(renderSkillsSection([])).toBe('');
    });

    it('包含名称与正文', () => {
        const text = renderSkillsSection([parseSkillFile(SAMPLE, 'a.md')!]);
        expect(text).toContain('场景描写');
        expect(text).toContain('五感锚点');
    });
});

describe('skill 工具', () => {
    const skills = [parseSkillFile(SAMPLE, `${SKILL_DIR}/场景.md`)!];
    const getSkills = async () => skills;

    it('list_skills 列出名称与触发条件', async () => {
        const tool = createSkillTools(getSkills).find(item => item.name === 'list_skills')!;
        const result = await tool.execute({}, {} as never);
        expect(result.ok).toBe(true);
        expect(result.content).toContain('场景描写');
        expect(result.content).toContain('场景|环境|氛围');
    });

    it('无技能时提示为空', async () => {
        const tool = createSkillTools(async () => []).find(item => item.name === 'list_skills')!;
        const result = await tool.execute({}, {} as never);
        expect(result.content).toContain('还没有配置');
    });

    it('use_skill 返回完整提示词', async () => {
        const tool = createSkillTools(getSkills).find(item => item.name === 'use_skill')!;
        const result = await tool.execute({ name: '场景描写' }, {} as never);
        expect(result.ok).toBe(true);
        expect(result.content).toContain('五感锚点');
    });

    it('use_skill 找不到时列出可用技能', async () => {
        const tool = createSkillTools(getSkills).find(item => item.name === 'use_skill')!;
        const result = await tool.execute({ name: '不存在' }, {} as never);
        expect(result.ok).toBe(false);
        expect(result.content).toContain('场景描写');
    });

    it('两个工具都是只读', () => {
        for (const tool of createSkillTools(getSkills)) expect(tool.kind).toBe('read');
    });
});
