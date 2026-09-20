# Hướng dẫn sử dụng Textpipe 1.0.0

Textpipe chuyển **một đoạn văn bản ngắn** giữa các máy Chrome đăng nhập cùng tài khoản Google, bật Chrome Sync và cài **cùng một extension identity**. Nó không phải công cụ gửi file, không tự đọc clipboard và không có biên nhận máy kia đã nhận.

## Chọn đúng cách cài

### Khi đã có item Chrome Web Store

Cài Textpipe từ **cùng một trang Store** trên cả hai máy. Kiểm tra cùng tài khoản Chrome Sync và extension đều được bật. Item Store có ID riêng do Store quản lý; không đối chiếu ID này với ID dành cho bản thử unpacked ở dưới.

### Khi thử trước khi lên Store bằng GitHub Release

1. Tải **`textpipe-1.0.0-cross-device.zip` trong Assets của GitHub Release** trên cả hai máy. Đừng dùng Source code ZIP do GitHub tự tạo.
2. Giải nén vào thư mục cố định. Mở `chrome://extensions`, bật **Developer mode**, chọn **Load unpacked**.
3. Chọn thư mục **`textpipe-1.0.0-cross-device-unpacked`**, nơi có `manifest.json` ngay ở cấp đầu tiên. Không chọn file ZIP hay thư mục `release` cha.
4. Trên **cả hai máy**, kiểm tra ID của bản thử unpacked là:

```text
khdimndigbjmblggkgjpbhkokechiedd
```

ID giống nhau **không** cho người dùng tài khoản Google khác thấy note của nhau. Chrome Sync còn tách dữ liệu theo tài khoản. Tuy nhiên, ai đăng nhập cùng tài khoản Chrome và cài cùng extension identity có thể nhận nội dung đã đồng bộ; hãy bảo vệ tài khoản và máy của bạn.

Không cài bản GitHub unpacked trên một máy và bản Store trên máy kia để thử nhận note: chúng là hai extension identity khác nhau.

## Gửi và nhận

### Từ popup

1. Bấm biểu tượng Textpipe trên thanh extension.
2. Dán hoặc gõ vào ô văn bản.
3. Bấm **Lưu để đồng bộ** hoặc nhấn `Ctrl+Enter` / `Cmd+Enter`.
4. Khi hiện **Đã lưu trên máy này để Chrome đồng bộ**, có thể đóng popup. Đây chưa phải xác nhận máy kia đã nhận.
5. Mở Textpipe ở máy kia. Khi nội dung xuất hiện, bấm **Sao chép** để đưa vào clipboard.

### Từ menu chuột phải

Bôi đen văn bản trên trang, bấm chuột phải → **Thêm vào Textpipe**. Popup sẽ hiển thị selection trong ô văn bản; chỉ khi bản ghi được xác nhận thành công nó mới hiện **Đã lưu**. Extension không quét trang, URL hoặc lịch sử duyệt web; nó chỉ nhận phần chữ bạn chủ động chọn sau cú click menu.

## Trạng thái và dấu trên biểu tượng

- **Bản nháp chưa lưu:** văn bản chỉ ở bộ nhớ phiên trên máy đang dùng; chưa đưa vào Chrome Sync.
- **Đã lưu trên máy này để Chrome đồng bộ:** Chrome đã chấp nhận bản ghi cục bộ. Sync sang máy kia có thể chậm hoặc bị tắt.
- Số **1** trên biểu tượng: có revision mới từ thiết bị khác chưa được mở tại máy này. Mở popup để xem sẽ xóa dấu sau khi revision đó được ghi nhận.
- Trạng thái **Có mạng** chỉ nói máy đang online, không phải xác nhận Chrome Sync hoặc máy nhận.

Chrome Sync hoạt động theo kiểu eventual consistency, không có thời hạn giao cố định hay biên nhận. Nếu hai máy sửa đồng thời, Textpipe cố giữ bản nháp và hiển thị lựa chọn khi phát hiện xung đột; vẫn nên kiểm tra nội dung cuối ở cả hai máy.

## Dung lượng và tự xóa

- Tối đa **5.000 byte UTF-8** cho mỗi nội dung; đây là số byte, không phải 5.000 từ. Tiếng Việt có dấu và emoji có thể tốn nhiều byte hơn chữ ASCII.
- Textpipe không âm thầm cắt nội dung quá dài.
- Trong **Cài đặt**, chọn thời gian tự xóa cho nội dung tiếp theo: 1 giờ, 24 giờ (mặc định), 7 ngày hoặc không tự xóa.
- Sau thời điểm hết hạn, nội dung được ẩn khi đọc; dọn dữ liệu vật lý có thể đến sau. Xóa/Reset không phải secure erase tức thời trên backup, clipboard history hay máy offline.

## Khóa riêng tư (tùy chọn)

Trong **Cài đặt**, bật **Khóa riêng tư** và đặt passphrase mạnh. Nội dung mới thuộc chế độ này được mã hóa AES-256-GCM trước khi lưu qua Chrome Sync. Nhập **cùng passphrase** trên mỗi máy sau khi mở lại Chrome; passphrase không được đồng bộ và không có cách khôi phục nếu quên. Bấm **Khóa ngay** để xóa khóa phiên khỏi bộ nhớ phiên.

Standard mode lưu note dạng plaintext trong Chrome Sync và draft dạng plaintext trong bộ nhớ phiên. Không dùng nó cho mật khẩu, OTP, API key, private key hoặc dữ liệu nhạy cảm. Khóa riêng tư cũng không bảo vệ máy đã nhiễm malware hoặc văn bản sau khi đã mở khóa và sao chép.

## Cập nhật và chuyển từ Gửi Sang

Khi cập nhật **cùng kênh cài đặt**, thay nội dung thư mục unpacked cố định bằng release mới rồi bấm **Reload** trong `chrome://extensions`, hoặc làm theo hướng dẫn cập nhật của Chrome Web Store. Trước khi gỡ bản cũ, kiểm tra dữ liệu ở cả hai máy và giữ bản sao văn bản quan trọng.

**Textpipe là extension/repository mới**: ID và namespace dữ liệu khác Gửi Sang cũ. Nội dung từ Gửi Sang, từ Textpipe bản unpacked và từ Textpipe Store item **không tự chuyển giữa các identity**. Muốn chuyển một note, mở bản cũ, sao chép văn bản theo cách thủ công, rồi dán và lưu vào đúng bản Textpipe mới. Đừng gỡ bản cũ trước khi đã xác nhận bản sao mới.

## Xử lý sự cố

| Hiện tượng | Kiểm tra |
|---|---|
| Chrome báo thiếu `manifest.json` | Chọn đúng thư mục unpacked chứa file đó ở cấp đầu tiên; không chọn ZIP, thư mục cha hoặc Source code ZIP. |
| Hai máy không thấy cùng note | Cùng tài khoản Chrome Sync? Sync có bật? Cùng Store item hoặc cùng ID unpacked? Cùng version? Thử mở popup lại sau khi mạng ổn định. |
| Không thấy menu chuột phải | Reload extension và trang web, bôi đen ít nhất một ký tự; cần Chrome desktop 127+. |
| Dấu `1` không xuất hiện | Bản lưu từ chính máy này không tạo dấu; dấu chỉ báo revision từ device ID khác chưa đọc. |
| Không thể lưu | Xem lỗi trong popup; kiểm tra 5.000 byte, khóa riêng tư đã mở, quota Sync và trạng thái xung đột. Draft được giữ để thử lại khi có thể. |
| Không thể mở khóa | Kiểm tra passphrase và đúng account/item extension; không có recovery cho passphrase đã quên. |

Nếu dùng GitHub Release, so SHA-256 của ZIP với `SHA256SUMS.txt` trong cùng release trước khi cài. Không gửi nội dung note hoặc passphrase thật khi báo lỗi.
