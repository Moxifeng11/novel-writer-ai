import { describe, expect, it } from 'vitest';
import { Vault } from '../../__mocks__/obsidian';
import { analyzeProjectHealth } from '../../../services/project-health-service';

function makeApp(vault: Vault) {
    return {
        vault,
        metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    } as never;
}

const P = '长篇小说/体检书';
const BODY = `${P}/03-大纲与章节/正文/第1卷`;

function body(status: string, bodyText: string): string {
    return `---\nstatus: ${status}\nword_count: 2000\n---\n\n# 第1章 测试\n\n${bodyText}`;
}

describe('analyzeProjectHealth — 项目体检 MVP', () => {
    it('命中重复正文、未结算、frontmatter 异常与正文目录孤儿文件', async () => {
        const vault = new Vault();
        const longText = '正文'.repeat(900);
        vault._seedFile(`${BODY}/第1章_正文.md`, body('written', longText));
        vault._seedFile(`${BODY}/第1章_副本_正文.md`, body('settled', longText));
        vault._seedFile(`${BODY}/第2章_正文.md`, '---\nstatus: written\n'); // 未闭合 frontmatter
        vault._seedFile(`${BODY}/第3章_备份.md`, '旧备份');
        const app = makeApp(vault);

        const report = await analyzeProjectHealth(app, P);

        expect(report.mode).toBe('long');
        expect(report.checkedBodies).toBe(3);
        expect(report.summary['duplicate-body']).toBe(2);
        expect(report.summary.unsettled).toBeGreaterThanOrEqual(1);
        expect(report.summary['bad-frontmatter']).toBeGreaterThanOrEqual(1);
        expect(report.summary['orphan-body']).toBe(1);
        expect(report.issues.every(issue => issue.path.startsWith(P))).toBe(true);
    });

    it('已结算且无重复/异常时报告为空', async () => {
        const vault = new Vault();
        vault._seedFile(`${BODY}/第1章_正文.md`, body('settled', '正文'.repeat(900)));
        const report = await analyzeProjectHealth(makeApp(vault), P);

        expect(report.checkedBodies).toBe(1);
        expect(report.issues).toEqual([]);
        expect(report.summary).toEqual({
            'duplicate-body': 0,
            unsettled: 0,
            'bad-frontmatter': 0,
            'orphan-body': 0,
        });
    });
});
