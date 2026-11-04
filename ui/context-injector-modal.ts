import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '@/main';
import { getInvolvedEntities } from '@/engine/chapter-context-builder';
import { pjCharsDir, pjLocsDir, pjFactionsDir, pjItemsDir, SUBDIR_TIMELINE } from '@/shared/paths';
import { entityDir } from '@/shared/entity-reader';
import { upsertAutoContext } from '@/shared/auto-context-block';
import { createLogger } from '@/shared/logger';


import { writeVaultText } from '@/shared/file-system-port';
const log = createLogger('ContextInjectorModal');
/**
 * 上下文注入器弹窗。
 */
export class ContextInjectorModal extends Modal {
    private plugin: NovelWriterPlugin;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;
        // ═══ v3.4.8: 两层CSS规则 — 见 docs/CSS变量注入与两层规则_全插件避坑指南.md ═══
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.empty();
        contentEl.createEl('h2', { text: '🔗 上下文注入' });

        // 工作台/项目页没有 activeFile：优先用界面当前章节
        const target = this.plugin.getActiveChapterTarget();
        if (!target) {
            contentEl.createEl('p', { text: '❌ 请先在工作台选择章节，或打开章节正文文件' });
            return;
        }

        const injectButton = contentEl.createEl('button', { text: '注入上下文', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
        injectButton.onclick = async () => {
            await this.injectContext(target.bodyPath);
        };
    }

    private async injectContext(filePath: string): Promise<void> {
        const adapter = this.app.vault.adapter;

        // 工作台可能选中一个尚未生成正文的章节：先区分空态，不把「文件不存在」报成读取失败
        const bodyFile = this.app.vault.getAbstractFileByPath(filePath);
        if (!(bodyFile instanceof TFile)) {
            new Notice('⚠️ 当前章节正文尚未创建，请先生成正文后再注入上下文', 5000);
            return;
        }

        const pathParts = filePath.split('/');
        const projectRoot = pathParts[0];
        const charDir = entityDir(projectRoot, 'characters');
        const locDir = entityDir(projectRoot, 'locations');
        const factionDir = entityDir(projectRoot, 'factions');
        const itemDir = entityDir(projectRoot, 'items');

        new Notice(`🔍 在 ${projectRoot} 下检索关联...`);

        let content: string;
        try {
            content = await adapter.read(filePath);
        } catch (e) {
            new Notice('❌ 读取文件失败');
            return;
        }

        const { chars: charLinks, locs: locLinks, factions: factionLinks, items: itemLinks } =
            await getInvolvedEntities(this.app, bodyFile);

        if (charLinks.length === 0 && locLinks.length === 0 && factionLinks.length === 0 && itemLinks.length === 0) {
            new Notice('⚠️ frontmatter 中未声明涉及人物、地点、势力或物品功法');
            return;
        }

        const findFile = async (dir: string, name: string): Promise<string | null> => {
            try {
                const list = await adapter.list(dir);
                return list.files.find(f => {
                    const normalized = f.replace(/\\/g, '/');
                    return normalized.endsWith(`/${name}.md`);
                }) || null;
            } catch {
                return null;
            };
        };

        const getField = (text: string, field: string): string => {
            const re = new RegExp(`${field}:\\s*["']?(.*?)["']?(\\n|$)`);
            const m = text.match(re);
            return m ? m[1].trim() : '-';
        };

        const getFileFrontmatter = async (filePath: string): Promise<string | null> => {
            try {
                const fc = await adapter.read(filePath);
                const fm = fc.match(/^---\n([\s\S]*?)\n---/);
                return fm ? fm[1] : null;
            } catch { return null; }
        };

        let body = '';

        if (charLinks.length > 0) {
            body += '### 关联人物\n\n| 姓名 | 当前状态 | 核心动机 | 金手指 |\n|------|---------|---------|-------|\n';
            for (const name of charLinks) {
                const targetPath = await findFile(charDir, name);
                if (!targetPath) continue;
                const fm = await getFileFrontmatter(targetPath);
                if (fm) {
                    body += `| [[${name}]] | ${getField(fm, '当前状态')} | ${getField(fm, '核心动机')} | ${getField(fm, '金手指/特殊能力')} |\n`;
                }
            }
        }

        if (locLinks.length > 0) {
            body += '\n### 关联地点\n\n';
            for (const name of locLinks) {
                const targetPath = await findFile(locDir, name);
                if (!targetPath) continue;
                const fc = await adapter.read(targetPath).catch(() => null);
                if (fc) {
                    const desc = fc.split('\n').find(l => l.includes('：') || l.includes(':'));
                    body += `- **[[${name}]]**：${desc || '-'}\n`;
                }
            }
        }

        if (factionLinks.length > 0) {
            body += '\n### 关联势力\n\n';
            for (const name of factionLinks) {
                const targetPath = await findFile(factionDir, name);
                if (!targetPath) continue;
                const fc = await adapter.read(targetPath).catch(() => null);
                if (fc) {
                    const desc = fc.split('\n').find(l => l.includes('：') || l.includes(':'));
                    body += `- **[[${name}]]**：${desc || '-'}\n`;
                }
            }
        }

        if (itemLinks.length > 0) {
            body += '\n### 关联物品功法\n\n';
            for (const name of itemLinks) {
                const targetPath = await findFile(itemDir, name);
                if (!targetPath) continue;
                const fc = await adapter.read(targetPath).catch(() => null);
                if (fc) {
                    const desc = fc.split('\n').find(l => l.includes('：') || l.includes(':'));
                    body += `- **[[${name}]]**：${desc || '-'}\n`;
                }
            }
        }

        const fbDir = `${projectRoot}/${SUBDIR_TIMELINE}`;
        const unrevealed: string[] = [];
        try {
            const fbList = await adapter.list(fbDir);
            for (const f of fbList.files) {
                if (f.includes('模板') || f.includes('伏笔库')) continue;
                const fc = await adapter.read(f).catch(() => null);
                if (!fc) continue;
                const fm = fc.match(/^---\n([\s\S]*?)\n---/);
                if (fm && /状态:\s*["']?未揭示/.test(fm[1])) {
                    const m = fm[1].match(/内容:\s*["']?(.*?)["']?(\n|$)/);
                    if (m) unrevealed.push(m[1].trim());
                }
            }
        } catch (e) { log.warn('[小说工坊] 操作失败:', e); }
        if (unrevealed.length > 0) {
            body += '\n### 待揭示伏笔\n\n';
            for (const fb of unrevealed.slice(0, 3)) {
                body += `- ${fb}\n`;
            }
        }

        // 幂等写入：重复注入只替换旧块，不再向正文追加第二段
        const marker = '<!-- 正文从这里开始 -->';
        const newContent = upsertAutoContext(content, body, marker);

        try {
            // 走 vault 索引写入，让 metadataCache 立即重解析；旧 adapter.write + .touch_
            // 临时文件是在索引外改正文，属性/字数/链接都会短时间陈旧。
            await writeVaultText(this.app, filePath, newContent);
        } catch (e) {
            new Notice(`❌ 写入失败: ${(e as Error).message || e}`);
            return;
        }

        new Notice(`✅ 已注入上下文（${charLinks.length} 人物, ${locLinks.length} 地点, ${factionLinks.length} 势力, ${itemLinks.length} 物品功法, ${unrevealed.length} 伏笔）`);

        this.close();
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
