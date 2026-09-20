# Textpipe 1.0.0 — release readiness

Tài liệu này chỉ áp dụng cho **repository Textpipe mới**. Kết quả kiểm thử, checksum và quyết định phát hành của Gửi Sang 1.3.0 không phải bằng chứng cho Textpipe 1.0.0.

## Phạm vi phát hành

- Manifest V3, Chrome desktop 127+; giao diện tiếng Việt và tiếng Anh.
- Một đoạn văn bản ngắn, tối đa 5.000 byte UTF-8, được lưu qua `chrome.storage.sync` khi người dùng chủ động bấm Lưu hoặc chọn mục menu chuột phải.
- Không có server riêng, host permission, content script, analytics hoặc clipboard monitor.
- Standard mode lưu nội dung dạng plaintext trong Chrome storage. Private Lock là tùy chọn mã hóa trước khi ghi vào Sync; chưa có kiểm toán mật mã độc lập.
- Chrome Sync là eventual consistency; việc lưu trên máy gửi không chứng minh máy nhận đã nhận.

## Bằng chứng kỹ thuật cho chính bản 1.0.0

Các kết quả dưới đây do quy trình build mới của Textpipe 1.0.0 tạo ra. Cần chạy lại nếu source thay đổi sau mốc xác minh; không sao chép số liệu của sản phẩm cũ.

| Gate | Trạng thái | Bằng chứng cần ghi |
|---|---|---|
| `npm ci` với lockfile | Pass | Cài đặt sạch; installer báo 0 vulnerabilities. Chưa thay thế review supply chain độc lập. |
| `npm run check` (format, lint, typecheck, unit, build, audit) | Pass | 108 automated tests; build audit kiểm 22 file / 212.087 byte |
| `npm run test:coverage` | Pass | Chạy trong `npm run release`; báo cáo coverage cần được lưu cùng hồ sơ phát hành |
| `npm run test:e2e` trên `dist/` | Pass | 5/5 Chromium E2E |
| `npm run test:e2e:pinned` trên gói unpacked | Pass | 5 Chromium E2E; ID `khdimndigbjmblggkgjpbhkokechiedd` |
| `npm run release` | Pass | Hai ZIP 1.0.0 và `release/SHA256SUMS.txt`; `unzip -t` cả hai gói đều pass; xem checksum dưới đây |

`npm ci` báo 0 vulnerabilities, nhưng chưa có bằng chứng `npm audit` riêng hoặc review độc lập về dependency/mật mã. Các việc đó vẫn nằm trong gate do chủ sản phẩm thực hiện, không được xem là Pass kỹ thuật đã kiểm chứng.

Không được dùng các chữ “đã audit độc lập”, “E2EE đã chứng nhận”, “giao tức thời” hoặc “xóa sạch vĩnh viễn” nếu chưa có bằng chứng riêng cho từng tuyên bố.

## Kiểm tra artifact

`npm run release` đã tạo:

```text
release/textpipe-1.0.0-cross-device-unpacked/
release/textpipe-1.0.0-cross-device.zip
release/textpipe-1.0.0-chrome-web-store.zip
release/SHA256SUMS.txt
```

Gói `cross-device` có **public development key** để hai bản cài unpacked cùng ID `khdimndigbjmblggkgjpbhkokechiedd`. Gói Store không có key này; **Chrome Web Store cấp identity riêng**. Hai kênh cài đặt không nên dùng lẫn trong thử nghiệm đồng bộ. Không có private signing key trong source hoặc ZIP.

Checksum SHA-256 của ZIP đã build cho 1.0.0:

```text
7ab5d8bce95d5132776ddf5a6840224ddeff450ef2cece1588acfe30265da18f  textpipe-1.0.0-cross-device.zip
2a11e0e9157257d43ede082d2a0d272cd086006814cbde10531a25fe30b5934a  textpipe-1.0.0-chrome-web-store.zip
```

Trước khi đính kèm GitHub Release hay upload Store, đối chiếu checksum với ZIP thực tế và giải nén kiểm tra `manifest.json` ngay tại root. Không dùng Source code ZIP tự sinh của GitHub để Load unpacked.

## Gate bắt buộc do chủ sản phẩm hoàn tất

- [ ] Điền tên nhà phát triển và support/security email thật trong chính sách quyền riêng tư và tài liệu bảo mật.
- [ ] Xuất bản chính sách quyền riêng tư tại URL HTTPS công khai, dễ tìm từ trang Store.
- [ ] Xác nhận quyền sử dụng thương mại đối với artwork/logo do người dùng cung cấp.
- [ ] Rà soát supply chain (`npm audit`, dependency/license diff) và xử lý hoặc ghi nhận ngoại lệ trước khi public.
- [ ] Bật xác minh hai bước cho tài khoản publisher và hoàn tất khai báo privacy/permission trong Developer Dashboard.
- [ ] Chụp screenshot và điền listing từ **gói 1.0.0 thực tế**, không dùng ảnh hoặc mô tả của sản phẩm cũ.
- [ ] Kiểm tra keyboard, VoiceOver/NVDA, zoom 200%, light/dark/forced colors trên bản 1.0.0 thực tế.
- [ ] Kiểm thử Mac + Windows trên hai máy thật với **cùng Store item** và cùng tài khoản Chrome Sync: Unicode, offline/reconnect, concurrent edits, badge, menu chuột phải, expiry, clear, Private Lock.
- [ ] Xem xét độc lập bảo mật/mật mã trước khi quảng bá Private Lock như một giải pháp E2EE.
- [ ] Kiểm tra privacy disclosure và quyền truy cập dữ liệu khớp hành vi của build cuối.

Cho tới khi toàn bộ gate kỹ thuật và owner-side hoàn tất, Textpipe 1.0.0 là **bản ứng viên để thử nghiệm**, không nên tuyên bố đã được phê duyệt hoặc phát hành công khai trên Chrome Web Store.
