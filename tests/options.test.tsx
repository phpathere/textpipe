import { render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/options/App";
import { enableEncryption, updateRetention } from "../src/shared/extension-api";
import { installChromeMock } from "./chrome-mock";

describe("options", () => {
  beforeEach(() => {
    installChromeMock();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("localizes the document and exposes actionable multi-device diagnostics", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Cài đặt Textpipe" });
    expect(document.documentElement.lang).toBe("vi");
    expect(document.title).toBe("Cài đặt · Textpipe");
    expect(screen.getByText("khdimndigbjmblggkgjpbhkokechiedd")).not.toBeNull();
    expect(screen.getByText("1.0.0")).not.toBeNull();
    expect(screen.getByText("Menu chuột phải")).not.toBeNull();
    expect(screen.getByText("Không tự đọc trang web")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Sao chép ID" }));
    await screen.findByText("Đã sao chép Extension ID.");
  });

  it("manages focus and passphrase visibility in the no-recovery private flow", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Cài đặt Textpipe" });

    const trigger = screen.getByRole("button", { name: "Bật khóa riêng tư" });
    await user.click(trigger);
    const firstField = await screen.findByLabelText("Passphrase mới");
    await waitFor(() => expect(document.activeElement).toBe(firstField));
    expect((firstField as HTMLInputElement).type).toBe("password");

    await user.click(screen.getByRole("button", { name: "Hiện passphrase" }));
    expect((firstField as HTMLInputElement).type).toBe("text");
    await user.click(screen.getByRole("button", { name: "Hủy" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Bật khóa riêng tư" }),
      ),
    );
  });

  it("refreshes settings when another context changes retention", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Cài đặt Textpipe" });

    await updateRetention(10_080);
    await screen.findByText("Cài đặt vừa thay đổi từ một cửa sổ hoặc máy khác.");
    await waitFor(() => {
      expect((screen.getByLabelText("Thời gian lưu") as HTMLSelectElement).value).toBe("10080");
    });
  });

  it("exposes a confirmed reset path for quota or unrecoverable data", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Cài đặt Textpipe" });

    await user.click(screen.getByRole("button", { name: "Khôi phục bằng cách xóa dữ liệu" }));
    expect(screen.getByText("Xóa dữ liệu Textpipe đã đồng bộ?")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Xóa và khôi phục" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Hủy" }));
    expect(screen.queryByRole("button", { name: "Xóa và khôi phục" })).toBeNull();
  });

  it("closes a stale private-mode form when another context changes security", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Cài đặt Textpipe" });
    await user.click(screen.getByRole("button", { name: "Bật khóa riêng tư" }));
    await screen.findByLabelText("Passphrase mới");

    await enableEncryption("correct horse battery staple");

    await screen.findByText("Đang bật khóa riêng tư");
    await waitFor(() => {
      expect(screen.queryByLabelText("Passphrase mới")).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Khóa riêng tư" }));
    });
  });
});
