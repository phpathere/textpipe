# Đưa Textpipe 1.0.0 lên Chrome Web Store

Đây là checklist cho **chủ tài khoản publisher**, không phải xác nhận Textpipe đã được Store duyệt. Nội dung niêm yết tiếng Việt/Anh để tham khảo nằm tại `CHROME_WEB_STORE_LISTING.md`; hãy đối chiếu lần cuối với build và chính sách Store hiện hành.

## Mục đích duy nhất

Textpipe chuyển một đoạn văn bản ngắn do người dùng chủ động nhập hoặc chọn qua menu chuột phải giữa các bản cài cùng extension trên Chrome Sync. Không mô tả nó là messenger thời gian thực, clipboard monitor, password manager hoặc kho bí mật đã được chứng nhận.

## Vì sao cần ba quyền

| Quyền | Chức năng thực tế | Không dùng để |
|---|---|---|
| `storage` | `storage.sync` lưu note/cài đặt; `storage.local` lưu device ID/read cursor; `storage.session` lưu draft/khóa phiên | Đọc lịch sử duyệt web hoặc truyền dữ liệu tới server nhà phát triển |
| `alarms` | Dọn note hết hạn và bảo trì trạng thái khi Chrome đang chạy | Đánh thức máy khác hoặc xác nhận Sync đã giao |
| `contextMenus` | Hiện **Thêm vào Textpipe** cho văn bản người dùng bôi đen và click | Tự quét nội dung trang, URL hoặc title |

Manifest không xin host permission, `tabs`, `clipboardRead` hay content script. Các trang extension dùng tài nguyên local và CSP không cho kết nối mạng từ extension pages. Chỉ có dữ liệu mà Chrome Sync cần đồng bộ đi qua hạ tầng Chrome/Google.

## Khai báo quyền riêng tư

- Text người dùng nhập/chọn là **user-generated content**; xem xét có thuộc nhóm **personal communications** trong bảng Privacy Practices hay không tùy biểu mẫu hiện hành và nội dung sử dụng thực tế.
- Mục đích sử dụng: chức năng cốt lõi do người dùng yêu cầu. Không quảng cáo, phân tích hành vi, bán dữ liệu hoặc server riêng của nhà phát triển.
- Standard mode lưu plaintext trong Chrome storage; Private Lock tùy chọn mã hóa nội dung trước khi ghi vào Sync. Metadata vẫn có thể hiện diện. Không nói “dữ liệu không rời máy”.
- Draft tiêu chuẩn không đồng bộ nhưng ở dạng plaintext trong `storage.session`; passphrase không được lưu/đồng bộ; key phiên chỉ ở `storage.session` khi đã mở khóa.
- Chính sách quyền riêng tư phải điền người chịu trách nhiệm/liên hệ thật, được chủ sản phẩm rà soát và host tại URL HTTPS công khai trước khi submit.
- Chủ tài khoản phải tự rà lại và xác nhận các khai báo Limited Use, data usage và disclosure trong Dashboard; không đánh dấu theo mẫu một cách máy móc.

## Chuẩn bị bản ZIP

Từ đúng commit dự định phát hành, dùng Node 24 và npm 11:

```bash
npm ci
npm run release
```

Sau khi toàn bộ gate trong `RELEASE_READINESS.md` đạt, upload **`release/textpipe-1.0.0-chrome-web-store.zip`**. `manifest.json` phải nằm ở root của ZIP. Kiểm tra SHA-256 với `release/SHA256SUMS.txt`, danh sách file và phiên bản `1.0.0`; không upload source archive tự sinh của GitHub, `dist/` chưa nén, hay gói `cross-device`.

Gói `cross-device` có public development key và ID unpacked cố định `khdimndigbjmblggkgjpbhkokechiedd` để thử trên Mac/Windows. Gói Store **không có development key**. Item do Chrome Web Store tạo sẽ có ID riêng; sau khi có ID Store, hai máy phải cài **cùng Store item** để thử Sync. Dữ liệu từ bản unpacked hoặc từ Gửi Sang cũ không tự chuyển sang item Store mới.

## Checklist trong Developer Dashboard

- [ ] Xác minh tài khoản nhà phát triển, bật xác minh hai bước, kiểm tra quyền sử dụng artwork/logo.
- [ ] Tên **Textpipe**, version **1.0.0**, mô tả và hình ảnh khớp tính năng thực tế; screenshot chỉ dùng dữ liệu giả.
- [ ] Chỉ khai báo mục đích duy nhất và ba quyền nêu trên; không hứa giao tức thời/biên nhận/secure erase.
- [ ] Điền Privacy Practices trung thực; nhập URL chính sách HTTPS; điền support URL/email và các thông tin publisher thật.
- [ ] Chọn visibility/distribution phù hợp, ưu tiên phát hành giới hạn để kiểm tra trước.
- [ ] Kiểm thử item Store trên hai máy thật cùng tài khoản Chrome Sync: lưu/nhận, Unicode, badge, menu chuột phải, offline/reconnect, conflict, xóa/hết hạn, Private Lock.
- [ ] Kiểm tra khả năng truy cập: keyboard, nhãn form, focus, phóng to, tương phản, screen reader.
- [ ] Theo dõi review/support/crash sau phát hành, không yêu cầu người dùng gửi note/passphrase thật khi báo lỗi.

Việc upload và review có thể thay đổi theo quy định của Chrome Web Store; tham chiếu tài liệu chính thức: [Publish your extension](https://developer.chrome.com/docs/webstore/publish/), [Store listing requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements), [Privacy tab](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) và [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).
