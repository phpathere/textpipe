# Test plan

## Automated gates

### Unit/domain/security

- UTF-8 byte count: ASCII, tiếng Việt, emoji.
- 5.000/5.001 byte boundary, exact serialized item/total quota và item-count reserve.
- Runtime validation của note, legacy settings, retention/security v2, tombstone, clear barrier, plaintext draft v1 và encrypted draft v2.
- Hostile HTML/script giữ nguyên inert text.
- Expiry inclusive boundary, stable event tie-breaker và regression: expiry của note cũ không được che note `never` mới hơn.
- PBKDF2/AES-GCM round-trip, wrong passphrase, nonce uniqueness.
- Ciphertext và AAD tamper rejection.

### Storage integration

- Immutable unique keys, concurrent writes cùng tồn tại.
- Stale base revision tạo conflict.
- Standard draft chỉ ở session; private draft là ciphertext và chỉ decrypt khi active key đã unlock.
- Lock giữ encrypted draft nhưng xóa key; plaintext draft gặp settings lỗi bị purge fail-closed.
- Pre-transition standard draft nhận remote Private mode bị ẩn khi locked rồi mã hóa sau unlock; remote disable với cached old key migrate draft về standard và purge key.
- Save chỉ xóa draft sau canonical read-after-write; remote write mới hơn đến giữa save phải giữ local draft và hiện conflict.
- Clear tạo durable barrier; note `retention: never` không sống lại sau tombstone window.
- Expired note bị ẩn và dọn; note `never` cũ hơn không sống lại sau expiry của note mới.
- Enable/lock/unlock/disable encryption; barrier + replacement + epoch commit cùng lần ghi; commit failure giữ nguyên old mode và old note.
- Retention update concurrent không thể bật/tắt encryption hoặc ghi đè security revision.
- Save/Clear không ghi fixed settings; delayed standard Save không thể hạ Private epoch. Transition/reset mới ghi security fixed key; malformed legacy mirror bị bỏ qua khi split v2 đã đủ.
- Note của security epoch mới đến trước settings được giữ qua local-observation grace; settings đến trước target event làm mutation bị chặn.
- Plaintext replay trong private mode bị ignore rồi scrub sau grace period.
- Settings malformed/near-quota có reset xác nhận; projected-preflight + pre-compaction xử lý cả valid byte/item hard quota, interrupted reset retry được, key ngoài namespace Textpipe được giữ và không gọi `storage.sync.clear()`.
- Write thường giữ 16 KiB/64 slots; emergency transition giữ 4 KiB/8 slots; tombstone cleanup dùng được reserve cuối, chia nhỏ batch và chỉ remove payload ở lượt grace sau.
- Malformed namespaced item bị ignore không crash.
- Badge chỉ hiện `1` cho canonical revision từ máy khác; self-write và stale replica không bật badge.
- Context menu chỉ đăng ký cho selection, giữ nguyên Unicode/whitespace, không lưu URL/tab metadata và serialize hai click qua worker queue.
- Context Save kiểm tra biên 5.000/5.001 byte, canonical read-after-write, xóa draft chỉ sau success; locked/quota/race không có false Saved hoặc plaintext residue.
- Read cursor sống qua reconciliation; acknowledge snapshot cũ không xóa badge của revision mới hơn.
- Acknowledgment cũ hoàn tất sau acknowledgment mới không ghi lùi watermark; popup không ghi toolbar trực tiếp.

### Component

- User action bắt buộc trước Sync write.
- XSS payload không tạo DOM node.
- Oversize không bị truncate và Save disabled.
- Remote update khi dirty giữ draft và hiện lựa chọn.
- Sync đến giữa initial load vẫn render state mới nhất và kết thúc loading.
- Options đặt đúng `html[lang]`/title, hiển thị version + Extension ID có nút Copy.
- Form private quản lý focus, show/hide passphrase, ARIA error/busy và Caps Lock.
- Options refresh khi settings/session thay đổi; initial load lỗi có Retry/recovery.
- Lỗi save/clear/lock luôn có `role=alert`; trạng thái mạng không được trình bày như Sync receipt.
- Result marker khớp exact revision làm popup hiện selection sạch + Saved; marker stale/expired không tạo success giả và lỗi locked có hướng retry rõ.

### Chromium E2E

CI chạy suite một lần trên `dist/` không key và một lần trên artifact cross-device, đồng thời assert Extension ID cố định.

- Load production Manifest V3 + service worker.
- Save/read qua hai popup instances.
- Remote revision bật badge `1`; popup render nội dung rồi badge mới xóa.
- CSP/runtime không chạy hostile payload.
- Production UI migration sang private lock; active-epoch note là ciphertext, old retired-epoch record có thể còn trong grace; private draft lock/unlock round-trip không lộ plaintext trong session snapshot.
- Options disclosure hiện đúng.
- Manifest chỉ có `storage`, `alarms`, `contextMenus`; vẫn không host/content-script/tab access.
- Manifest không khai báo `externally_connectable`; source và build audit không cho phép external message/connection listener.
- Options diagnostics hiện version/ID, điều kiện account/Sync/release và giới hạn delivery.
- Dynamic document language/title và control border ≥3:1.
- No horizontal overflow: popup 320/360/390/430; options 320/360/390/430/768/1280.
- Logo local tải đúng 128×128; PNG icon đúng kích thước, RGBA, CRC hợp lệ và không metadata/trailing payload.
- Dark-mode computed colors, forced colors, target ≥44 px, DOM/action order và reduced motion không quay spinner.
- Screenshot popup dark + options light được inspect trước release.

## Manual two-device release matrix

Gate này cần cùng extension ID trên hai máy thật: ưu tiên Chrome Web Store private/unlisted; gói development pinned-ID chỉ dùng cho test trước khi upload.

1. **Happy path:** A save → B mở → B copy chính xác Unicode/newline.
2. **Sync off:** tắt Sync ở B; A save; B không nhận; bật lại và quan sát eventual sync.
3. **Offline:** A offline save; online lại; B nhận; wording không đổi thành “đã giao”.
4. **Concurrent:** A/B cùng dirty, cùng save; cả hai không crash; lần mở sau hội tụ, conflict UI không mất draft.
5. **Popup close:** gõ draft, click ra ngoài, mở lại trong cùng phiên → draft còn.
6. **Restart:** draft/session key biến mất sau Chrome restart; synced note còn; private mode yêu cầu passphrase.
7. **Wrong passphrase:** lỗi rõ, không xóa ciphertext/draft.
8. **Expiry:** Chrome mở qua expiry và Chrome đóng qua expiry; note ẩn ngay khi đọc, cleanup có thể chậm.
9. **Clear + offline replica:** B offline; A clear; B reconnect; barrier giữ state rỗng với record cũ; không claim secure erase.
10. **Update/reload:** reload extension khi locked/unlocked; worker suspend; không mất synced record.
11. **Near quota:** seed bounded valid records và quota reject; input/draft không mất, UI không báo saved; cleanup dùng emergency reserve để tạo tombstone rồi lấy lại capacity.
12. **Clipboard denied:** deny clipboard write; textarea focus/select và hướng dẫn shortcut.
13. **Unread badge:** A save khi popup B đóng → B hiện `1`; restart Chrome B vẫn hiện; mở popup B → badge xóa; private lock giữ badge đến khi unlock.
14. **Cross-key reorder:** seed replacement trước security settings và đảo lại; không mất replacement, không render sai epoch, mutation bị chặn khi transition incomplete.
15. **Corrupt/quota recovery:** seed malformed v2 settings và malformed known-prefix filler gần quota; Retry không phá dữ liệu; Reset chỉ chạy sau confirm, kết thúc ở state rỗng/default, khôi phục write capacity và giữ key ngoài namespace Textpipe.
16. **Draft cap:** nhập hơn 100.000 byte UTF-8 → UI cảnh báo, không ghi input quá lớn vào session và không ghi đè recovery draft hợp lệ trước đó.
17. **Context menu Mac/Windows:** chọn Unicode/nhiều dòng trên trang, bấm **Thêm vào Textpipe** → popup tự mở, textarea đúng byte-for-byte, status Saved; máy gửi không có badge `1`, máy nhận có badge sau Sync.
18. **Context menu failure:** test 5.001 byte, Private locked, offline/quota và hai máy ghi đồng thời; không false Saved, không mất draft cũ, không lưu selection plaintext khi locked.

## Accessibility manual

- Keyboard-only, Shift+Tab, Ctrl/Cmd+Enter, Escape clear confirmation.
- Visible focus tại mọi control.
- VoiceOver/NVDA đọc label/status/error một lần, không đọc counter mỗi phím.
- 200% browser zoom, long English and Vietnamese, no clipped button.
- `html[lang]` và document title khớp locale VI/EN.
- Light/dark/forced colors; không dùng màu là tín hiệu duy nhất.
- Viền input/select/textarea đạt tương phản non-text 3:1 với nền.

## Security corpus

```text
<script>alert(1)</script>
<img src=x onerror=alert(1)>
<svg/onload=alert(1)>
javascript:alert(1)
"><iframe srcdoc=...>
```

Thêm bidi controls, zero-width characters, ANSI terminal escape, thousands of newlines, unbroken string, combining Unicode và 4-byte emoji. Acceptance: inert display, no network, no auto-copy, no log/notification content.
