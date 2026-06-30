import { Page, expect } from '@playwright/test';

/**
 * 等待页面加载完成
 */
export async function waitForPageLoad(page: Page) {
  await page.waitForLoadState('networkidle');
}

/**
 * 等待元素可见
 */
export async function waitForElement(page: Page, selector: string, timeout = 5000) {
  await page.waitForSelector(selector, { state: 'visible', timeout });
}

/**
 * 点击元素并等待
 */
export async function clickAndWait(page: Page, selector: string, waitTime = 1000) {
  await page.click(selector);
  await page.waitForTimeout(waitTime);
}

/**
 * 填写输入框
 */
export async function fillInput(page: Page, selector: string, value: string) {
  await page.fill(selector, value);
}

/**
 * 验证元素存在
 */
export async function assertElementExists(page: Page, selector: string, message?: string) {
  const element = page.locator(selector);
  if (message) {
    await expect(element).toBeVisible({ timeout: 5000 });
  } else {
    await expect(element).toBeVisible({ timeout: 5000 });
  }
}

/**
 * 验证元素不存在
 */
export async function assertElementNotExists(page: Page, selector: string, message?: string) {
  const element = page.locator(selector);
  if (message) {
    await expect(element).not.toBeVisible({ timeout: 5000 });
  } else {
    await expect(element).not.toBeVisible({ timeout: 5000 });
  }
}

/**
 * 获取元素文本
 */
export async function getElementText(page: Page, selector: string): Promise<string> {
  return await page.locator(selector).textContent() || '';
}

/**
 * 等待API响应
 */
export async function waitForAPIResponse(page: Page, urlPattern: string, timeout = 30000) {
  await page.waitForResponse(
    response => response.url().includes(urlPattern),
    { timeout }
  );
}

/**
 * 截图保存
 */
export async function takeScreenshot(page: Page, name: string) {
  await page.screenshot({ path: `test-results/screenshots/${name}.png` });
}
