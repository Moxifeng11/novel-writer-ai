/**
 * 四项校验按需重算：任意正文路径都能按磁盘事实得到同一口径的结论
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { FourCheckService } from '@/engine/quality/four-check-refresh';
import { FourCheckStore } from '@/services/four-check-store';
import { DEFAULT_BODY_FORMAT } from '@/shared/body-format';
import { pjStepFile } from '@/shared/paths';

const PROJECT = '长篇小说/甲';
const CHAPTER = '第1章';
const BODY_PATH = `${PROJECT}/03-大纲与章节/正文/第1卷/第1章_正文.md`;
const IND = '\u3000\u3000';

const infoPlan = (hook: string): string => `## 章末钩子\n- 钩子类型：悬念\n- 钩子内容：${hook}\n`;

const make = (files: Record<string, string> = {}) => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    vault._seedFile(`${PROJECT}/作品信息.md`, '# 作品');
    for (const [path, text] of Object.entries(files)) vault._seedFile(path, text);
    const service = new FourCheckService(app, { resolveContract: async () => DEFAULT_BODY_FORMAT });
    return { app, service };
};

const statusOf = (report: Awaited<ReturnType<FourCheckService['refresh']>>, id: string) =>
    report.items.find(item => item.id === id)?.status;

describe('FourCheckService', () => {
    it('钩子落在末段 → 钩子通过，并写入四项校验归档', async () => {
        const body = [`${IND}他推门而入，屋里空着。`, `${IND}门外传来敲门声。`].join('\n');
        const { app, service } = make({
            [BODY_PATH]: body,
            [pjStepFile(PROJECT, 1, 1, '信息规划')]: infoPlan('门外传来敲门声'),
        });
        const report = await service.refresh({
            project: PROJECT, chapterName: CHAPTER, bodyPath: BODY_PATH, targetWords: 20, now: 1000,
        });
        expect(statusOf(report, 'hook')).toBe('pass');
        expect(statusOf(report, 'wordCount')).toBe('pass');
        const saved = await new FourCheckStore(app).view(PROJECT);
        expect(saved[CHAPTER]?.checkedAt).toBe(1000);
    });

    it('章纲声明钩子但末段没有 → 钩子只给 warn，不阻断', async () => {
        const body = `${IND}他推门而入，雨声很大。\n${IND}雨声很大。`.repeat(1) + '雨声很大。'.repeat(30);
        const { service } = make({
            [BODY_PATH]: body,
            [pjStepFile(PROJECT, 1, 1, '信息规划')]: infoPlan('门外传来敲门声'),
        });
        const report = await service.refresh({
            project: PROJECT, chapterName: CHAPTER, bodyPath: BODY_PATH, targetWords: 20,
        });
        expect(statusOf(report, 'hook')).toBe('warn');
    });

    it('没有信息规划步骤文件 → 钩子 skip（缺依据不猜结论）', async () => {
        const body = `${IND}他推门而入，屋里空着。`;
        const { service } = make({ [BODY_PATH]: body });
        const report = await service.refresh({
            project: PROJECT, chapterName: CHAPTER, bodyPath: BODY_PATH, targetWords: 20,
        });
        expect(statusOf(report, 'hook')).toBe('skip');
    });

    it('正文低于硬门禁下限 → 字数 fail', async () => {
        const body = `${IND}他走进屋。`;
        const { service } = make({ [BODY_PATH]: body });
        const report = await service.refresh({
            project: PROJECT, chapterName: CHAPTER, bodyPath: BODY_PATH, targetWords: 100,
        });
        expect(statusOf(report, 'wordCount')).toBe('fail');
    });

    it('格式偏离 → 只提示 warn（落盘已规整）', async () => {
        const body = '他走进屋。\n雨停了。';
        const { service } = make({ [BODY_PATH]: body });
        const report = await service.refresh({
            project: PROJECT, chapterName: CHAPTER, bodyPath: BODY_PATH, targetWords: 5,
        });
        expect(statusOf(report, 'format')).toBe('warn');
    });

    it('人称混用 → warn，复用一致性审核同一口径', async () => {
        const body = '我走进屋。我走进屋。我走进屋。他走进屋。他走进屋。他走进屋。';
        const { service } = make({ [BODY_PATH]: body });
        const report = await service.refresh({
            project: PROJECT, chapterName: CHAPTER, bodyPath: BODY_PATH, targetWords: 5,
        });
        expect(statusOf(report, 'perspective')).toBe('warn');
    });

    it('项目不存在 / 正文为空 → 明确抛错', async () => {
        const { service } = make({ [BODY_PATH]: `${IND}他走进屋。` });
        await expect(service.refresh({ project: '长篇小说/不存在', chapterName: CHAPTER }))
            .rejects.toThrow('项目不存在或不是作品目录');
        await expect(service.refresh({ project: PROJECT, chapterName: CHAPTER, body: '   ' }))
            .rejects.toThrow('正文为空');
    });
});