import { describe, it, expect } from 'vitest';
import { splitParagraphsByContract } from '../../../engine/outline-to-text-expander';

describe('splitParagraphsByContract', () => {
    it('单换行契约：每个非空行独立成段，空行被压掉', () => {
        const out = splitParagraphsByContract('他抬手。\n风灌进来。\n\n她回头。', '\n');
        expect(out.map((p) => p.content)).toEqual(['他抬手。', '风灌进来。', '她回头。']);
        expect(out.map((p) => p.index)).toEqual([1, 2, 3]);
    });

    it('空行契约：空行分段，段内保留软换行', () => {
        const out = splitParagraphsByContract('第一段第一行。\n第一段第二行。\n\n第二段。', '\n\n');
        expect(out.map((p) => p.content)).toEqual(['第一段第一行。\n第一段第二行。', '第二段。']);
    });

    it('CRLF 与首尾空行不影响分段', () => {
        const out = splitParagraphsByContract('\r\n他抬手。\r\n\r\n风灌进来。\r\n\r\n', '\n');
        expect(out.map((p) => p.content)).toEqual(['他抬手。', '风灌进来。']);
    });

    it('剥离段首缩进（含全角空格），避免列表显示带缩进', () => {
        const out = splitParagraphsByContract('\u3000\u3000他抬手。\n\u3000\u3000风灌进来。', '\n');
        expect(out.map((p) => p.content)).toEqual(['他抬手。', '风灌进来。']);
    });

    it('空内容返回空数组', () => {
        expect(splitParagraphsByContract('', '\n')).toEqual([]);
        expect(splitParagraphsByContract('\n\n', '\n\n')).toEqual([]);
    });
});
