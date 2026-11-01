import { App, Notice, TFile, TFolder } from 'obsidian';
import { pjVolumeOutlineDir, pjVolumeOutlineFile } from '../shared/paths';
import { ObsidianFileSystem, ObsidianVaultMeta } from '../shared/file-system-port';
import type { FileSystemPort, VaultMetaPort } from '../shared/file-system-port';
import { createLogger } from '../shared/logger';


const log = createLogger('Helpers');
/**
 * 在所有顶层工作台/Modal 容器上加 nw-scope class，
 * 使 styles.css 中以 .nw-scope 为作用域前缀的 39 条规则生效。
 *
 * 设计：ItemView 挂在 containerEl.parentElement（view-content 的父级）；
 * Modal 挂在 this.modalEl 上。
 *
 * @param el Obsidian ItemView 或 Modal 的根元素引用
 */
export function applyNwScope(el: { containerEl?: HTMLElement; modalEl?: HTMLElement }): void {
    let target: HTMLElement | null = null;
    if (el.containerEl?.parentElement) {
        target = el.containerEl.parentElement;
    } else if (el.modalEl) {
        target = el.modalEl;
    }
    if (target && !target.classList.contains('nw-scope')) {
        target.classList.add('nw-scope');
    }
}

/**
 * HTML 转义（覆盖 & < > " '），用于 innerHTML / SVG text 插值前的防 XSS 净化。
 * 统一落点：project-selector-controller、knowledge-detail-modal 等 UI 模块共用（审计 F1/F2）。
 */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// M8：按 key 管理进度通知。不传 key 时行为与旧单例完全一致（默认槽）；
// 并发流程传不同 key 即可互不吞掉对方的进度与 hide。
const progressNotices = new Map<string, Notice>();

export function showProgress(message: string, key: string = 'default'): void {
    const existing = progressNotices.get(key);
    if (existing) {
        existing.setMessage(message);
        return;
    }
    progressNotices.set(key, new Notice(message, 0));
}

export function hideProgress(key: string = 'default'): void {
    const notice = progressNotices.get(key);
    if (notice) {
        notice.hide();
        progressNotices.delete(key);
    }
}

export function showSuccess(message: string, duration: number = 3000): void {
    hideProgress();
    new Notice(`✅ ${message}`, duration);
}

export function showError(message: string, duration: number = 5000): void {
    hideProgress();
    new Notice(`❌ ${message}`, duration);
}

export function showWarning(message: string, duration: number = 5000): void {
    hideProgress();
    new Notice(`⚠️ ${message}`, duration);
}

export async function mkdirp(app: App, dirPath: string, fs?: FileSystemPort): Promise<void> {
    const fileSystem = fs || new ObsidianFileSystem(app);
    const vaultMeta = new ObsidianVaultMeta(app);
    if (vaultMeta.getAbstractFileByPath(dirPath)) return;
    await fileSystem.mkdir(dirPath);
}

export async function readTmpl(app: App, path: string, fs?: FileSystemPort): Promise<string | null> {
    try {
        const fileSystem = fs || new ObsidianFileSystem(app);
        return await fileSystem.read(path);
    } catch (e) {
        log.warn('readTmpl: 读取模板失败:', path, e);
        return null;
    }
}

export function stripFrontmatter(t: string): string {
    return t.replace(/^---[\s\S]*?---\n/, '').trim();
}

export function extractVolumeFromPath(path: string): string | null {
    // v4.0：卷目录位于 正文/ 与 步骤结果/ 之下，兼容旧版直挂 03-大纲与章节/ 下的写法
    const match = path.match(/03-大纲与章节\/(?:正文\/|步骤结果\/)?(第\d+卷)/);
    return match ? match[1] : null;
}

export function extractChapterNumber(path: string): number | null {
    const match = path.match(/第(\d+)章/);
    return match ? parseInt(match[1]) : null;
}

export function getNextRowNum(content: string): number {
    // 列宽不固定（`| 1 |` 与 `|1|`，或补空格对齐），不能用 `| (\d+) |` 这种单空格模式
    const match = content.match(/\|\s*(\d+)\s*\|/g);
    if (!match) return 1;
    const nums = match.map(m => parseInt(m.replace(/[^\d]/g, ''), 10)).filter(Number.isFinite);
    return nums.length > 0 ? Math.max(...nums) + 1 : 1;
}

export function hasTableSeparator(content: string): boolean {
    // 模板可能写成 `|---|` 或 `| --- |`
    return /^\|[\s:|-]+\|/m.test(content);
}

export function appendAfterSeparator(content: string, newRow: string): string {
    const lines = content.split('\n');
    let found = false;
    
    for (let i = 0; i < lines.length; i++) {
        if (/^\|[\s:|-]+\|/.test(lines[i])) {
            lines.splice(i + 1, 0, newRow);
            found = true;
            break;
        }
    }
    
    return found ? lines.join('\n') : content + '\n' + newRow;
}

export function getNextRowNumInSection(content: string, section: string): number {
    let maxNum = 0, inSection = false;
    for (const l of content.split('\n')) {
        if (l.includes(section)) { inSection = true; continue; }
        if (inSection && l.startsWith('#')) break;
        if (!inSection) continue;
        if (!l.match(/^\|.*\|/)) continue;
        // 保留空单元格位置，避免「计划回收」为空时整行左移
        const cells = l.split('|').slice(1, -1).map(s => s.trim());
        if (cells.length >= 1 && /^\d+$/.test(cells[0])) {
            const n = parseInt(cells[0], 10);
            if (n > maxNum) maxNum = n;
        }
    }
    return maxNum + 1;
}

export function renumberTable(lines: string[], section: string): void {
    let inSection = false, num = 1;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes(section)) { inSection = true; continue; }
        if (!inSection) continue;
        // 分隔行：`|---|` / `| --- |` / `|:--:|`
        if (/^\|[\s:|-]+\|$/.test(line.trim())) continue;
        if (/^\|.*\|$/.test(line.trim())) {
            // 旧实现取 cols[0]===''（split 后的前导空串），正则永不命中 → 重编号恒为 no-op
            const cells = line.trim().split('|').slice(1, -1).map(s => s.trim());
            if (cells.length >= 2 && /^\d+$/.test(cells[0])) {
                cells[0] = String(num);
                lines[i] = `| ${cells.join(' | ')} |`;
                num++;
            }
            continue;
        }
        if (line.startsWith('#')) break;
    }
}

export function moveForeshadowToRevealed(content: string, name: string, revealChapter: string): string | null {
    const lines = content.split('\n');
    let foundRow = -1, foundCols: string[] | null = null, revealedStart = -1;
    
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (l.includes('已回收伏笔')) revealedStart = i;
        if (revealedStart === -1 && l.match(/^\|.*\|/)) {
            // 保留空单元格：filter(Boolean) 会把「计划回收」等空列丢掉，整行左移导致串列
            const cols = l.trim().split('|').slice(1, -1).map(s => s.trim());
            if (cols.length >= 8 && cols[1] === name) { 
                foundRow = i; 
                foundCols = cols; 
            }
        }
    }
    
    if (foundRow === -1 || !foundCols) return null;
    
    lines.splice(foundRow, 1);
    
    let sepIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('已回收伏笔')) { 
            for (let j = i + 1; j < lines.length; j++) { 
                if (/^\|[\s:|-]+\|$/.test(lines[j].trim())) { 
                    sepIdx = j; 
                    break; 
                } 
            } 
            break; 
        }
    }
    
    if (sepIdx !== -1) {
        const newRowNum = getNextRowNumInSection(lines.join('\n'), '已回收伏笔');
        lines.splice(sepIdx + 1, 0, `| ${newRowNum} | ${foundCols[1]} | ${foundCols[2] || '中'} | ${foundCols[3] || ''} | ${foundCols[5] || ''} | ${foundCols[6] || ''} | ${revealChapter} | 正文揭示 |`);
    }
    
    renumberTable(lines, '未回收伏笔');
    
    return lines.join('\n');
}

// ============================================================
// 分卷大纲（v4.0 按卷归档）读写工具
// ============================================================

/** 写入文件：存在则覆盖内容，否则新建 */
async function writeOrReplaceFile(app: App, path: string, content: string, fs?: FileSystemPort): Promise<void> {
    const fileSystem = fs || new ObsidianFileSystem(app);
    await fileSystem.write(path, content);
}

/**
 * v4.0：将整本大纲（含 `## 全书总览` + `## 分卷大纲` + 多个 `### 第N卷`）
 * 按卷拆分写入 `分卷大纲/第N卷_分卷大纲.md`。
 *
 * 全书总览 / 前言块归入第 1 卷文件头部，使读取第 1 卷即可命中
 * 总字数目标 / 分卷数 等全局字段（与 getVolumeOutlinePath 语义保持一致）。
 *
 * @returns 实际写入的卷文件数量
 */
export async function writeVolumeOutlines(app: App, project: string, outlineBody: string, fs?: FileSystemPort): Promise<number> {
    const fileSystem = fs || new ObsidianFileSystem(app);
    const dir = pjVolumeOutlineDir(project);
    await mkdirp(app, dir, fileSystem);

    const fm = '---\ntags: [大纲]\n---\n\n';
    const title = '# 全书规划 & 分卷大纲\n\n';

    // 定位每个 ### 第N卷 段落
    const headerRe = /^###\s+第(\d+)卷.*$/gm;
    const matches: Array<{ volN: number; index: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = headerRe.exec(outlineBody)) !== null) {
        matches.push({ volN: parseInt(m[1]), index: m.index });
    }

    // 无法识别分卷时整体写入第1卷，保证内容不丢失
    if (matches.length === 0) {
        const content = `${fm}${title}${outlineBody.trim()}\n`;
        await writeOrReplaceFile(app, pjVolumeOutlineFile(project, 1), content);
        return 1;
    }

    // 清理残留旧卷文件：删除不在新输出中的旧分卷大纲文件
    const newVolNumbers = new Set(matches.map(m => m.volN));
    const dirFile = app.vault.getAbstractFileByPath(dir);
    if (dirFile instanceof TFolder) {
        for (const child of dirFile.children) {
            if (!child.name || !child.name.endsWith('_分卷大纲.md')) continue;
            const volMatch = child.name.match(/第(\d+)卷/);
            if (volMatch) {
                const oldVolN = parseInt(volMatch[1]);
                if (!newVolNumbers.has(oldVolN)) {
                    try {
                        await app.vault.delete(child, true);
                        log.info(`[小说工坊] 清理残留旧卷文件: ${child.name}`);
                    } catch (e) {
                        log.warn(`[小说工坊] 删除旧卷文件失败: ${child.name}`, e);
                    }
                }
            }
        }
    }

    const preamble = outlineBody.slice(0, matches[0].index).trim();
    let written = 0;
    for (let i = 0; i < matches.length; i++) {
        const { volN, index } = matches[i];
        const end = i + 1 < matches.length ? matches[i + 1].index : outlineBody.length;
        const section = outlineBody.slice(index, end).trim();
        // 第1卷文件头部冠以全书总览 / 前言块
        const head = volN === matches[0].volN && preamble ? `${preamble}\n\n` : '';
        const content = `${fm}${title}${head}${section}\n`;
        await writeOrReplaceFile(app, pjVolumeOutlineFile(project, volN), content);
        written++;
    }
    return written;
}

/**
 * v4.0：合并读取 `分卷大纲/*_分卷大纲.md`（按卷号升序），
 * 向后兼容旧版单文件 `03-大纲与章节/分卷大纲.md`。
 *
 * @returns 合并后的大纲文本；若两者皆缺失返回空串
 */
export async function readMergedVolumeOutline(app: App, project: string, fs?: FileSystemPort, vaultMeta?: VaultMetaPort): Promise<string> {
    const fileSystem = fs || new ObsidianFileSystem(app);
    const meta = vaultMeta || new ObsidianVaultMeta(app);
    const parts: string[] = [];

    // v4.0 按卷归档（优先）：同一项目若同时残留旧版单文件，
    // 合并两者会产生重复卷号，批量建章的一致性校验会直接阻断。
    const dir = pjVolumeOutlineDir(project);
    const volFiles = meta.getFiles()
        .filter(f => f.path.startsWith(`${dir}/`) && f.name.endsWith('_分卷大纲.md'))
        .sort((a, b) => {
            const na = parseInt(a.name.match(/第(\d+)卷/)?.[1] || '0');
            const nb = parseInt(b.name.match(/第(\d+)卷/)?.[1] || '0');
            return na - nb;
        });
    for (const f of volFiles) {
        try { parts.push(await fileSystem.read(f.path)); } catch (e) { log.warn('[小说工坊] 读取分卷大纲失败:', f.path, e); }
    }

    // 旧版单文件兜底（v3.x）：仅在没有任何 v4 卷文件时使用
    if (volFiles.length === 0) {
        const legacyPath = `${project}/03-大纲与章节/分卷大纲.md`;
        const legacy = meta.getAbstractFileByPath(legacyPath);
        if (legacy instanceof TFile) {
            try { parts.push(await fileSystem.read(legacyPath)); } catch (e) { log.warn('[小说工坊] 读取旧版分卷大纲失败:', e); }
        }
    }

    return parts.join('\n\n');
}
