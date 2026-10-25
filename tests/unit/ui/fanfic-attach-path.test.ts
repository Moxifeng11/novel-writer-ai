import { describe, it, expect } from 'vitest';
import { Vault } from 'obsidian';

import { attachFanficPathToProject } from '../../../ui/full-writer/fanfic-settings-utils';

/**
 * 「添加同人设定」弹窗新增了「绑定已有文件」入口，与向导共用唯一写入口
 * attachFanficPathToProject。这里锁定 `.project` 的写入语义：
 * 缺文件时创建并标记 fanfic、已有段落时原地替换（不重复追加）、无段落时追加。
 */

function makeApp() {
    const vault = new Vault();
    return { app: { vault } as any, vault };
}

const PROJECT = '遮天';
const META = '遮天/.project';
const OLD_PATH = '遮天/05-同人设定库/旧设定.md';
const NEW_PATH = '遮天/05-同人设定库/遮天设定.md';

function readMeta(vault: Vault): Promise<string> {
    return vault.adapter.read(META);
}

describe('attachFanficPathToProject — 绑定已有设定文件', () => {
    it('.project 不存在时创建并写入 fanfic 类型与路径', async () => {
        const { app, vault } = makeApp();
        await attachFanficPathToProject(app, PROJECT, NEW_PATH);

        const raw = await readMeta(vault);
        expect(raw).toContain('# 遮天');
        expect(raw).toContain('## 类型');
        expect(raw).toContain('fanfic');
        expect(raw).toContain(`## 同人设定路径\n${NEW_PATH}`);
    });

    it('已有同人设定路径时原地替换，不重复追加段落', async () => {
        const { app, vault } = makeApp();
        await vault.create(META, `# 遮天\n\n## 类型\nfanfic\n\n## 同人设定路径\n${OLD_PATH}\n`);

        await attachFanficPathToProject(app, PROJECT, NEW_PATH);

        const raw = await readMeta(vault);
        expect(raw).toContain(NEW_PATH);
        expect(raw).not.toContain(OLD_PATH);
        expect(raw.match(/## 同人设定路径/g)?.length).toBe(1);
        expect(raw).toContain('## 类型');
    });

    it('有 .project 但没有该段落时追加，保留原有内容', async () => {
        const { app, vault } = makeApp();
        await vault.create(META, '# 遮天\n\n## 类型\nfanfic\n');

        await attachFanficPathToProject(app, PROJECT, NEW_PATH);

        const raw = await readMeta(vault);
        expect(raw).toContain('## 类型\nfanfic');
        expect(raw).toContain(`## 同人设定路径\n${NEW_PATH}`);
    });

    it('重复绑定同一路径是幂等的', async () => {
        const { app, vault } = makeApp();
        await attachFanficPathToProject(app, PROJECT, NEW_PATH);
        const first = await readMeta(vault);

        await attachFanficPathToProject(app, PROJECT, NEW_PATH);

        const second = await readMeta(vault);
        expect(second).toBe(first);
        expect(second.match(/## 同人设定路径/g)?.length).toBe(1);
    });
});
