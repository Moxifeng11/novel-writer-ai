/**
 * 协议行剥离的开关行为（2026-11-28 实测缺陷回归）
 *
 * 缺陷：`StepResultSaver` 此前**无条件**调用 `splitProtocolLines(content)`。
 * 当 `structuredChangeLines` 关闭时 prompt 里并没有这份指令，此时仍做剥离很危险：
 * 用户正文里本来就可能出现 `CR|...` 形态的行（表格、列举、剧本格式），
 * 会被误当协议行从正文摘掉，正文静默缺内容。
 *
 * 本测试锁死两侧行为：
 * - 开关关：正文原样落盘（`CR|…` 行保留）
 * - 开关开：协议行被剥离，并生成「.协议行待确认.md」
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { StepResultSaver } from '../../../engine/step-result-saver';
import { MockFileSystem } from '../../../shared/file-system-port';
import { PROJECT_IDENTITY_MARKERS } from '../../../shared/project-catalog';

/** 递归列出 mock fs 里的所有文件路径 */
async function listAllPaths(fs: MockFileSystem, dir = '测试项目'): Promise<string[]> {
    const out: string[] = [];
    const files = await fs.listFiles(dir);
    for (const f of files) out.push(f.path);
    for (const folder of await fs.listFolders(dir)) {
        out.push(...await listAllPaths(fs, folder.path));
    }
    return out;
}

const CHAP_DIR = '测试项目/03-大纲与章节/步骤结果/第1卷/第1章';

/** 构造带协议行的模型输出 */
const RAW_WITH_PROTOCOL = [
    '他把剑收回鞘里，转身走进雨里。',
    '',
    '---',
    'CR|张三|李四|师徒反目|夺剑之仇',
    'CI|霜寒剑|损坏|1',
].join('\n');

/**
 * 最小 frontmatter 端口：不真跑 Obsidian 的 processFrontMatter，
 * 只满足 saver 的写入前置条件（正文内容断言不依赖 frontmatter 落盘）。
 */
const noopFrontmatter = {
    processFrontmatter: async (): Promise<void> => { /* no-op for test */ },
};

function makeSaver(fs: MockFileSystem, structuredChangeLines: boolean | undefined): StepResultSaver {
    return new StepResultSaver({
        fs,
        frontmatter: noopFrontmatter,
        deps: {
            getPlugin: () => ({ settings: { structuredChangeLines } }),
        },
    });
}

describe('协议行剥离受 structuredChangeLines 控制', () => {
    let fs: MockFileSystem;

    beforeEach(async () => {
        fs = new MockFileSystem();
        // 写入前有「项目身份守卫」：缺标志会拒绝写入以避免重建已删项目。
        // 这里落一个真实标志，让测试走正常写路径。
        const projectRoot = CHAP_DIR.split('/')[0];
        await fs.mkdir(projectRoot);
        await fs.write(
            `${projectRoot}/${PROJECT_IDENTITY_MARKERS[1]}`,
            '# 作品信息\n\n测试项目。',
        );
    });

    it('开关关闭时，正文里的 CR|/CI| 行必须原样保留', async () => {
        const saver = makeSaver(fs, false);
        const ok = await saver.saveStepResult('bodyGeneration', RAW_WITH_PROTOCOL, CHAP_DIR, '第1章', '第1卷');
        expect(ok).toBe(true);

        const paths = await listAllPaths(fs);
        const bodyPath = paths.find((p) => p.endsWith('.md') && !p.includes('协议行待确认') && p.includes('第1章'));
        expect(bodyPath).toBeDefined();
        const body = await fs.read(bodyPath as string);
        expect(body).toContain('CR|张三|李四');
        expect(body).toContain('CI|霜寒剑|损坏|1');
        // 不得生成待确认清单
        expect(paths.some((p) => p.includes('协议行待确认'))).toBe(false);
    });

    it('settings 缺失（undefined）时按关闭处理，不得误摘正文', async () => {
        const saver = makeSaver(fs, undefined);
        await saver.saveStepResult('bodyGeneration', RAW_WITH_PROTOCOL, CHAP_DIR, '第1章', '第1卷');
        const paths = await listAllPaths(fs);
        const bodyPath = paths.find((p) => p.endsWith('.md') && p.includes('第1章') && !p.includes('作品信息'));
        expect(bodyPath).toBeDefined();
        expect(await fs.read(bodyPath as string)).toContain('CR|张三|李四');
    });

    it('开关开启时，协议行被剥离出正文', async () => {
        const saver = makeSaver(fs, true);
        const ok = await saver.saveStepResult('bodyGeneration', RAW_WITH_PROTOCOL, CHAP_DIR, '第1章', '第1卷');
        expect(ok).toBe(true);

        const paths = await listAllPaths(fs);
        const bodyPath = paths.find((p) => p.endsWith('.md') && !p.includes('协议行待确认') && p.includes('第1章'));
        expect(bodyPath).toBeDefined();
        const body = await fs.read(bodyPath as string);
        // 正文已剥离
        expect(body).not.toContain('CR|张三|李四');
        expect(body).toContain('他把剑收回鞘里');
        // 注：「.协议行待确认.md」清单的写入走 writeVaultText(app, ...)，
        // 需要真实 Obsidian 的 app.adapter；单测环境无 app，该写入命中
        // silent-ok 分支被跳过。清单生成需在真实实例上验证。
    });
});
