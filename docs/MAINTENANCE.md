# Maintenance và debugging

## Invariants không được phá

1. Current note key là immutable `textpipe.note.v2.<revision>`; không update payload đã tồn tại.
2. Mọi current state record phải mang exact active `securityRevision`.
3. Legacy v1 chỉ là parser/fallback compatibility; đọc không được tự ghi migration fixed key.
4. Không dùng `chrome.storage.sync.clear()`; chỉ remove exact key trong namespace.
5. Sync chỉ sau user action; draft và derived key chỉ ở `storage.session`. Standard draft là plaintext; private draft phải là authenticated ciphertext khi active key có sẵn; không tăng cap 100.000 byte mà không review memory/DoS và parser bound.
6. Không thêm content script/host permission/`tabs`/`clipboardRead` để “future proof”.
7. Context menu chỉ đọc `selectionText` sau explicit click; không lưu URL/tab metadata. Receipt session không được chứa payload và chỉ báo Saved khi exact canonical revision khớp.
8. Không render user text bằng HTML, Markdown hoặc linkifier.
9. Không sửa encrypted metadata/AAD tại chỗ; tạo schema/prefix mới và giữ parser cũ.
10. Passphrase/key không được ghi local/sync/log/error/telemetry.
11. UI không được nói máy kia đã nhận, đã giao hoặc realtime.
12. Badge chỉ suy từ canonical state + device-local read cursor; chỉ service worker ghi badge qua một queue.
13. Retention/security nằm ở hai record độc lập; retention write không được mirror ngược và ghi đè security.
14. Security transition phải có intent ownership và commit replacement + barriers + retirement + epoch trong một non-destructive batch.
15. Reader/mutation fail closed khi security target chưa đến hoặc active intent tồn tại.
16. Tombstone/clear marker `scope=state` chỉ tham gia canonical state khi cùng epoch.
17. Unknown epoch/invalid future record không có retirement proof không được auto-delete.
18. Physical cleanup cần: canonical protector 24h → exact tombstone → 24h → exact remove.
19. Giữ one clear barrier cho active epoch và mỗi retired epoch; không dựa vào cross-key remove ordering.
20. UI không xóa draft ngay khi `storage.sync.set` resolve; cần canonical read-after-write xác nhận exact revision.
21. Mọi Sync set phải qua serialized item + total-byte + item-count preflight. Write thường giữ 16 KiB/64 slots; transition giữ 4 KiB/8 slots; chỉ tombstone cleanup và reset đã xác nhận được dùng reserve cuối.
22. Read path không tự migrate fixed settings. Save/Clear không được ghi fixed settings; chỉ security transition/reset ghi security epoch. Điều này ngăn delayed standard mutation hạ Private mode.
23. Reset phải projected-preflight, claim intent khi có thể, pre-compact exact old state key rồi commit empty epoch/default settings. Không đụng key ngoài namespace Textpipe; interrupted reset phải retry được qua delivery-pending recovery.

## Cấu trúc source

```text
src/background/   service worker events + badge + cleanup schedule
src/popup/        popup state machine và UI
src/options/      retention + private lock settings/diagnostics/recovery
src/shared/       types, validation, canonical state, storage protocol, crypto, i18n
src/ui/           shared design tokens và icon components
public/           manifest, locales, production PNG icons
assets/           source vector không ship
tests/            unit/component/integration
e2e/              production-package Chromium tests
scripts/          build/release audits
```

## Thay đổi schema/protocol

- Không sửa nghĩa v1/v2 tại chỗ; tạo key prefix + schema version mới.
- Runtime parser mới phải bind key suffix với revision và chịu malformed/partial records.
- Giữ parser cũ ít nhất một release window; migration phải idempotent và an toàn khi worker bị terminate.
- Không auto-write fixed-key migration trong read path: missing record có thể chỉ đang in-flight.
- Crypto migration phải giữ thứ tự: snapshot → derive/unlock → intent claim → re-read ownership → build batch → ownership recheck → quota preflight → non-destructive commit.
- Target event là completeness fence. Settings đến trước target phải chặn đọc/mutation; target lạ đến trước settings phải được giữ.
- Retirement proof là điều kiện cleanup incompatible epoch, không phải authorization để render.
- AAD thay đổi cần test tamper cho từng field, bao gồm `securityRevision`.
- Recovery remove malformed known-prefix filler, projected-preflight, pre-compact exact old Textpipe state rồi commit empty epoch + active/legacy barrier + default split settings. Post-reset retirement metadata là best-effort; không hứa xóa replica offline/backup.
- Save/Clear chỉ ghi immutable state record, không promote fixed setting. Transition ghi security + legacy mirror; retention chỉ đổi qua retention action/reset. Khi cả hai split v2 key hợp lệ tồn tại, bỏ qua malformed/stale legacy mirror.

## Dependency update

1. Update nhóm nhỏ; giữ exact versions.
2. Review lockfile, lifecycle scripts, license và provenance/signature.
3. Chạy `npm audit`, `npm run check`, `npm run test:coverage`, `npm run test:e2e`.
4. Inspect production bundle/ZIP: không remote loader, network primitive, source map hoặc secret.
5. Review Chrome Web Store MV3/remote-code/privacy rules hiện hành.

## Debug storage

Trong extension DevTools → **Application → Extension Storage**:

- kiểm tra prefix/schema/revision/securityRevision/timestamp/kind, không dump payload thật;
- settings target mà current event thấp hơn nghĩa là partial transition; chờ Sync/Retry, không reset vội;
- active intent tối đa 10 phút; expired intent sẽ được cleanup;
- retired proof có nhưng old note còn là bình thường trong cleanup grace;
- `storage.sync.set()` resolve chỉ nghĩa Chrome chấp nhận local write, không phải remote delivery;
- quota error phải giữ draft; không xóa record thủ công để “chữa nhanh” bằng UI người dùng thật.
- private draft phải là schema v2 ciphertext. Residual schema v1 draft chỉ được chấp nhận trong cửa sổ máy vừa nhận remote Private transition nhưng chưa có key: UI phải ẩn nó và lần unlock thành công phải migrate sang ciphertext.
- user-confirmed Reset là đường quota recovery chính thức; phải giữ key ngoài namespace Textpipe và không được thay bằng `storage.sync.clear()`.

## Debug service worker

- `chrome://extensions` → Textpipe → **Inspect views / service worker**.
- Worker suspend là bình thường; listener phải ở top level và state quan trọng phải ở storage.
- `chrome.alarms` không đánh thức máy ngủ/tắt.
- Badge sai: kiểm tra canonical state, device ID, read cursors và queue; không set badge trực tiếp trong popup.

## Version/release

1. Update `package.json` và `public/manifest.json` cùng version.
2. Update privacy/security/release notes nếu data behavior đổi.
3. `npm ci && npm run check && npm run test:coverage && npm run test:e2e`.
4. Build ZIP chỉ từ audited `dist/`; manifest phải ở root.
5. Inspect file list, SHA-256, extension ID và final pinned-ID package.
6. Upload private/unlisted, chạy two-device matrix, rồi mới promote.
7. GitHub Release phải dùng tag SemVer đã tồn tại; upload đúng ZIP cross-device và `SHA256SUMS.txt`, không dùng hai gói **Source code** tự sinh để cài unpacked.
8. Sau khi publish, mở danh sách Assets và đối chiếu digest SHA-256 GitHub hiển thị với checksum cục bộ trước khi chia sẻ link tải.

Ưu tiên phát hành thủ công bằng tài khoản chủ repo. Không thêm workflow `contents: write` chỉ để tạo Release nếu chưa có review riêng về trigger, quyền token và blast radius.

`npm run audit:build` fail nếu version/permission/CSP/entry point drift, có host/remote code/network/dangerous sink/source map hoặc package phình bất thường.

## Quy tắc UI

- Dùng token/component trong `base.css` trước khi tạo pattern mới.
- Mọi copy có Vietnamese/English; dynamic `html[lang]` và title phải đúng locale.
- Icon-only control cần accessible name; async form cần busy/error/focus rõ.
- Test popup 320/360/390/430 và options 320/360/390/430/768/1280.
- Dùng action zone; không đặt primary button trong status/metadata row.
- Không dùng màu là tín hiệu duy nhất; control boundary tối thiểu 3:1.
