import { test, expect } from '@playwright/test';
import { FullWriterPage } from './pages/FullWriterPage';

// skip-reason: Chromium 无法加载 app://obsidian.md，浏览器模拟链路已停用；
// 真实链路见 obsidian-plugin.spec.ts（Electron + OBSIDIAN_PATH）。
test.describe.skip('项目卡片交互功能（浏览器模拟，已停用）', () => {
  let fullWriterPage: FullWriterPage;

  test.beforeEach(async ({ page }) => {
    fullWriterPage = new FullWriterPage(page);
    await fullWriterPage.goto();
  });

  test('应该能够点击项目卡片的向导按钮', async ({ page }) => {
    const projectName = `测试项目_${Date.now()}`;
    
    await fullWriterPage.createProject(projectName);
    
    const wizardButton = page.locator(`button:has-text("🧙 向导")`);
    await expect(wizardButton).toBeVisible({ timeout: 10000 });
    
    await wizardButton.first().click();
    
    await page.waitForTimeout(1000);
    
    const wizardTab = page.locator('div:has-text("向导")');
    await expect(wizardTab).toBeVisible({ timeout: 5000 });
  });

  test('应该能够点击项目卡片的写作按钮', async ({ page }) => {
    const projectName = `测试写作_${Date.now()}`;
    
    await fullWriterPage.createProject(projectName);
    
    const writeButton = page.locator(`button:has-text("✍️ 写作")`);
    await expect(writeButton).toBeVisible({ timeout: 10000 });
    
    await writeButton.first().click();
    
    await page.waitForTimeout(1000);
    
    const writingArea = page.locator('.novel-writer-writing-area, .nw-writing-area');
    await expect(writingArea).toBeVisible({ timeout: 5000 });
  });

  test('应该能够点击项目卡片的全部章节按钮', async ({ page }) => {
    const projectName = `测试章节_${Date.now()}`;
    
    await fullWriterPage.createProject(projectName);
    
    const browseButton = page.locator(`button:has-text("全部章节")`);
    await expect(browseButton).toBeVisible({ timeout: 10000 });
    
    await browseButton.first().click();
    
    await page.waitForTimeout(500);
    
    const chapterModal = page.locator('.modal:has-text("所有章节")');
    await expect(chapterModal).toBeVisible({ timeout: 5000 });
  });

  test('应该能够点击右上角的新建项目按钮', async ({ page }) => {
    const toolbarNewProjectBtn = page.locator('.novel-writer-fw-toolbar button:has-text("新建项目")');
    await expect(toolbarNewProjectBtn).toBeVisible({ timeout: 5000 });
    
    await toolbarNewProjectBtn.click();
    
    await page.waitForTimeout(500);
    
    const createModal = page.locator('.modal:has-text("创建项目")');
    await expect(createModal).toBeVisible({ timeout: 5000 });
  });

  test('项目卡片点击应该显示预览面板', async ({ page }) => {
    const projectName = `测试预览_${Date.now()}`;
    
    await fullWriterPage.createProject(projectName);
    
    const projectCard = page.locator('.novel-writer-fw-project-card');
    await expect(projectCard).toBeVisible({ timeout: 10000 });
    
    await projectCard.first().click();
    
    await page.waitForTimeout(500);
    
    const previewPanel = page.locator('.novel-writer-fw-preview-panel:not(.hidden)');
    await expect(previewPanel).toBeVisible({ timeout: 5000 });
  });

  test('项目卡片点击两次应该关闭预览面板', async ({ page }) => {
    const projectName = `测试预览切换_${Date.now()}`;
    
    await fullWriterPage.createProject(projectName);
    
    const projectCard = page.locator('.novel-writer-fw-project-card');
    await expect(projectCard).toBeVisible({ timeout: 10000 });
    
    await projectCard.first().click();
    await page.waitForTimeout(300);
    
    await projectCard.first().click();
    await page.waitForTimeout(300);
    
    const previewPanel = page.locator('.novel-writer-fw-preview-panel:not(.hidden)');
    await expect(previewPanel).not.toBeVisible({ timeout: 3000 });
  });
});