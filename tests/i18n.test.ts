import { describe, expect, it } from "vitest";
import { InvalidPassphraseError, LockedError, StorageDataError } from "../src/shared/errors";
import { createTranslator, getLocalizedErrorMessage } from "../src/shared/i18n";

describe("localized errors", () => {
  it("maps security errors to the active UI language", () => {
    const en = createTranslator("en");
    const vi = createTranslator("vi");

    expect(getLocalizedErrorMessage(new InvalidPassphraseError(), en)).toBe(
      "That passphrase is incorrect.",
    );
    expect(getLocalizedErrorMessage(new LockedError(), en)).toContain("Unlock private lock");
    expect(getLocalizedErrorMessage(new StorageDataError(), vi)).toContain(
      "Dữ liệu đồng bộ không hợp lệ",
    );
  });

  it("preserves actionable platform errors and localizes unknown failures", () => {
    const en = createTranslator("en");
    expect(getLocalizedErrorMessage(new Error("QUOTA_BYTES quota exceeded"), en)).toBe(
      "QUOTA_BYTES quota exceeded",
    );
    expect(getLocalizedErrorMessage({ failed: true }, en)).toBe("Something went wrong.");
  });
});
