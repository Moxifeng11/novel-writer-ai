import { describe, expect, it } from 'vitest';
import { Vault } from '../../__mocks__/obsidian';
import { collectBackupCenter } from '../../../services/backup-center-service';

const P = '长篇小说/备份书';

function seedVersion(vault: Vault, key: string, version: number): void {
    const dir = `${P}/_versions/chapter/${key}`;
    vault._seedFile(`${dir}/versions.json`, JSON.stringify({
        latestVersion: version,
        versions: [{
            id: `v_${key}_${version}`,
            version,
            createdAt: '2026-11-05T10:00:00.000Z',
            type: 'manual',
            contentType: 'chapter',
            wordCount: 1000,
            wordCountDelta: 100,
            lineCount: 20,
            tags: [],
            note: '',
            project: P,
            contentKey: key,
            sourcePath: `${P}/03-大纲与章节/正文/第1卷/${key}_正文.md`,
            versionPath: `${dir}/v_${key}_${version}.md`,
        }],
    }, null, 2));
    vault._seedFile(`${dir}/v_${key}_${version}.md`, '# 快照');
}

describe('collectBackupCenter — 版本与备份中心', () => {
    it('聚合版本快照、步骤产物与配置备份', async () => {
        const vault = new Vault();
        seedVersion(vault, '第1章', 2);
        seedVersion(vault, '第2章', 1);
        vault._seedFile(`${P}/03-大纲与章节/步骤结果/第1卷/第1章/第1章_结算表.md`, '# 结算');
        vault._seedFile(`${P}/03-大纲与章节/步骤结果/第1卷/第1章/第1章_质量控制.md`, '# 质控');
        vault._seedFile('.obsidian/plugins/novel-writer-ai/data/data.json.bak', '{}');

        const report = await collectBackupCenter({ vault } as never, P);

        expect(report.project).toBe(P);
        expect(report.summary.version).toBe(2);
        expect(report.summary['step-result']).toBe(2);
        expect(report.summary['settings-backup']).toBe(1);
        const versionEntry = report.entries.find(entry => entry.kind === 'version');
        expect(versionEntry?.version?.version).toBe(2);
        expect(versionEntry?.version?.sourcePath).toContain('第1章_正文.md');
        expect(report.entries.some(entry => entry.path.endsWith('data.json.bak'))).toBe(true);
    });

    it('没有历史时返回空清单', async () => {
        const vault = new Vault();
        const report = await collectBackupCenter({ vault } as never, P);
        expect(report.entries).toEqual([]);
        expect(report.rollbackCount).toBe(0);
    });

    it('SEC-11：配置备份文案按密钥形态说真话（明文必须警告）', async () => {
        const plainVault = new Vault();
        plainVault._seedFile('.obsidian/plugins/novel-writer-ai/data/data.json.bak', JSON.stringify({
            apiKey: 'sk-plain-demo',
        }));
        const plain = await collectBackupCenter({ vault: plainVault } as never, P);
        const plainEntry = plain.entries.find(entry => entry.kind === 'settings-backup');
        expect(plainEntry?.label).toContain('明文密钥');
        expect(plainEntry?.detail).toContain('含明文 API Key');
        expect(plainEntry?.detail).not.toContain('密钥为密文');

        const encryptedVault = new Vault();
        encryptedVault._seedFile('.obsidian/plugins/novel-writer-ai/data/data.json.bak', JSON.stringify({
            apiKey: 'aes256v2:iv:cipher',
        }));
        const encrypted = await collectBackupCenter({ vault: encryptedVault } as never, P);
        const encryptedEntry = encrypted.entries.find(entry => entry.kind === 'settings-backup');
        expect(encryptedEntry?.label).toBe('data.json.bak');
        expect(encryptedEntry?.detail).toContain('密钥为密文');
        expect(encryptedEntry?.detail).not.toContain('明文');
    });

    it('SEC-1 残留：伪造索引条目（越界 sourcePath / contentKey 穿越）被过滤', async () => {
        const vault = new Vault();
        seedVersion(vault, '第1章', 1);
        // 伪造：sourcePath 指向插件数据（读取泄漏），versionPath 越界
        const evilDir = `${P}/_versions/chapter/evil`;
        vault._seedFile(`${evilDir}/versions.json`, JSON.stringify({
            latestVersion: 1,
            versions: [{
                id: 'v_evil', version: 1, createdAt: '2026-11-05T10:00:00.000Z',
                type: 'manual', contentType: 'chapter', wordCount: 1, wordCountDelta: 0,
                lineCount: 1, tags: [], note: '', project: P,
                contentKey: '../../.obsidian/plugins/novel-writer-ai/data',
                sourcePath: '.obsidian/plugins/novel-writer-ai/data/data.json',
                versionPath: '../../../main.js',
            }],
        }, null, 2));

        const report = await collectBackupCenter({ vault } as never, P);
        expect(report.summary.version).toBe(1);
        const labels = report.entries.filter(entry => entry.kind === 'version').map(entry => entry.label);
        expect(labels.some(label => label.includes('evil'))).toBe(false);
        expect(labels.some(label => label.includes('第1章'))).toBe(true);
    });
});
