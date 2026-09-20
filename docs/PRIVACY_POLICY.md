# Chính sách quyền riêng tư — Textpipe 1.0.0

- **Ngày hiệu lực:** `[ĐIỀN NGÀY ĐĂNG CHÍNH SÁCH]`
- **Nhà phát triển:** `[ĐIỀN TÊN PHÁP LÝ/CÁ NHÂN]`
- **Liên hệ:** `[ĐIỀN SUPPORT EMAIL]`

> Đây là bản dự thảo cho chủ sản phẩm rà soát. Phải điền mọi placeholder, kiểm tra hành vi của build cuối và host chính sách tại URL HTTPS công khai trước khi gửi Chrome Web Store. Chưa nên trỏ Store đến file trong repository như một chính sách đã có hiệu lực.

## 1. Textpipe làm gì

Textpipe cho phép bạn chủ động nhập một đoạn văn bản nhỏ hoặc chọn chữ trên trang bằng menu **Thêm vào Textpipe**, rồi lưu qua Chrome Sync để mở trên các trình duyệt Chrome khác đăng nhập cùng tài khoản và cài cùng extension.

Textpipe là sản phẩm mới, với Extension ID và namespace riêng. Dữ liệu từ Gửi Sang trước đây hoặc từ một bản cài Textpipe có ID khác không tự động được chuyển sang đây.

## 2. Dữ liệu được xử lý

Extension có thể xử lý:

- nội dung văn bản bạn chủ động nhập hoặc chọn qua menu chuột phải;
- UUID ngẫu nhiên của record và của cài đặt extension trên thiết bị;
- thời gian tạo/cập nhật/hết hạn;
- lựa chọn retention và cấu hình khóa riêng tư;
- bản nháp trong bộ nhớ phiên Chrome;
- ciphertext, IV, salt và thông số KDF khi bật khóa riêng tư.

Passphrase không được lưu hoặc đồng bộ. Khóa dẫn xuất chỉ được cache trong bộ nhớ phiên Chrome và bị xóa khi phiên kết thúc hoặc bạn khóa thủ công.

## 3. Dữ liệu được dùng như thế nào

Dữ liệu chỉ được dùng để cung cấp chức năng người dùng yêu cầu: nhận phần chữ đã chọn sau cú bấm menu, lưu, đồng bộ, hiển thị, sao chép, mã hóa/giải mã, hết hạn và xóa đoạn văn bản dùng chung.

Extension không dùng dữ liệu cho quảng cáo, profiling, credit scoring, bán dữ liệu hoặc mục đích không liên quan.

## 4. Lưu trữ và truyền dữ liệu

- Textpipe không vận hành server riêng và nhà phát triển không nhận bản sao nội dung qua server của mình.
- Nội dung/ciphertext và settings được lưu bằng `chrome.storage.sync`. Chrome/Google xử lý dữ liệu này để cung cấp Chrome Sync theo điều khoản và chính sách của Google.
- Nếu Chrome Sync bị tắt, `storage.sync` hoạt động như storage cục bộ và dữ liệu không sang máy khác.
- Draft và derived key dùng `chrome.storage.session`; device UUID dùng `chrome.storage.local`. Standard draft là plaintext. Khi khóa riêng tư đang mở khóa, draft được mã hóa trước khi ghi vào session storage.

Ở chế độ tiêu chuẩn, nội dung nằm dạng plaintext trong extension storage. Không dùng chế độ này cho mật khẩu, OTP, private key, API token hoặc dữ liệu nhạy cảm.

Ở chế độ khóa riêng tư, nội dung được mã hóa ở tầng ứng dụng bằng AES-256-GCM trước khi ghi vào Chrome Sync. Metadata thời gian, expiry, số lượng và kích thước record vẫn có thể nhìn thấy.

Nếu một máy đã có standard plaintext draft rồi nhận thay đổi bật khóa riêng tư từ máy khác trong lúc chưa có passphrase, extension chưa thể mã hóa draft đó. Draft vẫn chỉ ở bộ nhớ phiên của máy, không sync và không hiển thị khi đang khóa; nó được mã hóa sau lần mở khóa thành công hoặc biến mất khi phiên kết thúc.

## 5. Clipboard

Extension không tự đọc clipboard và không yêu cầu quyền `clipboardRead`. Nội dung chỉ được copy khi bạn nhấn nút Copy. Clipboard và clipboard history do hệ điều hành/ứng dụng khác quản lý và không bị xóa bởi Textpipe.

Textpipe cũng không tự đọc trang web. Quyền `contextMenus` chỉ tạo mục menu khi có phần chữ được chọn. Sau khi bạn bấm mục đó, extension nhận đúng `selectionText`; extension không lưu URL trang, tiêu đề tab hoặc lịch sử duyệt web.

## 6. Thời gian lưu và xóa

Mặc định note mới hết hạn sau 24 giờ. Bạn có thể chọn 1 giờ, 24 giờ, 7 ngày hoặc không tự xóa.

Khi note hết hạn, extension ẩn nó và cố dọn storage khi Chrome đang chạy. Clear/expiry ghi một mốc trạng thái rỗng trước khi dọn tự động theo hai pha để history cũ không tự xuất hiện lại.

Tùy chọn Reset trong Cài đặt là recovery phá hủy cần xác nhận. Extension remove malformed key có prefix Textpipe, kiểm tra projected quota, pre-compact chính xác state key Textpipe cũ rồi ghi trạng thái rỗng/cài đặt mặc định; extension không gọi `storage.sync.clear()` và giữ key ngoài namespace Textpipe. Nếu key ngoài namespace chiếm quá nhiều quota, reset có thể từ chối trước destructive compaction. Máy offline, Chrome đang tắt, Chrome Sync backup hoặc việc replay cả settings/payload cũ vẫn có thể giữ hay làm xuất hiện lại bản sao. Textpipe không hứa secure erase tức thời.

## 7. Chia sẻ và bán dữ liệu

Nhà phát triển không bán dữ liệu, không chuyển dữ liệu cho nhà quảng cáo và không cho con người đọc nội dung. Chrome/Google là hạ tầng xử lý cần thiết để cung cấp Chrome Sync; extension không thêm bên xử lý dữ liệu nào khác.

## 8. Bảo mật

Extension dùng permission tối thiểu, không có host/tab access, không tự quét trang, không có analytics/remote code và dùng CSP chặn kết nối mạng. Khóa riêng tư là tùy chọn. Không giải pháp client nào bảo vệ được dữ liệu khỏi malware/keylogger trên máy đã mở khóa hoặc bản cập nhật extension độc hại.

## 9. Lựa chọn của bạn

Bạn có thể:

- không nhập dữ liệu;
- chọn retention ngắn hơn;
- bật khóa riêng tư;
- Clear note;
- dùng Reset có xác nhận để xóa dữ liệu Textpipe đã đồng bộ và khôi phục cài đặt mặc định;
- xóa extension để xóa local/session storage của extension trên máy đó;
- quản lý hoặc tắt Chrome Sync trong Chrome settings.

## 10. Trẻ em

Textpipe không được thiết kế để thu thập dữ liệu từ trẻ em và không yêu cầu ngày sinh hoặc hồ sơ người dùng.

## 11. Thay đổi chính sách

Nếu behavior, permission, processor hoặc mục đích dữ liệu thay đổi, chính sách này và disclosure Chrome Web Store phải được cập nhật trước khi phát hành phiên bản tương ứng. Ngày hiệu lực ở đầu trang sẽ được sửa.

## 12. Limited Use

Việc sử dụng thông tin nhận được từ Chrome APIs tuân thủ Chrome Web Store User Data Policy, bao gồm Limited Use requirements. Dữ liệu chỉ được dùng hoặc chuyển để cung cấp/cải thiện tính năng người dùng yêu cầu, cho bảo mật hoặc khi pháp luật bắt buộc; không dùng cho quảng cáo cá nhân hóa và không cho phép con người đọc trừ các ngoại lệ được chính sách cho phép và có consent/pháp lý phù hợp.

## 13. Liên hệ

Gửi câu hỏi quyền riêng tư đến: `[SUPPORT EMAIL]`.
