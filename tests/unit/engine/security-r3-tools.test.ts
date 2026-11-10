/**
 * S3-5 / S3-6（安全 r3）回归：
 * 1. dsh 启动计划剔除调用方夹带的凭据环境变量（凭据只能显式注入）；
 * 2. write_file 布尔参数严格化——"true" 字符串被拒绝，不再静默退化成覆盖写；
 * 3. 审批探测与锁内写入之间出现新文件 → 拒绝并要求重新确认（TOCTOU）；
 * 4. 信任配置/项目身份路径不允许自动放行新建。
 */

import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validateArgs } from '../../../engine/agent/harness/tool-registry';
import type { HarnessTool } from '../../../engine/agent/harness/harness-types';
import { buildDshLaunchPlan, CREDENTIAL_ENV_KEYS } from '../../../engine/agent/dsh/dsh-launch';
import { isSensitiveAutoApprovePath, shouldAutoApproveNewFile } from '../../../shared/file-path-guard';
import { createAgentPort } from '../../../ui/services/agent-port';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('S3-5 dsh 凭据环境变量剔除', () => {
    it('options.env 里的凭据键被剔除，显式 apiKey 仍注入', () => {
        const plan = buildDshLaunchPlan({
            home: '/h',
            workspace: '/v',
            sandbox: 'read-only',
            apiKey: 'sk-deepseek',
            env: {
                PATH: '/bin',
                DEEPSEEK_API_KEY: 'sk-evil',
                OPENAI_API_KEY: 'sk-openai',
                MY_SERVICE_TOKEN: 'tok',
                APP_SECRET: 'sec',
                AUTHORIZATION: 'Bearer x',
            },
        });

        expect(plan.env.DEEPSEEK_API_KEY).toBe('sk-deepseek');
        expect(plan.env.OPENAI_API_KEY).toBeUndefined();
        expect(plan.env.MY_SERVICE_TOKEN).toBeUndefined();
        expect(plan.env.APP_SECRET).toBeUndefined();
        expect(plan.env.AUTHORIZATION).toBeUndefined();
        expect(plan.env.PATH).toBe('/bin');
    });

    it('CREDENTIAL_ENV_KEYS 覆盖常见后缀', () => {
        expect(CREDENTIAL_ENV_KEYS.test('OPENAI_API_KEY')).toBe(true);
        expect(CREDENTIAL_ENV_KEYS.test('GITHUB_TOKEN')).toBe(true);
        expect(CREDENTIAL_ENV_KEYS.test('DSH_HOME')).toBe(false);
    });
});

describe('S3-6 write_file 布尔严格化', () => {
    const tool: HarnessTool = {
        name: 'write_file',
        description: '写入',
        parameters: {
            path: { type: 'string', description: '路径' },
            content: { type: 'string', description: '内容' },
            append: { type: 'boolean', description: '追加' },
        },
        required: ['path', 'content'],
        sideEffect: 'write',
        execute: async () => ({ ok: true, content: '' }),
    };

    it('字符串 "true" 被拒绝并提示改法', () => {
        const error = validateArgs(tool, { path: 'a.md', content: 'x', append: 'true' });
        expect(error).toContain('必须是布尔值');
        expect(error).toContain('不要传字符串');
    });

    it('真布尔值通过', () => {
        expect(validateArgs(tool, { path: 'a.md', content: 'x', append: true })).toBeNull();
        expect(validateArgs(tool, { path: 'a.md', content: 'x' })).toBeNull();
    });
});

describe('S3-6 审批探测与锁内写入（TOCTOU）', () => {
    it('审批后目标出现 → 拒绝写入并要求重新确认', async () => {
        const writes: string[] = [];
        const targetExistsCalls = new Map<string, number>();
        const app = {
            vault: {
                adapter: {
                    exists: vi.fn(async (p: string) => {
                        // 目标路径：第一次（审批探测）不存在；第二次（锁内重查）已出现
                        const calls = (targetExistsCalls.get(p) || 0) + 1;
                        targetExistsCalls.set(p, calls);
                        return calls >= 2;
                    }),
                    read: async () => '',
                    write: async (_p: string, data: string) => { writes.push(data); },
                    mkdir: async () => undefined,
                },
                getAbstractFileByPath: () => null,
                getFiles: () => [],
                getAllFolders: () => [],
                getMarkdownFiles: () => [],
                getRoot: () => ({ children: [] }),
            },
            fileManager: { renameFile: async () => undefined },
        };
        const plugin = { getActiveProject: () => '长篇小说/书A' };
        const port = createAgentPort(app as never, plugin as never);

        // 审批时不存在（第 1 次 exists=false）→ 锁内重查出现（第 2 次 true）→ 拒绝
        await expect(port.writeFile?.('长篇小说/书A/正文.md', '内容')).rejects.toThrow('请重新确认');
        expect(writes).toHaveLength(0);
    });
});

describe('S3-6 敏感路径不自动放行', () => {
    it('信任配置与项目身份路径被拦截', () => {
        expect(isSensitiveAutoApprovePath('长篇小说/书A/05-同人设定库/_资料/作品X/sources.json')).toBe(true);
        expect(isSensitiveAutoApprovePath('长篇小说/书A/00-系统模板/写作规则.md')).toBe(true);
        expect(isSensitiveAutoApprovePath('长篇小说/书A/04-项目总控/信息债看板.md')).toBe(true);
        expect(isSensitiveAutoApprovePath('长篇小说/书A/.project')).toBe(true);
        expect(isSensitiveAutoApprovePath('长篇小说/书A/03-大纲与章节/正文/第1卷/第1章_正文.md')).toBe(true);
    });

    it('普通新文件仍可自动放行（文件不存在时）', async () => {
        expect(await shouldAutoApproveNewFile('长篇小说/书A/随笔.md', async () => false, '长篇小说/书A')).toBe(true);
        expect(await shouldAutoApproveNewFile('长篇小说/书A/00-系统模板/新文件.md', async () => false, '长篇小说/书A')).toBe(false);
    });

    it('接线契约：自动放行入口走敏感路径判定', () => {
        const guard = read('shared/file-path-guard.ts');
        expect(guard).toContain('if (isSensitiveAutoApprovePath(raw)) return false;');
    });
});
