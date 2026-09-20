# Security model

## Tóm tắt

Textpipe thu nhỏ attack surface:

- chỉ permission `storage`, `alarms` và `contextMenus`;
- không host access, content script, page injection, tab access hoặc background clipboard read;
- không server/analytics/ads/network request/remote code;
- incognito bị tắt;
- user text chỉ render bằng textarea/text node, không parse HTML/Markdown/link;
- mọi Sync record được runtime-validate và canonical state bị ràng buộc vào một security epoch.

Đây là threat model của code, không phải chứng nhận audit độc lập.

## Threat model

| Threat | Control | Residual risk |
|---|---|---|
| Stored XSS từ Sync text | Preact escaping + textarea/value; CSP; source/build sink audit | Supply-chain/runtime compromise vẫn có thể thay code |
| Trang web hoặc extension khác đọc dữ liệu | Không host permission/content script; không `onMessageExternal`/`onConnectExternal`; build audit cấm hai listener này; storage `TRUSTED_CONTEXTS` | Phần chữ người dùng chủ động chọn được Chrome chuyển cho handler sau click menu; malware/local debugger/profile compromise nằm ngoài sandbox extension |
| Context menu thu thập quá mức | Chỉ đăng ký context `selection`; handler chỉ đọc `selectionText`, bỏ qua URL/tab metadata và không log payload | Text được chọn có thể chứa dữ liệu nhạy cảm; Standard mode vẫn là plaintext |
| Concurrent note writes | Immutable UUID keys; base revision; canonical read-after-write; session draft/conflict UI | Chrome Sync không có atomic CAS hoặc causal ordering |
| Cross-key reorder | Epoch-bound v2 state, target-event fence, transition intent, retirement proof, local grace | Chrome không công bố cross-key ordering, delivery receipt hoặc SLA |
| Legacy/retired replay | Canonical epoch filter; tombstone/clear marker cũng phải cùng epoch; one barrier per retired epoch | Client cũ vẫn có thể giữ bản sao; physical deletion do Chrome quyết định |
| Cleanup làm mất record in-flight | Unknown epoch/invalid future record không auto-delete; protector 24h → tombstone → 24h → exact remove | Metadata/payload cũ tồn tại lâu hơn; Chrome có thể trì hoãn/reject cleanup |
| Quota/rate limit | 5 KB source cap; exact byte + item-count preflight; 16 KiB/64-slot reserve, 4 KiB/8-slot emergency reserve; tombstone có thể dùng reserve cuối | Chrome vẫn có thể reject/rate-limit; UI giữ draft và cho retry/reset |
| Session draft lộ plaintext | Private draft dùng AES-GCM ciphertext; lock xóa key; draft không sync; cap 100.000 byte UTF-8 | Standard draft là plaintext; remote Private transition không có key tạo residual plaintext session window được mô tả bên dưới |
| Clipboard injection | Không auto-read/auto-copy; preview và click rõ | Người dùng vẫn có thể paste text nguy hiểm vào terminal |
| Account/profile compromise | Optional private lock dùng passphrase ngoài Chrome account | Plaintext sau unlock, keylogger và malicious update vẫn đọc được |
| Offline security transitions | Intent serialize transition nhìn thấy cùng snapshot; epoch filter tránh render sai mode | Hai máy offline không có distributed CAS; competing transition có thể gây availability/key conflict |
| Supply chain | Exact dependencies + lockfile; no remote runtime code; build audit; read-only CI; Dependabot | Publisher/GitHub/registry account và signing pipeline vẫn cần operational controls |

## Standard mode

Nội dung đã lưu và standard draft nằm dạng plaintext trong extension storage của profile Chrome (`storage.sync` hoặc `storage.session`). Không dùng standard mode cho:

- mật khẩu, OTP, recovery code;
- private key/seed phrase;
- API token/session cookie;
- dữ liệu tài chính, y tế hoặc thông tin cá nhân nhạy cảm.

## Private lock

### Primitives

- Web Crypto API do Chrome cung cấp.
- PBKDF2-HMAC-SHA-256, salt 128-bit, 600.000 iterations.
- AES-256-GCM, IV ngẫu nhiên 96-bit per encryption, tag 128-bit.
- Passphrase Unicode NFC, tối thiểu 12 và tối đa 128 code point.

### Key lifecycle

- Passphrase không lưu hoặc sync.
- Salt/KDF parameters và AES-GCM verifier được sync; chúng cho phép offline guessing nhưng không tự giải mã được nội dung.
- Derived raw key chỉ nằm trong `chrome.storage.session`, gắn với `keyId`; restart/reload/update/disable hoặc **Khóa ngay** làm phiên bị khóa.
- Private draft được AES-GCM encrypt bằng active session key trước khi ghi `storage.session`. **Khóa ngay** cố bảo vệ plaintext draft trước rồi mới xóa key; nếu settings/key không thể xác thực, plaintext draft bị xóa fail-closed còn authenticated ciphertext hợp lệ được giữ.
- Không có recovery. Quên passphrase đồng nghĩa không đọc được ciphertext.
- Dùng passphrase dài/ngẫu nhiên; PBKDF2 chỉ làm chậm, không cứu được passphrase yếu.

### Authenticated metadata

AAD note v2 gồm namespace/version, `keyId`, `securityRevision`, note revision, created/updated/expiry time và source ID. AAD private draft gồm namespace v2, `keyId`, base event revision và draft timestamp. Sửa IV, ciphertext, tag, epoch hoặc authenticated metadata làm decrypt fail. Parser note legacy v1 giữ AAD cũ chỉ để đọc dữ liệu nâng cấp.

### Transition fail-closed

Security mode change không xóa record cũ trước:

1. short-lived intent claim active epoch và chặn Save/Clear/transition khác;
2. target state + active/previous/legacy barriers + retirement proof + new security settings được batch trong một `storage.sync.set`;
3. settings đến trước target làm reader/mutation fail closed;
4. state của epoch khác không được render; unknown epoch không có retirement proof không bị cleanup;
5. old epoch chỉ bị physical cleanup qua hai grace period.

Nếu write batch lỗi, old settings/payload vẫn authoritative. Session key mới bị xóa best-effort.

### Không được tuyên bố quá mức

Private lock mã hóa content ở tầng ứng dụng trước khi ghi note thuộc private epoch vào Chrome Sync, nhưng:

- metadata thời gian, expiry, record count và ciphertext size vẫn lộ;
- plaintext có trong DOM/process memory và clipboard sau unlock/copy;
- local malware, keylogger, debugger hoặc malicious extension update vẫn có thể đọc;
- plaintext legacy/standard đã sync trước lúc bật lock có thể còn trong replica/backup và được dọn chậm;
- nếu máy đang có standard plaintext draft rồi nhận remote transition sang Private khi chưa có passphrase, draft đó vẫn là plaintext chỉ trong `storage.session`, bị ẩn lúc locked và chỉ được mã hóa sau lần unlock thành công hoặc biến mất khi session kết thúc;
- nếu remote transition tắt Private mà máy không còn đúng old key, private draft ciphertext có thể được giữ nhưng không đọc được trong standard mode;
- client cũ/offline có thể tiếp tục tạo record theo epoch cũ, dù client mới sẽ không chọn record đó;
- concurrent security transitions trên các máy offline không có distributed transaction;
- chưa có independent cryptographic audit.

Không marketing `zero knowledge`, `secure erase`, `audited E2EE` hoặc “máy kia đã nhận”.

## CSP và build restrictions

```text
default-src 'self';
script-src 'self';
style-src 'self';
font-src 'self';
img-src 'self' data:;
connect-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none';
frame-ancestors 'none'
```

Build audit từ chối inline/eval, source map, remote URL/network primitive, telemetry endpoint, `innerHTML`, `dangerouslySetInnerHTML`, permission/entry/CSP drift và package bất thường.

## Validation và quarantine

Sync là untrusted input. Parser kiểm tra:

- exact key prefix + schema version + revision/key binding;
- safe-integer, non-negative timestamps và future skew tối đa 24 giờ;
- bounded ID/base64/content;
- encrypted key ID khớp active settings;
- v2 state có valid `securityRevision`;
- split retention/security, transition intent và retirement proof đúng shape.

Invalid/future-skewed record bị ignore và đếm để UI cảnh báo; cleanup không xóa tự động vì record thật có thể chỉ bị clock skew hoặc partial delivery. Không log payload, passphrase, raw key hoặc ciphertext.

## Delete/retention semantics

Clear ghi immutable active-epoch barrier rồi trả thành công; không remove note trong thao tác đó. Active expiry cũng phải commit barrier trước. Cleanup sau đó:

1. quan sát canonical protector ổn định ít nhất 24 giờ;
2. ghi exact record tombstone;
3. chờ tombstone ít nhất 24 giờ;
4. remove exact note; tombstone có target retention 7 ngày nhưng có thể được thu sớm theo cap 48 record đã an toàn; giữ one barrier per active/retired epoch.

Vì vậy UI không hồi sinh history cũ khi tombstone hết hạn hoặc remove bị giao khác thứ tự. Đây là retention control, không phải forensic deletion. OS clipboard history, Chrome backup, thiết bị offline và profile/client cũ nằm ngoài quyền kiểm soát.

Reset settings hỏng/near-quota là ngoại lệ phá hủy có xác nhận: nó remove malformed known-prefix key, tính trước projected quota, pre-compact exact state key Textpipe cũ rồi commit empty standard epoch + active/legacy barrier + default split settings. Nếu key ngoài namespace khiến critical batch không thể vừa, thao tác dừng trước khi xóa valid state. Retirement/barrier cho epoch cũ được ghi best-effort sau commit. Nếu metadata này thất bại rồi cả fixed security record cũ lẫn payload cũ cùng replay, nội dung có thể xuất hiện lại; vì vậy Reset không phải secure erase. Extension không gọi `storage.sync.clear()`. Không thực hiện Reset/bật/tắt Private đồng thời trên nhiều máy vì Chrome Sync không có CAS.

## Release security checklist

1. `npm ci && npm run check && npm run test:coverage && npm run test:e2e` pass.
2. `npm audit`, registry signatures và dependency/license diff được review.
3. Inspect ZIP: manifest ở root; không source map, secret, `.env`, test artifact.
4. Manifest giữ exact allowlist `storage`, `alarms`, `contextMenus`; không host access/content script/tab permission.
5. Publisher Google Account bật 2-Step Verification, ưu tiên hardware security key.
6. Privacy policy/Store disclosure khớp chính xác code.
7. Test hai máy/profile thật, offline/concurrent/clear/reconnect/private transition.
8. Independent crypto/security review trước claim E2EE.
9. Dùng synthetic data khi test corruption/reorder; không gửi note/passphrase thật vào issue.

## Báo cáo lỗ hổng

Trước khi public, thay phần này bằng security contact thật. Report chỉ cần version, Chrome version, bước tái hiện và impact tối thiểu; không gửi passphrase hoặc nội dung đã chia sẻ.
