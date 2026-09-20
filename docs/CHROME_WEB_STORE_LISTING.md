# Textpipe 1.0.0 — nội dung Chrome Web Store

Tài liệu này là bản nháp nội dung để chủ sản phẩm đưa vào Chrome Web Store Developer Dashboard. Chỉ đăng sau khi đối chiếu với package cuối cùng và hoàn tất các mục chủ tài khoản ở cuối trang. Không tuyên bố extension đã được Store phê duyệt.

## Mục đích duy nhất

Người dùng chủ động nhập, dán hoặc chọn một đoạn văn bản ngắn, rồi lưu qua Chrome Sync để mở trên Chrome khác thuộc cùng tài khoản và cùng Extension ID. Textpipe không phải dịch vụ chat thời gian thực, trình quản lý mật khẩu, ứng dụng chuyển file hoặc clipboard monitor.

## Tên và mô tả ngắn

**Tên:** Textpipe

**Mô tả ngắn (VI):** Chuyển đoạn văn bản ngắn giữa các máy Chrome của bạn qua Chrome Sync, không cần tài khoản riêng.

**Short description (EN):** Send short text between your Chrome devices with Chrome Sync, without another account.

Giữ mô tả trong giới hạn của manifest/Store và không dùng cụm “tức thời” hay “đã giao đến máy kia”.

## Mô tả dài tiếng Việt — bản có thể dán vào Store

```text
Textpipe giúp bạn chuyển một đoạn văn bản ngắn giữa các máy Chrome của chính mình.

Dán hoặc gõ vào popup rồi bấm Lưu để đồng bộ. Hoặc bôi đen chữ trên trang, bấm chuột phải và chọn Thêm vào Textpipe. Mở Textpipe ở máy kia để đọc và sao chép.

• Đồng bộ qua Chrome Sync; không cần tài khoản Textpipe hay máy chủ riêng của nhà phát triển.
• Badge “1” trên icon báo có nội dung mới từ máy khác chưa mở trên máy hiện tại.
• Bản nháp không đồng bộ khi đang gõ; nếu có thay đổi xung đột, bạn được chọn bản muốn giữ.
• Giới hạn 5.000 byte UTF-8 cho mỗi nội dung; thời hạn 1 giờ, 24 giờ, 7 ngày hoặc không tự xóa.
• Có Khóa riêng tư tùy chọn để mã hóa nội dung mới trước khi đưa vào Chrome Sync.
• Tiếng Việt và tiếng Anh; không tự đọc clipboard, lịch sử duyệt web hoặc toàn bộ trang web.

Để đồng bộ, hãy đăng nhập cùng tài khoản Google, bật Chrome Sync và cài cùng Textpipe/Extension ID trên các máy. Chrome Sync không cung cấp xác nhận máy kia đã nhận hay cam kết độ trễ.

Ở chế độ tiêu chuẩn, nội dung lưu trong Chrome Sync là văn bản thường. Không dùng chế độ tiêu chuẩn cho mật khẩu, OTP, API token hoặc dữ liệu nhạy cảm. Khóa riêng tư không mã hóa metadata và không thay thế công cụ quản lý mật khẩu.
```

## English listing description

```text
Textpipe moves a short text snippet between your own Chrome devices.

Paste or type in the popup and choose Save to sync. You can also select text on a web page, right-click, and choose Add to Textpipe. Open Textpipe on another device to read and copy it.

• Uses Chrome Sync; no separate Textpipe account or developer-operated server.
• A “1” badge marks a new snippet from another device that has not been opened here.
• Drafts stay on the current device until you save. Conflicting edits are surfaced instead of silently replacing a draft.
• Up to 5,000 UTF-8 bytes per snippet; choose 1 hour, 24 hours, 7 days, or no automatic expiration.
• Optional Private Lock encrypts new content before writing it to Chrome Sync.
• Vietnamese and English UI; no automatic clipboard reading or full-page scanning.

Sync requires the same Google account with Chrome Sync enabled and the same Textpipe extension ID on each device. Chrome Sync does not provide delivery receipts or a guaranteed delivery time.

Standard mode stores your saved text as plaintext in Chrome Sync. Do not use Standard mode for passwords, one-time codes, API tokens, or sensitive information. Private Lock does not encrypt metadata and is not a password manager.
```

## Quyền và dữ liệu — điền vào Privacy tab theo package thực tế

| Mục | Giải thích trung thực |
|---|---|
| `storage` | Lưu nội dung/thiết lập trong `chrome.storage.sync`; bản nháp/khóa phiên trong `storage.session`; ID thiết bị và dấu đã đọc trong `storage.local`. |
| `alarms` | Dọn nội dung hết hạn khi Chrome đang chạy. Không đánh thức máy hoặc gửi nội dung đến server của Textpipe. |
| `contextMenus` | Tạo mục menu khi có văn bản được chọn; chỉ xử lý `selectionText` sau cú bấm của người dùng. |
| Dữ liệu người dùng | Đoạn chữ do người dùng nhập/chọn có thể là **User-generated content** và tùy nội dung cũng có thể là **Personal communications**. Cần khai báo theo thực tế, dù không có server riêng. |
| Nơi dữ liệu đi | Chrome Sync/Google xử lý bản ghi cho mục đích đồng bộ. Standard mode lưu nội dung dạng plaintext ở tầng extension; Private Lock mã hóa content trước khi ghi Sync. |
| Mục đích sử dụng | Chức năng cốt lõi: lưu, đồng bộ, hiển thị, sao chép, hết hạn/xóa và mã hóa tùy chọn. Không bán dữ liệu, quảng cáo hay analytics. |

Không khai “data never leaves device”, “end-to-end encrypted by default”, “zero knowledge”, “instant sync” hoặc “secure erase”. Trang [chính sách quyền riêng tư](PRIVACY_POLICY.md) phải có tên nhà phát triển, email hỗ trợ và URL HTTPS thật trước khi submit. Nếu hành vi dữ liệu thay đổi, cập nhật listing, Privacy tab và policy cùng lúc.

## Hình ảnh và thông tin listing

- Dùng icon Textpipe đang được đóng gói trong `public/icons/`, không dùng nhãn/ảnh có thể gây hiểu lầm là sản phẩm của Google hoặc Midjourney.
- Chụp ảnh popup khi lưu và badge có nội dung giả lập; chụp trang cài đặt và trạng thái Khóa riêng tư. Không dùng đoạn chữ, email hoặc passphrase thật.
- Kiểm tra ngôn ngữ Việt/Anh, kích thước và số lượng ảnh hiện hành trong Developer Dashboard trước khi tải lên.
- Điền support URL/email thật; nếu repository còn private thì đừng dùng URL đó làm trang hỗ trợ công khai.

## Checklist trước khi gửi duyệt

- [ ] Kiểm tra quyền sử dụng tên “Textpipe” và artwork logo cho phân phối công khai.
- [ ] Thay placeholder tên pháp lý/nhà phát triển, email hỗ trợ và security contact trong privacy/security docs; host policy ở URL HTTPS công khai.
- [ ] Bật xác thực hai bước cho tài khoản publisher và kiểm tra quyền truy cập dashboard.
- [ ] Chạy `npm ci`, `npm run check`, `npm run test:coverage`, `npm run release` rồi `npm run test:e2e:pinned`; giải quyết hoặc ghi nhận kết quả audit dependency.
- [ ] Đối chiếu `package.json` và `manifest.json` đều là `1.0.0`; kiểm tra ZIP, SHA-256 và `manifest.json` ở root.
- [ ] Upload **`release/textpipe-1.0.0-chrome-web-store.zip`**. Không upload gói `cross-device`, `dist/` ZIP tự tạo khác, hoặc Source code ZIP của GitHub.
- [ ] Điền Store listing, Privacy tab, permission justification, data disclosure, privacy policy URL và mục phân phối theo package cuối.
- [ ] Cài **cùng Store item** trên hai máy thật, cùng Google Account/Chrome Sync; test lưu, badge, menu chuột phải, offline/reconnect, xung đột, xóa/hết hạn, Khóa riêng tư và khôi phục khi quota lỗi.
- [ ] Ghi nhận Extension ID do Store cấp; ID Store có thể khác ID load-unpacked `khdimndigbjmblggkgjpbhkokechiedd`. Cập nhật hướng dẫn trước khi công bố cho người dùng.
- [ ] Chỉ tuyên bố E2EE/kiểm toán mật mã nếu có đánh giá độc lập phù hợp; hiện tài liệu không đưa ra tuyên bố đó.

Theo tài liệu chính thức của Chrome: [quy trình xuất bản](https://developer.chrome.com/docs/webstore/publish/), [khai báo Privacy tab](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [yêu cầu về dữ liệu người dùng](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) và [yêu cầu listing](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements).
