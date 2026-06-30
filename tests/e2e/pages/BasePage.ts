import { Page } from '@playwright/test';

/**
 * 基础页面对象 - 所有页面的基类
 */
export class BasePage {
  protected page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * 等待页面加载
   */
  async waitForLoad() {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * 获取页面标题
   */
  async getTitle(): Promise<string> {
    return await this.page.title();
  }

  /**
   * 截图
   */
  async screenshot(name: string) {
    await this.page.screenshot({ path: `test-results/screenshots/${name}.png` });
  }
}
