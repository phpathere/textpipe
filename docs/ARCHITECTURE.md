# Architecture

## Mục tiêu và ranh giới

Textpipe là extension một mục đích: đồng bộ một đoạn plain text nhỏ do người dùng chủ động nhập hoặc chọn qua context menu. Không có history UI, account riêng, server riêng, content script, page injection hoặc background clipboard access.

```text
Popup / Options
      │
      ├── chrome.storage.session  → standard/private draft + derived AES key của phiên
      ├── chrome.storage.local    → device ID + read/state-observation cursors
      └── chrome.storage.sync     → immutable state + settings/security metadata
                    │
                    └── Chrome Sync → Chrome cùng account + Extension ID

Service worker
      ├── contextMenus      → selection → Save → canonical confirm → mở popup
      ├── storage.onChanged → đọc lại canonical state → badge “1”
      └── alarms            → cleanup fail-safe khi Chrome đang chạy
```

## Các context

### Popup

- Đọc canonical remote state mỗi lần mở; `storage.onChanged` chỉ là hint để đọc lại.
- Không ghi Sync khi gõ. Draft debounce vào `storage.session` sau 300 ms và được flush trước clear, lock hoặc reload state. Standard draft là plaintext; khi Private đang mở khóa, draft được mã hóa bằng AES-GCM trước khi ghi session storage.
- `Ctrl/Cmd+Enter` là thao tác lưu rõ ràng.
- Remote update khi local clean được render tự động; khi local dirty, UI giữ draft và yêu cầu chọn **Dùng bản mới / Giữ bản của tôi**.
- Sau Save, popup đọc lại canonical state. Chỉ khi exact revision vừa ghi vẫn thắng, UI mới đánh dấu clean; nếu không, draft vẫn còn để giải quyết conflict.
- Copy chỉ xảy ra sau click; không cần `clipboardRead`.

### Options

- Cấu hình retention cho note mới, bật/tắt khóa riêng tư và khóa phiên hiện tại.
- Hiển thị version, Extension ID, điều kiện Sync và giới hạn delivery.
- Nghe settings/session change từ context khác; thao tác đang chạy có busy state và stale form tự đóng.
- Settings hỏng có Retry và reset phá hủy chỉ sau xác nhận rõ; cùng đường reset cũng dùng để lấy lại quota khi Sync gần đầy.

### Context menu

- Menu chỉ xuất hiện cho context `selection`; handler chỉ đọc `selectionText`, không giữ URL/tab metadata và không cần host permission.
- Click là thao tác thay thế single shared slot, đi qua cùng validation, quota preflight, security epoch và mã hóa của Save trong popup.
- Sau write, worker đọc lại canonical state. Chỉ exact revision thắng mới tạo result marker không payload trong `storage.session`, xóa draft cũ, reconcile badge self-write và mở popup.
- Popup chỉ hiện **Đã lưu trên máy này để Chrome đồng bộ** khi marker còn hạn khớp exact canonical revision. Lỗi/Private đang khóa không lưu selection plaintext và không được báo Saved.

### Service worker

- Listener được đăng ký đồng bộ ở top level theo vòng đời Manifest V3.
- Mọi Sync delta chỉ kích hoạt queue đọc lại canonical state; worker không suy badge từ một delta riêng lẻ.
- Chỉ worker gọi `chrome.action`. Sync event, local cursor event và popup acknowledgment dùng cùng một reconciliation queue.
- Badge `1` nghĩa là canonical revision từ máy khác chưa được đọc trên máy hiện tại; không phải history count và không chứa payload.
- Read cursor nằm trong `storage.local`, nên startup/reload có thể dựng lại badge.
- Listener context menu ở top level; việc ghi note/cleanup/badge dùng cùng queue để không tự đua trong service worker.
- Không keepalive hoặc polling. Alarm 30 phút chỉ chạy khi Chrome có thể chạy; không đánh thức máy.

## Storage schema

### `chrome.storage.sync`

| Namespace | Dạng | Vai trò |
|---|---|---|
| `textpipe.note.v2.<uuid>` | immutable state record | Plaintext/ciphertext gắn với đúng security epoch |
| `textpipe.tomb.v2.<uuid>` | immutable record tombstone | Bảo vệ exact revision trước physical removal; target retention 7 ngày, cap 48 record đã an toàn |
| `textpipe.clear.v2.<uuid>` | immutable barrier | Trạng thái rỗng gắn với security epoch |
| `textpipe.retention.v2` | mutable config | Retention độc lập với security mode |
| `textpipe.security.v2` | mutable active epoch | Crypto config + target event completeness fence |
| `textpipe.transition-intent.v1.<uuid>` | short-lived claim | Chặn mutation trong security transition; tự hết hạn sau 10 phút |
| `textpipe.retired-epoch.v1.<uuid>` | immutable proof | Cho phép dọn đúng record thuộc epoch đã nghỉ |
| `textpipe.settings.v1` | legacy mirror | Fallback/compatibility; không phải source of truth mới |
| `textpipe.note/tomb/clear.v1.*` | legacy state | Chỉ đọc trước transition v2 đầu tiên; không auto rewrite khi load |

Current v2 note luôn có `securityRevision`:

```ts
{
  schemaVersion: 2,
  securityRevision: string,
  revision: string,
  kind: "plain",
  content: string,
  sourceId: string,
  createdAt: number,
  updatedAt: number,
  expiresAt: number | null
}
```

Encrypted note giữ metadata nhưng thay `content` bằng `keyId`, IV 96-bit và AES-GCM ciphertext/tag dạng base64. V2 AAD bao gồm cả `securityRevision`; thay epoch hoặc metadata làm decrypt fail.

### `chrome.storage.local`

- `textpipe.device-id.v1`: UUID ngẫu nhiên per install/device để self-write không bật unread badge; không phải identity/fingerprint.
- `textpipe.read-cursor.v1.<eventRevision>`: watermark immutable đã đọc trên riêng thiết bị. Acknowledgment cũ hoàn tất muộn không thể ghi lùi cursor mới.
- `textpipe.state-seen.v1.<eventRevision>`: thời điểm thiết bị lần đầu quan sát canonical protector. Cleanup chỉ được destructive sau khi protector ổn định ít nhất 24 giờ.

Các record local trên không chứa payload.

### `chrome.storage.session`

- `textpipe.draft.v1` có hai shape: schema v1 là standard plaintext draft; schema v2 là AES-GCM ciphertext + `keyId`, IV, base event revision và timestamp của private draft. Session draft có cap 100.000 byte UTF-8; input lớn hơn hiện cảnh báo và không được ghi đè vào recovery draft. Draft chỉ bị xóa sau canonical confirmation, clear/reset thành công, lỗi bảo vệ fail-closed hoặc khi session kết thúc.
- `textpipe.session-key.v1`: raw 256-bit derived key + `keyId`; không sync và bị vô hiệu khi epoch/key khác active.
- `textpipe.context-menu-result.v1.<uuid>`: receipt thành công/lỗi dùng một lần, TTL 10 phút, chỉ có revision/error code và timestamp; không chứa selection hay URL.
- Khi một standard plaintext draft đã tồn tại rồi máy nhận remote transition sang Private lúc chưa có khóa mới, extension không thể mã hóa nó ngay. Draft vẫn chỉ ở `storage.session`, không được render khi locked và được mã hóa/migrate sau lần unlock thành công. Đây là residual plaintext session window, không phải synced plaintext.
- Khi remote transition tắt Private đến lúc máy còn cache đúng old key, draft ciphertext được giải mã về standard draft rồi old key bị xóa. Nếu không có đúng key, ciphertext được giữ nhưng không hiển thị ở standard mode để tránh giải mã sai.

Tất cả storage area được đặt `TRUSTED_CONTEXTS`. Project không có content script; đây là defense-in-depth.

## Canonical state và ordering

Chrome Sync không có compare-and-set, delivery acknowledgement hoặc ordering contract giữa các key. Thiết kế tránh một mutable `latestNote`:

1. Mỗi Save tạo UUID và một top-level immutable key mới.
2. Event được xếp theo `(eventAt, eventRevision)`; UUID là tie-breaker ổn định.
3. Save dùng logical timestamp ít nhất `previousEventAt + 1`; runtime từ chối timestamp không an toàn hoặc lệch tương lai quá 24 giờ.
4. Chỉ note/tombstone/barrier thuộc active `securityRevision` mới tham gia canonical state. Legacy record chỉ tương thích trước transition v2 đầu tiên.
5. Base event revision phát hiện conflict trước write. Đây là UX guard, không phải atomic CAS.
6. Sau write, UI đọc lại canonical state để phát hiện race còn lại và giữ draft nếu revision vừa ghi không thắng.

Timestamp chỉ hỗ trợ hội tụ gần đúng; không đại diện causal order khi clock các máy lệch.

## Clear, expiry và cleanup hai pha

- Clear chỉ ghi một active-epoch barrier mới hơn current state; không remove note ngay trong cùng thao tác.
- Expired note bị ẩn ngay. Cleanup phải ghi barrier bền trước; nếu quota/write lỗi, synthetic expired state tiếp tục che record.
- Cleanup dừng hoàn toàn khi security target chưa tới hoặc transition intent đang active.
- Canonical protector phải được thiết bị này quan sát ổn định 24 giờ trước khi cleanup tạo record tombstone.
- Note chỉ bị remove vật lý ở một lượt sau, khi tombstone của chính revision đó đã tồn tại thêm 24 giờ.
- Unknown epoch không có retirement proof và record invalid/future-skewed chỉ bị quarantine/ignore, không bao giờ bị auto-delete.
- Sau physical removal, tombstone còn được giữ đến 7 ngày (hoặc giới hạn 48 tombstone đã an toàn vì target không còn).
- Giữ một barrier mới nhất cho active epoch và một barrier cho mỗi retired epoch vô thời hạn. Điều này chống reorder của remove/replay với client cũ; metadata nhỏ có thể tích lũy khi đổi mode nhiều lần.
- Không bao giờ gọi `storage.sync.clear()`.

Hai khoảng grace thường làm physical cleanup chậm ít nhất khoảng 48 giờ; Chrome tắt/offline có thể kéo dài hơn. Barrier bảo vệ state hiển thị, không tạo secure-erase guarantee.

## Security transition

Enable/disable private lock là một protocol không phá hủy:

1. Đọc snapshot, derive/unlock key rồi ghi immutable transition intent cho active security revision.
2. Đọc lại snapshot và xác nhận intent hiện tại thuộc thao tác này; mutation khác bị chặn.
3. Tạo epoch revision mới, target note/barrier, barrier cho epoch mới, barrier cho epoch cũ, legacy barrier nếu cần và retirement proof.
4. Commit replacement + barriers + retirement + `security.v2` + legacy mirror trong **một** `storage.sync.set`; không remove payload cũ.
5. Receiver có settings nhưng chưa có target event sẽ fail closed và chặn đọc/mutation. Receiver có target trước settings giữ record vì chưa có retirement proof phù hợp.
6. Cleanup chỉ xử lý epoch cũ khi có retirement proof và qua protocol hai pha ở trên.

Nếu commit thất bại, active settings và payload cũ vẫn còn; intent được remove best-effort và session key mới bị xóa. Intent còn sót tự hết hạn sau 10 phút.

`retention.v2` tách khỏi security nên stale retention write không bật/tắt encryption. Legacy combined settings chỉ là read-only fallback và compatibility mirror; load không tự tạo v2 key vì một record thật có thể đang in-flight. Save/Clear chỉ ghi state record và **không bao giờ** opportunistically ghi fixed security/retention key—điều này ngăn một Save tiêu chuẩn bị trễ hạ epoch Riêng tư vừa được bật. Security transition ghi `security.v2` + legacy mirror; retention update/reset ghi `retention.v2`. Khi cả hai split record hợp lệ tồn tại, legacy mirror không còn authoritative. Mọi máy nên chạy cùng một release trong giai đoạn migration; client cũ còn ghi combined settings là residual availability risk.

Chrome Sync vẫn dùng last-writer-wins cho fixed settings key. Hai security transition được người dùng thực hiện đồng thời khi các máy offline không có distributed CAS; đây là residual availability risk và phải nằm trong manual two-device test, không được quảng bá như transactional cross-device key management.

## Recovery

Reset là thao tác phá hủy chỉ chạy sau xác nhận của người dùng:

1. remove exact malformed key thuộc prefix Textpipe đã biết; claim transition intent nếu fixed settings còn đọc được và quota còn chỗ;
2. mô phỏng dung lượng sau reset; nếu critical batch vẫn không vừa vì key ngoài namespace, dừng **trước** destructive compaction;
3. pre-compact exact state key cũ của Textpipe (note, tombstone, clear marker, intent khác và retirement proof), rồi commit standard epoch rỗng mới + active/legacy barrier + default split settings;
4. best-effort ghi retirement proof + one barrier cho các epoch đã quan sát; nếu bước này thất bại, replay đơn lẻ vẫn bị quarantine nhưng fixed security record cũ + payload cũ cùng replay có thể khôi phục old epoch;
5. xóa draft/session key/read-observation cursors trên máy hiện tại.

Đây là quota-recovery compaction chủ đích, là ngoại lệ có xác nhận đối với cleanup hai pha tự động. Extension vẫn không gọi `storage.sync.clear()` và không thể xóa tức thời replica offline hoặc backup do Chrome quản lý. Không chạy Reset/bật/tắt Private đồng thời trên nhiều máy: fixed settings của Chrome Sync là last-writer-wins, không có distributed CAS.

## Quota và fail-safe

- Text nguồn tối đa 5.000 byte UTF-8 để encrypted record vẫn dưới quota 8.192 byte/item.
- Mọi set batch được tính serialized item/total bytes trước write, tính cả item bị thay thế và kiểm tra giới hạn 512 item.
- Save và write thông thường giữ 16 KiB + 64 item slots. Clear/security transition được dùng vùng khẩn cấp nhưng vẫn chừa 4 KiB + 8 slots.
- Tombstone cleanup được phép dùng phần reserve cuối cùng; batch tối đa 64 tombstone và tự giảm một nửa khi preflight quota lỗi. Payload chỉ bị remove ở lượt sau khi tombstone đã đủ 24 giờ.
- Reset đã xác nhận có thể dùng reserve cuối và pre-compact exact key Textpipe sau projected quota check. Nó không xóa key ngoài namespace; nếu chính các key đó làm critical batch không thể vừa, reset fail trước khi xóa valid state.
- Khi write thường bị chặn, UI báo lỗi và giữ draft. Chrome vẫn có thể áp dụng rate limit hoặc reject write dù preflight local đã pass.

## Build

Vite có ba entry: `popup.html`, `options.html`, `src/background/index.ts`. Service worker output cố định là `background.js`; UI chunks được hash. `public/` chứa manifest/locales/icons và được copy nguyên trạng.

Production build:

- không source map, remote font/asset/code hoặc network primitive;
- CSP có `connect-src 'none'` và không inline/eval;
- chỉ permission `storage`, `alarms`, `contextMenus`; không host access;
- package audit giới hạn dưới 250 KB, kiểm tra manifest/version/entry/permission/CSP/dangerous sink;
- CI chạy format, lint, typecheck, test, coverage, build audit và Chromium extension E2E với quyền GitHub chỉ đọc.
