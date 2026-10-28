import { type Page } from "@playwright/test";

export async function setMedicationTime(page: Page, index: number, time: string) {
  await page.getByRole("button", { name: `복용 시간 ${index}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `복용 시간 ${index} 설정` });
  const [hour, minute] = time.split(":");
  await dialog.getByRole("textbox", { name: "시", exact: true }).fill(hour);
  await dialog.getByRole("textbox", { name: "분", exact: true }).fill(minute);
  await dialog.getByRole("button", { name: "시간 적용", exact: true }).click();
}
