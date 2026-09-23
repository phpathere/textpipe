# Chrome Web Store images — Textpipe 1.0.0

Bộ ảnh này được dựng ngày 23/09/2026 từ giao diện thật của Textpipe 1.0.0 và đã kiểm tra tự động kích thước/PNG. Dữ liệu hiển thị đều là dữ liệu minh họa, không chứa tài khoản, nội dung hay passphrase thật.

## File cần tải lên

| Vị trí trong Developer Dashboard | File | Kích thước |
|---|---|---:|
| Store icon | `icon-128.png` | 128 × 128 |
| Small promo tile | `promo-small-440x280.png` | 440 × 280 |
| Marquee promo tile (không bắt buộc) | `promo-marquee-1400x560.png` | 1400 × 560 |
| Localized screenshots · Vietnamese | `screenshots/vi/01-save.png` → `05-retention-privacy.png` | 1280 × 800 |
| Localized screenshots · English | `screenshots/en/01-save.png` → `05-retention-privacy.png` | 1280 × 800 |

Nên giữ đúng thứ tự `01` → `05`. Promo tile không theo locale; chỉ upload một bộ promo chung. Screenshot tiếng Việt và tiếng Anh tải vào đúng locale tương ứng trong Store Listing.

## Nội dung từng screenshot

1. Luồng chính: nhập nội dung và lưu để Chrome đồng bộ.
2. Minh họa hai thiết bị và badge `1` cho revision mới chưa đọc.
3. Minh họa menu chuột phải **Thêm vào Textpipe / Add to Textpipe**; browser/menu là visual aid, popup là giao diện extension thật.
4. Form Khóa riêng tư và trạng thái popup bị khóa từ extension thật.
5. Thời gian lưu, ba quyền và disclosure từ trang Cài đặt thật.

## Kiểm tra đã thực hiện

- 13 PNG bắt buộc/tùy chọn giải mã thành công ở đúng kích thước.
- Icon có alpha bounds `x=14..114`, `y=16..112` — phù hợp khoảng trống trong canvas 128 × 128.
- Screenshot là full-bleed 1280 × 800, góc canvas vuông, không thêm viền/padding ngoài.
- Promo không có claim như “instant”, “delivered”, “best”, “Editor's Choice”, “E2EE đã audit” hay logo Google/Midjourney.
- Giao diện được chụp từ package Textpipe 1.0.0 bằng Extension ID thử nghiệm cố định; Extension ID đã được loại khỏi ảnh Store.
- Hash SHA-256 của 13 file upload nằm trong `SHA256SUMS.txt`.

## Lưu ý trước khi submit

- Chỉ dùng ảnh với build 1.0.0 có tính năng khớp nội dung. Nếu UI hoặc hành vi đổi, chụp/dựng lại ảnh.
- Chủ sản phẩm cần xác nhận quyền thương mại đối với logo đã cung cấp.
- Kiểm tra lại preview trong Developer Dashboard: chữ vẫn đọc được ở bản thu nhỏ 640 × 400 và không bị crop.
- Marquee là tùy chọn nhưng cần có nếu muốn đủ điều kiện được cân nhắc hiển thị marquee.
- Quy định tham chiếu: [Supplying Images](https://developer.chrome.com/docs/webstore/images), [Creating a great listing page](https://developer.chrome.com/docs/webstore/best-listing), [Listing Requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements).

## Tài sản do ImageGen tạo

`source/textpipe-flow-background.png` là background được tạo bằng built-in ImageGen; master logo Textpipe trong repository chỉ đóng vai trò tham chiếu chất liệu/màu sắc. Prompt cuối:

```text
Use case: stylized-concept
Asset type: Chrome Web Store promotional background for Textpipe
Input image 1: style reference only for cobalt-blue chrome material, cool highlights, and premium dark atmosphere; do not reproduce the circular-arrow logo or the letters
Primary request: create an original abstract visualization of short text flowing securely between two devices, expressed only as two restrained curved metallic ribbons and a few tiny luminous data particles
Scene/backdrop: deep charcoal-black studio gradient with subtle cobalt bloom, clean full-bleed background
Style/medium: premium minimal 3D render, precise, sophisticated, modern software brand aesthetic
Composition/framing: wide landscape, strong visual focus around center-right with generous clean negative space, works when cropped to both 440x280 and 1400x560
Lighting/mood: controlled soft studio lighting, polished cobalt and brushed silver accents, calm and trustworthy
Color palette: near-black, graphite, cobalt blue, small cool-white highlights
Constraints: no text, no letters, no logos, no browser UI, no devices with brand marks, no trademarks, no watermarks, no duplicated circular arrows, no clutter; clear silhouette; must remain legible at half size
Avoid: neon cyberpunk overload, generic cloud icons, padlocks, human figures, busy particles, bright white background
```
