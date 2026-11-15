/**
 * 写作效果基线采集服务（注入测试用假 AI，不产生真实费用）
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { BaselineProbeService } from '@/services/baseline-probe-service';

const WORLDVIEW = ['# 世界观总览', '', '## 灵气体系', '灵气分九品。'.repeat(20), '', '## 地理', '东荒、南岭。'.repeat(10)].join('\n');
const SETTING = ['# 设定库', '', '## 修炼境界', '练气、筑基。'.repeat(10), '', '## 货币', '灵石、灵晶。'.repeat(10)].join('\n');
const CHAR = (id: string, name: string) => ['---', `id: ${id}`, 'type: character', '---', '', `# ${name}`, '', `${name}的设定。`].join('\n');
const SCENE = ['## 场景1：测灵台前', '', '- 在场人物：林玄、苏婉', '- 冲突：测试'].join('\n');

const make = (callImpl?: (s: string, u: string, m?: string) => Promise<unknown>) => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    const base = '长篇小说/测试';
    vault._seedFile(`${base}/01-世界架构/世界观总览.md`, WORLDVIEW);
    vault._seedFile(`${base}/01-世界架构/设定库.md`, SETTING);
    vault._seedFile(`${base}/01-世界架构/人物/CHR-0001_林玄.md`, CHAR('CHR-0001', '林玄'));
    vault._seedFile(`${base}/01-世界架构/人物/CHR-0002_苏婉.md`, CHAR('CHR-0002', '苏婉'));
    vault._seedFile(`${base}/02-时间线与伏笔/时间线看板.md`, '| 0012 | 入门 | 第1章 | 山门 | 林玄 |');
    vault._seedFile(`${base}/02-时间线与伏笔/伏笔库.md`, '| 断剑来历 | 第1章 | 第8章 |');
    vault._seedFile(`${base}/03-大纲与章节/分卷大纲/第1卷_分卷大纲.md`, '## 第1章\n- 核心事件：入门');
    vault._seedFile(`${base}/03-大纲与章节/步骤结果/第1卷/第1章/第1章_Scene展开.md`, SCENE);
    const calls: Array<{ user: string }> = [];
    const call = callImpl ?? (async (_s: string, user: string) => {
        calls.push({ user });
        return { content: 'ok', usage: { prompt: Math.ceil(user.length / 2), completion: 5, total: Math.ceil(user.length / 2) + 5 } };
    });
    const service = new BaselineProbeService(app, { settings: { flashModel: 'm-test' } }, call as never);
    return { service, calls, base };
};

describe('BaselineProbeService', () => {
    it('两种策略各调一次并计算下降比', async () => {
        const { service, calls, base } = make();
        const result = await service.probe(base, '第1章');
        expect(calls).toHaveLength(2);
        expect(result.model).toBe('m-test');
        expect(result.full.chars).toBeGreaterThan(result.scene.chars);
        expect(result.full.promptTokens).toBeGreaterThan(0);
        expect(result.scene.promptTokens).toBeGreaterThan(0);
        expect(result.reductionPercent).toBeGreaterThan(0);
        expect(result.report).toContain('下降');
    });

    it('场景提示只带在场人物', async () => {
        let sceneUser = '';
        const { service, base } = make(async (_s, user) => {
            if (user.includes('【当前场景】')) sceneUser = user;
            return { content: 'ok', usage: { prompt: 10, completion: 2, total: 12 } };
        });
        await service.probe(base, '第1章');
        expect(sceneUser).toContain('【在场人物】');
        expect(sceneUser).toContain('林玄');
        expect(sceneUser).not.toContain('陈默');
    });

    it('AI 报错时返回 error 且不抛', async () => {
        const { service, base } = make(async () => ({ content: '', error: '401 未授权' }));
        const result = await service.probe(base, '第1章');
        expect(result.full.error).toBe('401 未授权');
        expect(result.reductionPercent).toBe(0);
    });

    it('异常抛出也被兜住', async () => {
        const { service, base } = make(async () => { throw new Error('网络断开'); });
        const result = await service.probe(base, '第1章');
        expect(result.scene.error).toContain('网络断开');
    });
});
