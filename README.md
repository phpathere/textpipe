# Textpipe 1.0.0

Textpipe là tiện ích Chrome để chuyển **một đoạn văn bản ngắn** giữa các máy tính của chính bạn. Dán chữ vào popup hoặc chọn chữ trên trang rồi dùng menu chuột phải; máy còn lại mở Textpipe để đọc và sao chép. Textpipe dùng Chrome Sync của tài khoản Google đang đăng nhập, không yêu cầu tạo tài khoản Textpipe hay vận hành máy chủ riêng.

> Điều kiện đồng bộ: hai máy dùng Chrome 127 trở lên, đăng nhập **cùng tài khoản Google**, bật Chrome Sync và cài Textpipe có **cùng Extension ID**. Việc lưu thành công trên máy này không phải xác nhận máy kia đã nhận; Chrome Sync không cung cấp thời gian giao hàng cam kết.

## Tính năng

- **Một ô chia sẻ, một thao tác lưu rõ ràng:** nhập hoặc dán văn bản, bấm **Lưu để đồng bộ** hoặc `Ctrl+Enter` / `Cmd+Enter`. Gõ chữ chỉ tạo bản nháp trên máy hiện tại; không tự gửi từng phím.
- **Gửi từ menu chuột phải:** bôi đen văn bản trên trang, chọn **Thêm vào Textpipe** (hoặc **Add to Textpipe**). Popup mở với phần chữ đã chọn và chỉ báo **Đã lưu** sau khi xác nhận bản ghi vừa lưu. Textpipe không tự đọc toàn bộ trang hay URL.
- **Dấu hiệu nội dung mới:** icon hiện badge `1` khi có phiên bản mới từ máy khác chưa được mở trên máy hiện tại. Đây là tín hiệu chưa đọc, **không phải** số lượng tin nhắn.
- **Sao chép bằng một cú bấm:** mở popup ở máy nhận rồi bấm **Sao chép**. Extension không tự đọc clipboard hoặc tự sao chép khi chưa được yêu cầu.
- **Giữ bản nháp khi có xung đột:** nếu máy khác thay đổi nội dung trong lúc bạn đang soạn, Textpipe không âm thầm ghi đè bản nháp; giao diện yêu cầu chọn bản muốn dùng. Sau khi lưu, extension kiểm tra lại trạng thái đồng bộ trên chính máy đó.
- **Hạn dùng tùy chọn:** 1 giờ, 24 giờ (mặc định), 7 ngày hoặc không tự xóa. Nội dung hết hạn được ẩn; dọn bản ghi có thể chậm khi Chrome đóng hoặc máy offline.
- **Khóa riêng tư tùy chọn:** mã hóa nội dung mới bằng AES-256-GCM trước khi ghi vào Chrome Sync. Passphrase không được đồng bộ; mỗi máy phải mở khóa riêng sau khi Chrome khởi động lại. Quên passphrase thì không thể khôi phục nội dung đã mã hóa.
- **Giới hạn rõ ràng:** tối đa **5.000 byte UTF-8** cho mỗi lần lưu; tiếng Việt và emoji có thể dùng nhiều byte hơn số ký tự nhìn thấy. Textpipe không truyền file và không theo dõi clipboard liên tục.
- **Tiếng Việt và tiếng Anh:** theo ngôn ngữ Chrome. Giao diện có hỗ trợ bàn phím, focus rõ, reduced motion và chế độ tương phản cưỡng bức.

## Cài thử trên Mac và Windows từ GitHub

1. Mở [GitHub Releases của Textpipe](https://github.com/phpathere/textpipe/releases) và tải **Asset** `textpipe-1.0.0-cross-device.zip`. Hai file **Source code (zip/tar.gz)** do GitHub tự tạo **không phải** gói cài extension.
2. Giải nén ZIP vào thư mục cố định trên mỗi máy. Trong thư mục bạn chọn để cài phải thấy `manifest.json` ở **ngay cấp đầu tiên**; không chọn chính file ZIP hoặc thư mục `release` cha.
3. Mở `chrome://extensions`, bật **Developer mode / Chế độ dành cho nhà phát triển**, bấm **Load unpacked / Tải tiện ích đã giải nén**, chọn đúng thư mục ở bước 2.
4. Trong **Details / Chi tiết**, kiểm tra Extension ID trên **cả hai máy** là:

   ```text
   khdimndigbjmblggkgjpbhkokechiedd
   ```

5. Xác nhận cùng tài khoản Google và Chrome Sync đang bật trên cả hai Chrome, rồi thử lưu một đoạn chữ ở máy thứ nhất và mở Textpipe ở máy thứ hai.

ID này là **ID cố định của gói load-unpacked để thử nhiều máy**, không phải mật khẩu và không cấp quyền xem dữ liệu của người dùng khác. Dữ liệu Chrome Sync còn được phân tách theo tài khoản. Khi cài từ Chrome Web Store, hãy cài **cùng một Store item** trên hai máy; item đó có thể có ID khác gói thử ở trên. Hai ID khác nhau không đồng bộ với nhau.

### Nếu không thấy dữ liệu ở máy kia

Kiểm tra lần lượt: đúng tài khoản Chrome Sync, Sync đang bật, cùng Textpipe 1.0.0, cùng Extension ID, và nội dung đã hiện trạng thái **Đã lưu trên máy này để Chrome đồng bộ**. Mạng đang hoạt động không bảo đảm bản ghi đã đến máy còn lại. Hãy đợi Chrome Sync hoàn tất rồi mở lại popup. Nếu Chrome báo thiếu manifest, bạn đã chọn sai cấp thư mục khi **Load unpacked**.

Đọc [hướng dẫn sử dụng chi tiết](docs/USER_GUIDE.md) để biết cách dùng Khóa riêng tư, xóa và xử lý sự cố.

## Riêng tư và bảo mật — cần đọc trước khi sử dụng

Ở **chế độ tiêu chuẩn**, nội dung đã lưu là plaintext trong `chrome.storage.sync`; bản nháp tiêu chuẩn là plaintext trong `chrome.storage.session` của máy hiện tại. Không dùng chế độ này cho mật khẩu, OTP, khóa riêng, API token hoặc thông tin nhạy cảm. Dữ liệu Sync đi qua hạ tầng Chrome/Google theo cấu hình tài khoản của bạn, dù Textpipe không có server riêng.

**Khóa riêng tư** dùng Web Crypto với PBKDF2-HMAC-SHA-256 và AES-256-GCM để mã hóa nội dung trước khi lưu vào Chrome Sync. Metadata như thời gian, hạn dùng, số lượng và kích thước bản ghi không được mã hóa. Bản cũ từng đồng bộ ở dạng plaintext, clipboard history, backup hoặc thiết bị offline có thể còn lưu dấu vết. Khóa riêng tư không bảo vệ khỏi malware, keylogger hay một bản cập nhật extension độc hại; chưa có kiểm toán mật mã độc lập. Không quảng bá Textpipe là công cụ lưu secret hay hệ thống “zero knowledge”.

Textpipe chỉ xin ba quyền: `storage` (bản ghi/thiết lập và bản nháp), `alarms` (dọn nội dung hết hạn khi Chrome chạy) và `contextMenus` (nhận đúng phần chữ người dùng chủ động chọn). Không xin quyền truy cập mọi website, lịch sử duyệt web, tab hoặc đọc clipboard. Không có analytics, quảng cáo, remote code hay kết nối mạng riêng của extension. Xem [mô hình bảo mật](docs/SECURITY.md) và [chính sách quyền riêng tư](docs/PRIVACY_POLICY.md).

## Chuyển từ Gửi Sang sang Textpipe

Textpipe là **sản phẩm/Extension ID mới**, không phải bản cập nhật cùng ID của Gửi Sang. Chrome không tự chuyển nội dung hoặc cài đặt giữa hai extension. Mở Gửi Sang, mở khóa nếu đang dùng Khóa riêng tư, **sao chép nội dung còn cần**, dán và lưu lại trong Textpipe; cấu hình lại thời hạn và Khóa riêng tư nếu muốn. Chỉ gỡ Gửi Sang sau khi đã kiểm tra nội dung ở Textpipe trên cả hai máy. Không cài gói thử load-unpacked và bản Chrome Web Store rồi mong chúng dùng chung dữ liệu khi ID khác nhau.

## Dành cho người phát triển

Stack: Manifest V3; TypeScript (strict), Preact và Vite; font Plus Jakarta Sans tự đóng gói; Web Crypto API; Vitest/Testing Library, Playwright Chromium và Biome. Không dùng content script hoặc host permission. Dependency được pin trong `package-lock.json`.

Yêu cầu Node.js 24, npm 11 và Chrome 127 trở lên:

```bash
npm ci
npm run check
npx playwright install chromium
npm run release
npm run test:e2e:pinned
```

`npm run check` chạy format, lint, typecheck, test, build và kiểm tra gói. `npm run release` dọn output cũ trong allowlist, chạy quality gate/coverage rồi tạo hai ZIP và `release/SHA256SUMS.txt`:

| Gói | Mục đích |
|---|---|
| `release/textpipe-1.0.0-cross-device.zip` | Load-unpacked để thử trên Mac/Windows với cùng development ID. |
| `release/textpipe-1.0.0-chrome-web-store.zip` | Upload vào Chrome Web Store; `manifest.json` ở root ZIP, không kèm development `key`. |

Không upload gói `cross-device` lên Store. Không dùng Source code ZIP làm gói cài. Trước khi phát hành công khai, chủ sản phẩm phải hoàn tất [checklist Chrome Web Store](docs/CHROME_WEB_STORE_LISTING.md): thông tin nhà phát triển, privacy policy tại URL HTTPS, khai báo dữ liệu/quyền, ảnh chụp thật, tài khoản publisher an toàn và thử cùng một Store item trên hai máy thật. Repository và bản build **không đồng nghĩa** Chrome Web Store đã duyệt hoặc đã xuất bản.

## Tài liệu

- [Hướng dẫn sử dụng](docs/USER_GUIDE.md)
- [Nội dung listing và checklist Chrome Web Store](docs/CHROME_WEB_STORE_LISTING.md)
- [Chính sách quyền riêng tư](docs/PRIVACY_POLICY.md)
- [Mô hình bảo mật](docs/SECURITY.md)
- [Kiến trúc đồng bộ](docs/ARCHITECTURE.md)
- [Kế hoạch kiểm thử](docs/TEST_PLAN.md)
- [Duy trì dự án](docs/MAINTENANCE.md)
