// @test-env dom
import { describe, expect, jest, mock, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";

async function load({ editable, dirty, choice = "open" }) {
  resetModules();
  const showConfirmDialog = jest.fn(async () => choice);
  await mock.module("../../frontend/src/js/ui/dialog.js", () => ({ showConfirmDialog }));
  await mock.module("../../frontend/src/js/state/edit-mode.js", () => ({ canEdit: () => editable }));
  await mock.module("../../frontend/src/js/state/unsaved-changes.js", () => ({
    hasUnsavedChanges: () => dirty,
  }));
  const { confirmDiscardChanges } = await import("../../frontend/src/js/ui/confirm-discard.js");
  return { confirmDiscardChanges, showConfirmDialog };
}

describe("confirmDiscardChanges", () => {
  test("resolves true without a dialog when there are no unsaved changes", async () => {
    const { confirmDiscardChanges, showConfirmDialog } = await load({ editable: true, dirty: false });
    expect(await confirmDiscardChanges()).toBe(true);
    expect(showConfirmDialog).not.toHaveBeenCalled();
  });

  test("resolves true without a dialog when the asset is not editable", async () => {
    const { confirmDiscardChanges, showConfirmDialog } = await load({ editable: false, dirty: true });
    expect(await confirmDiscardChanges()).toBe(true);
    expect(showConfirmDialog).not.toHaveBeenCalled();
  });

  test("asks when there are unsaved changes and resolves true on Open", async () => {
    const { confirmDiscardChanges, showConfirmDialog } = await load({ editable: true, dirty: true });
    expect(await confirmDiscardChanges()).toBe(true);
    expect(showConfirmDialog).toHaveBeenCalledTimes(1);
    expect(showConfirmDialog.mock.calls[0][0]).toBe("Open another asset?");
  });

  test("Cancel keeps the open asset", async () => {
    const { confirmDiscardChanges } = await load({ editable: true, dirty: true, choice: "cancel" });
    expect(await confirmDiscardChanges()).toBe(false);
  });
});
