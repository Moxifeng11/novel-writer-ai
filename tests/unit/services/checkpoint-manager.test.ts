import { describe, it, expect, beforeEach } from 'vitest';
import { CheckpointManager, CheckpointState } from '../../../services/checkpoint-manager';
import { MockFileSystem } from '../../../shared/file-system-port';

describe('CheckpointManager', () => {
    let fs: MockFileSystem;
    let manager: CheckpointManager;

    beforeEach(() => {
        fs = new MockFileSystem();
        manager = new CheckpointManager(fs);
    });

    describe('保存检查点', () => {
        it('saveCheckpoint 保存状态', async () => {
            const state: Omit<CheckpointState, 'checksum' | 'lastSavedAt' | 'sourceChecksum' | 'version'> = {
                taskId: 'task1',
                bookId: 'book1',
                bookName: '测试书',
                bytesProcessed: 1000,
                currentDimension: 'style',
                dimensionProgress: 50,
                completedSegments: 2,
                totalSegments: 5,
                partialResults: { style: { progress: 0.4 } },
                startedAt: Date.now(),
            };

            await manager.saveCheckpoint(state);

            const info = await manager.getCheckpoint('book1');
            expect(info.exists).toBe(true);
            expect(info.valid).toBe(true);
            expect(info.state?.bookId).toBe('book1');
            expect(info.state?.bytesProcessed).toBe(1000);
        });

        it('检查点包含完整信息', async () => {
            const startedAt = Date.now();
            const state: Omit<CheckpointState, 'checksum' | 'lastSavedAt' | 'sourceChecksum' | 'version'> = {
                taskId: 'task2',
                bookId: 'book2',
                bookName: '测试书2',
                filePath: '/books/book2.md',
                bytesProcessed: 2000,
                currentDimension: 'rhythm',
                dimensionProgress: 80,
                completedSegments: 4,
                totalSegments: 5,
                partialResults: { rhythm: { beats: [1, 2, 3] } },
                startedAt,
            };

            await manager.saveCheckpoint(state);

            const info = await manager.getCheckpoint('book2');
            expect(info.state?.taskId).toBe('task2');
            expect(info.state?.bookName).toBe('测试书2');
            expect(info.state?.filePath).toBe('/books/book2.md');
            expect(info.state?.startedAt).toBe(startedAt);
            expect(info.state?.partialResults).toEqual({ rhythm: { beats: [1, 2, 3] } });
        });
    });

    describe('获取检查点', () => {
        it('不存在时返回 empty', async () => {
            const info = await manager.getCheckpoint('not-exist');
            expect(info.exists).toBe(false);
            expect(info.valid).toBe(false);
        });

        it('存在且有效时返回状态', async () => {
            const state: Omit<CheckpointState, 'checksum' | 'lastSavedAt' | 'sourceChecksum' | 'version'> = {
                taskId: 'task3',
                bookId: 'book3',
                bookName: '测试书3',
                bytesProcessed: 500,
                currentDimension: 'style',
                dimensionProgress: 20,
                completedSegments: 1,
                totalSegments: 5,
                partialResults: {},
                startedAt: Date.now(),
            };

            await manager.saveCheckpoint(state);

            const info = await manager.getCheckpoint('book3');
            expect(info.exists).toBe(true);
            expect(info.valid).toBe(true);
            expect(info.state).toBeDefined();
        });

        it('校验和不匹配时无效', async () => {
            const state: Omit<CheckpointState, 'checksum' | 'lastSavedAt' | 'sourceChecksum' | 'version'> = {
                taskId: 'task4',
                bookId: 'book4',
                bookName: '测试书4',
                bytesProcessed: 1000,
                currentDimension: 'style',
                dimensionProgress: 50,
                completedSegments: 2,
                totalSegments: 5,
                partialResults: { test: 1 },
                startedAt: Date.now(),
            };

            await manager.saveCheckpoint(state);

            const path = 'checkpoints/book4.checkpoint.md';
            const content = await fs.read(path);
            const modified = content.replace('"test": 1', '"test": 999');
            await fs.write(path, modified);

            const info = await manager.getCheckpoint('book4');
            expect(info.exists).toBe(true);
            expect(info.valid).toBe(false);
            expect(info.reason).toBe('校验和不匹配');
        });
    });

    describe('断点续传', () => {
        it('resumeFromCheckpoint 返回状态', async () => {
            const state: Omit<CheckpointState, 'checksum' | 'lastSavedAt' | 'sourceChecksum' | 'version'> = {
                taskId: 'task5',
                bookId: 'book5',
                bookName: '测试书5',
                bytesProcessed: 3000,
                currentDimension: 'technique',
                dimensionProgress: 60,
                completedSegments: 3,
                totalSegments: 5,
                partialResults: { technique: {} },
                startedAt: Date.now(),
            };

            await manager.saveCheckpoint(state);

            const resumed = await manager.resumeFromCheckpoint('book5');
            expect(resumed).not.toBeNull();
            expect(resumed?.bookId).toBe('book5');
            expect(resumed?.bytesProcessed).toBe(3000);
            expect(resumed?.currentDimension).toBe('technique');
        });

        it('不存在检查点返回 null', async () => {
            const resumed = await manager.resumeFromCheckpoint('not-exist');
            expect(resumed).toBeNull();
        });

        it('无效检查点返回 null', async () => {
            await fs.write('checkpoints/book6.checkpoint.md', 'invalid content');

            const resumed = await manager.resumeFromCheckpoint('book6');
            expect(resumed).toBeNull();
        });

        it('过期检查点返回 null', async () => {
            const state: Omit<CheckpointState, 'checksum' | 'lastSavedAt' | 'sourceChecksum' | 'version'> = {
                taskId: 'task7',
                bookId: 'book7',
                bookName: '测试书7',
                bytesProcessed: 1000,
                currentDimension: 'style',
                dimensionProgress: 50,
                completedSegments: 2,
                totalSegments: 5,
                partialResults: {},
                startedAt: Date.now(),
            };

            await manager.saveCheckpoint(state);

            const path = 'checkpoints/book7.checkpoint.md';
            let content = await fs.read(path);
            const oldTimestamp = Date.now() - 30 * 24 * 60 * 60 * 1000;
            content = content.replace(
                new RegExp(`lastSavedAt: \\d+`),
                `lastSavedAt: ${oldTimestamp}`
            );
            await fs.write(path, content);

            const resumed = await manager.resumeFromCheckpoint('book7', { maxAgeMs: 1000 });
            expect(resumed).toBeNull();
        });

        it('force 强制恢复过期检查点', async () => {
            const state: Omit<CheckpointState, 'checksum' | 'lastSavedAt' | 'sourceChecksum' | 'version'> = {
                taskId: 'task8',
                bookId: 'book8',
                bookName: '测试书8',
                bytesProcessed: 1000,
                currentDimension: 'style',
                dimensionProgress: 50,
                completedSegments: 2,
                totalSegments: 5,
                partialResults: {},
                startedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
            };

            await manager.saveCheckpoint(state);

            const resumed = await manager.resumeFromCheckpoint('book8', { force: true });
            expect(resumed).not.toBeNull();
        });
    });

    describe('删除检查点', () => {
        it('deleteCheckpoint 删除文件', async () => {
            const state: Omit<CheckpointState, 'checksum' | 'lastSavedAt' | 'sourceChecksum' | 'version'> = {
                taskId: 'task9',
                bookId: 'book9',
                bookName: '测试书9',
                bytesProcessed: 1000,
                currentDimension: 'style',
                dimensionProgress: 50,
                completedSegments: 2,
                totalSegments: 5,
                partialResults: {},
                startedAt: Date.now(),
            };

            await manager.saveCheckpoint(state);

            let info = await manager.getCheckpoint('book9');
            expect(info.exists).toBe(true);

            await manager.deleteCheckpoint('book9');

            info = await manager.getCheckpoint('book9');
            expect(info.exists).toBe(false);
        });

        it('删除不存在的检查点不报错', async () => {
            await expect(manager.deleteCheckpoint('not-exist')).resolves.not.toThrow();
        });
    });

    describe('清理旧检查点', () => {
        it('cleanupOldCheckpoints 删除过期检查点', async () => {
            await fs.mkdir('checkpoints');

            const oldState: Omit<CheckpointState, 'checksum' | 'lastSavedAt' | 'sourceChecksum' | 'version'> = {
                taskId: 'old-task',
                bookId: 'old-book',
                bookName: '旧书',
                bytesProcessed: 1000,
                currentDimension: 'style',
                dimensionProgress: 50,
                completedSegments: 2,
                totalSegments: 5,
                partialResults: {},
                startedAt: Date.now(),
            };

            const newState: Omit<CheckpointState, 'checksum' | 'lastSavedAt' | 'sourceChecksum' | 'version'> = {
                taskId: 'new-task',
                bookId: 'new-book',
                bookName: '新书',
                bytesProcessed: 2000,
                currentDimension: 'style',
                dimensionProgress: 80,
                completedSegments: 4,
                totalSegments: 5,
                partialResults: {},
                startedAt: Date.now(),
            };

            await manager.saveCheckpoint(oldState);
            await manager.saveCheckpoint(newState);

            const oldPath = 'checkpoints/old-book.checkpoint.md';
            let content = await fs.read(oldPath);
            const oldTimestamp = Date.now() - 30 * 24 * 60 * 60 * 1000;
            content = content.replace(
                new RegExp(`lastSavedAt: \\d+`),
                `lastSavedAt: ${oldTimestamp}`
            );
            await fs.write(oldPath, content);

            const cleaned = await manager.cleanupOldCheckpoints(1000);
            expect(cleaned).toBeGreaterThanOrEqual(1);

            const oldInfo = await manager.getCheckpoint('old-book');
            expect(oldInfo.exists).toBe(false);

            const newInfo = await manager.getCheckpoint('new-book');
            expect(newInfo.exists).toBe(true);
        });
    });

    describe('源文件匹配验证', () => {
        it('verifySourceMatch 验证源文件', async () => {
            const state: Omit<CheckpointState, 'checksum' | 'lastSavedAt' | 'sourceChecksum' | 'version'> = {
                taskId: 'task10',
                bookId: 'book10',
                bookName: '测试书10',
                bytesProcessed: 1000,
                currentDimension: 'style',
                dimensionProgress: 50,
                completedSegments: 2,
                totalSegments: 5,
                partialResults: {},
                startedAt: Date.now(),
            };

            await manager.saveCheckpoint(state, 'test content');

            const match = await manager.verifySourceMatch('book10', 'test content');
            expect(match).toBe(true);
        });

        it('源文件变更时返回 false', async () => {
            const state: Omit<CheckpointState, 'checksum' | 'lastSavedAt' | 'sourceChecksum' | 'version'> = {
                taskId: 'task11',
                bookId: 'book11',
                bookName: '测试书11',
                bytesProcessed: 1000,
                currentDimension: 'style',
                dimensionProgress: 50,
                completedSegments: 2,
                totalSegments: 5,
                partialResults: {},
                startedAt: Date.now(),
            };

            await manager.saveCheckpoint(state, 'original content');

            const match = await manager.verifySourceMatch('book11', 'modified content');
            expect(match).toBe(false);
        });

        it('不存在检查点时返回 true', async () => {
            const match = await manager.verifySourceMatch('not-exist', 'test content');
            expect(match).toBe(true);
        });
    });
});
