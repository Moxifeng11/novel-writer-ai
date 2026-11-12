/**
 * 项目创建失败必须可感知（回归锁 · 测试标准 3 · DSH-20261113-27）
 *
 * 真实缺陷：`createLongNovelProject` 里写 `.project` 的 try/catch 只 log.warn，
 * 于是 `.project` 写失败时仍走到 `new Notice('✅ 项目「X」创建完成')` ——
 * 项目对插件根本不存在（没有 .project 就不是项目），用户却以为建好了。
 *
 * 本文件锁定：`.project` 写失败 → `created: false` 且原因可读。
 * 若谁把 catch 改回「只 log」，这里会红。
 */

import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { Vault } from 'obsidian';
import { createLongNovelProject } from '../../../ui/services/project-create-service';

/** 只让 `.project` 的创建失败，其余照常 */
function makeAppWithFailingProjectMeta(): { app: App; vault: Vault } {
    const vault = new Vault();
    const originalCreate = vault.create.bind(vault);
    (vault as unknown as { create: typeof vault.create }).create = async (path: string, data: string) => {
        if (path.endsWith('/.project')) throw new Error('disk full（模拟磁盘满/只读）');
        return originalCreate(path, data);
    };
    return { app: { vault } as unknown as App, vault };
}

describe('createLongNovelProject — 关键写入失败必须中止（回归锁）', () => {
    it('.project 写失败 → created=false 且原因可读（曾经提示「创建完成」）', async () => {
        const { app } = makeAppWithFailingProjectMeta();
        const plugin = {
            engineRegistry: { get: () => null },
            settings: {},
        } as never;

        const result = await createLongNovelProject(app, plugin, {
            projectName: '回归测试项目',
            genre: '都市',
            projectType: 'original',
            creationMeta: { mode: 'long' },
        } as never);

        expect(result.created).toBe(false);
        expect(String(result.reason || '')).toContain('.project');
    });
});
