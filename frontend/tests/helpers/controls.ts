import type { Locator } from "@playwright/test";
export async function selectPixelOption(
  control: Locator,
  choice: string | { value?: string; label?: string },
) {
  await control.click();
  const list = control.page().getByRole("listbox").filter({ visible: true });
  if (typeof choice !== "string" && choice.label)
    await list.getByRole("option", { name: choice.label, exact: true }).click();
  else {
    const value = typeof choice === "string" ? choice : choice.value!;
    await list.locator(`[role="option"][data-value="${value}"]`).click();
  }
}
