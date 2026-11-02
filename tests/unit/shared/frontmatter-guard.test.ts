/**
 * frontmatter 写入护栏回归：重复顶层键去重 + 空值行写入。
 *
 * 背景（2026-11-03 第三章实测）：旧版字符串级 `updateFrontmatterField` 对空值行
 * `entity_last_changed_at:` 匹配失败后又在顶部插入同名键，产生重复键；
 * 结算时 Obsidian 解析 YAML 抛 `Map keys must be unique`，整个结算报错。
 */
import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { dedupeFrontmatterKeys, setFrontmatterValue } from '../../../shared/frontmatter';
import { ObsidianFrontmatter } from '../../../shared/file-system-port';

describe('dedupeFrontmatterKeys', () => {
    it('重复顶层键保留首次出现，丢弃后续', () => {
        const input = [
            '---',
            'title: 书甲',
            'entity_last_changed_at: 第3章',
            'entity_last_changed_reason: 结算',
            'entity_last_changed_at:',
            'entity_last_changed_reason:',
            'status: draft',
            '---',
            '',
            '正文',
        ].join('\n');
        const output = dedupeFrontmatterKeys(input);
        expect(output).toContain('entity_last_changed_at: 第3章');
        expect(output).toContain('entity_last_changed_reason: 结算');
        expect(output.match(/entity_last_changed_at:/g)?.length).toBe(1);
        expect(output).toContain('status: draft');
        expect(output.endsWith('正文')).toBe(true);
    });

    it('缩进列表行不被当成键，原样保留', () => {
        const input = [
            '---',
            'tags:',
            '  - 人物',
            '涉及章节:',
            '  - 第1章',
            '---',
            '',
            '正文',
        ].join('\n');
        expect(dedupeFrontmatterKeys(input)).toBe(input);
    });

    it('无 frontmatter 或无重复时原样返回', () => {
        expect(dedupeFrontmatterKeys('# 无头材料')).toBe('# 无头材料');
        const single = '---\ntitle: a\n---\nbody';
        expect(dedupeFrontmatterKeys(single)).toBe(single);
    });
});

describe('setFrontmatterValue', () => {
    it('空值行 key: 也能命中并更新（旧实现会在此处插出重复键）', () => {
        const input = '---\nentity_last_changed_at:\nentity_status: active\n---\nbody';
        const output = setFrontmatterValue(input, 'entity_last_changed_at', '第3章');
        expect(output).toContain('entity_last_changed_at: 第3章');
        expect(output.match(/entity_last_changed_at:/g)?.length).toBe(1);
    });

    it('已有重复键时收敛为一行', () => {
        const input = '---\n当前状态: 受伤\n当前状态:\nentity_status: active\n---\nbody';
        const output = setFrontmatterValue(input, '当前状态', '清醒');
        expect(output.match(/当前状态:/g)?.length).toBe(1);
        expect(output).toContain('当前状态: 清醒');
    });

    it('键不存在时插入 frontmatter 开头', () => {
        const input = '---\ntitle: a\n---\nbody';
        const output = setFrontmatterValue(input, 'entity_status', 'active');
        expect(output).toBe('---\nentity_status: active\ntitle: a\n---\nbody');
    });
});

describe('ObsidianFrontmatter.processFrontmatter 重复键自愈', () => {
    it('首次抛 Map keys must be unique 时去重后重试', async () => {
        const raw = [
            '---',
            '当前状态: 受伤',
            'entity_last_changed_at: 第2章',
            '当前状态:',
            '---',
            '',
            '正文',
        ].join('\n');
        let content = raw;
        const calls: Array<(fm: Record<string, unknown>) => void> = [];
        const app = {
            fileManager: {
                processFrontMatter: vi.fn(async (_file: TFile, updater: (fm: Record<string, unknown>) => void) => {
                    calls.push(updater);
                    if (calls.length === 1) {
                        const err = new Error('Map keys must be unique at line 23, column 1');
                        throw err;
                    }
                    updater({ 当前状态: '清醒' });
                }),
            },
            vault: {
                read: vi.fn(async () => content),
                modify: vi.fn(async (_file: TFile, text: string) => {
                    content = text;
                }),
            },
        };
        const fm = new ObsidianFrontmatter(app as never);
        await fm.processFrontmatter(new TFile() as never, (data) => {
            data['当前状态'] = '清醒';
            data['entity_last_changed_reason'] = '结算';
        });

        expect(app.vault.modify).toHaveBeenCalledTimes(1);
        const written = app.vault.modify.mock.calls[0][1] as string;
        expect(written.match(/当前状态:/g)?.length).toBe(1);
        expect(calls.length).toBe(2);
    });

    it('其他错误原样抛出，不做去重重试', async () => {
        const app = {
            fileManager: {
                processFrontMatter: vi.fn(async () => {
                    throw new Error('disk full');
                }),
            },
            vault: {
                read: vi.fn(),
                modify: vi.fn(),
            },
        };
        const fm = new ObsidianFrontmatter(app as never);
        await expect(fm.processFrontmatter(new TFile() as never, () => undefined)).rejects.toThrow('disk full');
        expect(app.vault.modify).not.toHaveBeenCalled();
    });
});
