/**
 * 蒸馏回流落盘（2026-11-28）
 *
 * 验收：模式非 off 且正文末尾有蒸馏行时——
 * ① 蒸馏行从正文剥离（不污染章节正文）
 * ② 生成「.蒸馏回流待确认.md」清单
 * ③ **不直写数据表**（清单只是待确认）
 * ④ 无 C/EL 的普通散文不被误摘
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { StepResultSaver } from '../../../engine/step-result-saver';
import { MockFileSystem } from '../../../shared/file-system-port';
import { PROJECT_IDENTITY_MARKERS } from '../../../shared/project-catalog';

const CHAP_DIR = '测试项目/03-大纲与章节/步骤结果/第1卷/第5章';

const RAW_WITH_DISTILL = [
    '他把剑收回鞘里，转身走进雨里。',
    '',
    'C|第5章 雨夜|主角夺回剑谱|有人在山门外等他|山门开启来人是师兄|我这把剑不认第二个人',
    'EL|夺回剑谱后发现有内应，追杀者其实是师兄派来',
    'T|公元-2-4-15|公元-2-4-16|正常',
    'CF|剑谱下落|推进|藏剑阁已空',
    'PH|他在山门外看见一个不该出现的人',
    'OP|师兄把剑谱放在桌上，说了一句他听不懂的话',
].join('\n');

const noopFrontmatter = {
    processFrontmatter: async (): Promise<void> => { /* no-op */ },
};

async function listAllPaths(fs: MockFileSystem, dir = '测试项目'): Promise<string[]> {
    const out: string[] = [];
    for (const f of await fs.listFiles(dir)) out.push(f.path);
    for (const folder of await fs.listFolders(dir)) out.push(...await listAllPaths(fs, folder.path));
    return out;
}

function makeSaver(
    fs: MockFileSystem,
    settings: { distillBackflowMode?: 'off' | 'parse' | 'inject'; structuredChangeLines?: boolean } = {},
): StepResultSaver {
    return new StepResultSaver({
        fs,
        frontmatter: noopFrontmatter,
        deps: { getPlugin: () => ({ settings }) },
    });
}

describe('蒸馏回流落盘', () => {
    let fs: MockFileSystem;

    beforeEach(async () => {
        fs = new MockFileSystem();
        const projectRoot = CHAP_DIR.split('/')[0];
        await fs.mkdir(projectRoot);
        await fs.write(`${projectRoot}/${PROJECT_IDENTITY_MARKERS[1]}`, '# 作品信息\n\n测试项目。');
    });

    it('parse 模式：蒸馏行从正文剥离，正文其余保留', async () => {
        const saver = makeSaver(fs, { distillBackflowMode: 'parse' });
        const ok = await saver.saveStepResult('bodyGeneration', RAW_WITH_DISTILL, CHAP_DIR, '第5章', '第1卷');
        expect(ok).toBe(true);

        const paths = await listAllPaths(fs);
        const bodyPath = paths.find((p) => p.endsWith('.md') && p.includes('第5章') && !p.includes('待确认'));
        expect(bodyPath).toBeDefined();
        const body = await fs.read(readBodyPath(bodyPath));
        expect(body).toContain('他把剑收回鞘里');
        for (const tag of ['C|第5章', 'EL|', 'T|公元', 'CF|', 'PH|', 'OP|']) {
            expect(body).not.toContain(tag);
        }
    });

    it('off 模式：不剥离、不生成清单', async () => {
        const saver = makeSaver(fs, { distillBackflowMode: 'off' });
        await saver.saveStepResult('bodyGeneration', RAW_WITH_DISTILL, CHAP_DIR, '第5章', '第1卷');
        const paths = await listAllPaths(fs);
        expect(paths.some((p) => p.includes('蒸馏回流待确认'))).toBe(false);
        const bodyPath = paths.find((p) => p.endsWith('.md') && p.includes('第5章'));
        const body = await fs.read(readBodyPath(bodyPath));
        expect(body).toContain('C|第5章');
    });

    it('普通散文里的 W| / K| 行不被误摘（安全阀）', async () => {
        const prose = '他写下两行笔记：\nW|这行是正文里的排版\nK|这行也是正文';
        const saver = makeSaver(fs, { distillBackflowMode: 'parse' });
        await saver.saveStepResult('bodyGeneration', prose, CHAP_DIR, '第5章', '第1卷');
        const paths = await listAllPaths(fs);
        expect(paths.some((p) => p.includes('蒸馏回流待确认'))).toBe(false);
        const bodyPath = paths.find((p) => p.endsWith('.md') && p.includes('第5章'));
        const body = await fs.read(readBodyPath(bodyPath));
        expect(body).toContain('W|这行是正文里的排版');
        expect(body).toContain('K|这行也是正文');
    });

    it('未设置时默认 parse（零配置即生效）', async () => {
        const saver = makeSaver(fs, {});
        await saver.saveStepResult('bodyGeneration', RAW_WITH_DISTILL, CHAP_DIR, '第5章', '第1卷');
        const paths = await listAllPaths(fs);
        const bodyPath = paths.find((p) => p.endsWith('.md') && p.includes('第5章') && !p.includes('待确认'));
        const body = await fs.read(readBodyPath(bodyPath));
        expect(body).not.toContain('C|第5章');
    });
});

/** 从路径列表里取出正文文件路径（排除作品信息） */
function readBodyPath(p: string | undefined): string {
    if (!p) throw new Error('未找到正文文件');
    return p;
}
