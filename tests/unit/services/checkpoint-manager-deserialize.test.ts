import { describe, expect, it } from 'vitest';
import { CheckpointManager } from '../../../services/checkpoint-manager';
import type { FileSystemPort } from '../../../shared/file-system-port';

type Deserialize = (content: string) => Record<string, unknown> | null;

const proto = CheckpointManager.prototype as unknown as { deserializeCheckpoint: Deserialize };

/** deserializeCheckpoint 不依赖 this，可直接以空对象为上下文调用 */
function parse(content: string) {
    return proto.deserializeCheckpoint.call({}, content);
}

const BODY = `---
taskId: task-1
bookId: book-1
bookName: 某书: 副标题
filePath: 素材/某书: 全本.txt
bytesProcessed: 1024
currentDimension: rhythm
dimensionProgress: 50
completedSegments: 2
totalSegments: 8
startedAt: 1700000000000
lastSavedAt: 1700000001000
checksum: abc
sourceChecksum: def
version: 1
---

# 增量结果
\`\`\`json
{"a":1}
\`\`\`
`;

describe('CheckpointManager.deserializeCheckpoint', () => {
    it('解析基本 frontmatter 与增量 JSON', () => {
        const state = parse(BODY);
        expect(state).not.toBeNull();
        expect(state!.taskId).toBe('task-1');
        expect(state!.bytesProcessed).toBe(1024);
        expect(state!.partialResults).toEqual({ a: 1 });
    });

    it('值中含 `: ` 不被截断', () => {
        const state = parse(BODY);
        expect(state!.bookName).toBe('某书: 副标题');
        expect(state!.filePath).toBe('素材/某书: 全本.txt');
    });

    it('CRLF 文件同样能解析', () => {
        const state = parse(BODY.replace(/\n/g, '\r\n'));
        expect(state).not.toBeNull();
        expect(state!.taskId).toBe('task-1');
        expect(state!.partialResults).toEqual({ a: 1 });
    });

    it('文件缺 frontmatter 返回 null', () => {
        expect(parse('# 只有正文\n')).toBeNull();
    });
});

void ({} as FileSystemPort);
