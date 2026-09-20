# Design system: Midnight Studio

Textpipe dùng phong cách **Midnight Studio**: nền dark-neutral, typography mềm, nút pill và một composer nổi bật. Hệ thống lấy cảm hứng từ nhịp giao diện editor của Midjourney nhưng không sao chép logo, icon, bố cục hay màu accent nhận diện của Midjourney.

## Nguyên tắc

1. Nội dung người dùng là điểm nhìn chính; textarea là bề mặt duy nhất có shadow.
2. Popup đọc theo một luồng dọc. Không card mosaic, không status/security hai cột và không card lồng card.
3. Settings là một cột liên tục; section được phân tách bằng đường kẻ, không bằng các “đảo” có viền và gradient.
4. **Lưu để đồng bộ** là primary action và đứng trước Copy/Clear trong DOM, tab order và giao diện.
5. Trạng thái nói đúng khả năng kỹ thuật: **“Đã lưu trên máy này để Chrome đồng bộ”**; không nói máy kia đã nhận.
6. Màu không bao giờ là tín hiệu duy nhất; trạng thái luôn có text và khi cần có icon.
7. Không remote font, remote image, animation marketing, glassmorphism, decorative noise hoặc telemetry.

## Brand asset

- Master: `assets/brand/textpipe-logo-master.png`, nền alpha thật, không ship trong extension.
- Runtime: `public/icons/icon-{16,32,48,128}.png`.
- `BrandMark` dùng `icon-128.png`, hiển thị 36 px trong popup và 44 px ở Settings; `alt=""` vì tên sản phẩm đã nằm cạnh logo.
- Gói audit chỉ chấp nhận PNG 8-bit RGBA đúng kích thước, các chunk `IHDR`/`IDAT`/`IEND`, CRC hợp lệ và không dữ liệu sau `IEND`.
- Không commit ảnh nguồn có prompt/XMP/C2PA/Job ID. Chạy `scripts/sanitize-png.mjs` sau mọi lần tạo lại asset.

## Typography

- UI dùng `Plus Jakarta Sans Variable` 200–800 từ package pin chính xác `@fontsource-variable/plus-jakarta-sans@5.3.0`.
- Chỉ bundle ba subset WOFF2 đã audit: Latin, Latin Extended và Vietnamese; không tải font khi extension chạy.
- Plus Jakarta Sans được chọn thay DM Sans vì DM Sans upstream hiện không có đầy đủ glyph tiếng Việt. Đây là lựa chọn gần về hình học nhưng không làm chữ Ơ/Ư và dấu ghép nhảy sang font hệ thống.
- License OFL-1.1 được ship tại `third-party-licenses/Plus-Jakarta-Sans-OFL-1.1.txt` trong mọi package.
- Body 14/20 weight 400; textarea 16/24; label 13/18 weight 600; heading section 17/23 weight 600; button 14/20 weight 600.
- Extension ID và dữ liệu chẩn đoán dùng system monospace.

## Tokens

Nguồn chuẩn nằm ở `src/ui/base.css`; page CSS phải dùng token trước khi thêm giá trị riêng.

| Vai trò | Giá trị |
|---|---:|
| Canvas | `#0D0E12` |
| Section surface | `#15161B` |
| Composer/control | `#1E1F25` |
| Hover | `#26282F` |
| Text | `#EBECEF` |
| Muted | `#AAAEBB` |
| Subtle | `#747A8B` |
| Border | `#292C32` |
| Control border | `#434651` |
| Primary | `#EBECEF` trên `#0D0E12` |
| Focus | `#63B3ED` |
| Success | `#79D49D` |
| Warning | `#F0BC73` |
| Danger | `#FF9385` |

- Spacing: `4, 8, 12, 16, 20, 24` px.
- Radius: 6 px compact, 8 px icon/state, 12 px composer/form, pill cho text button.
- Shadow: chỉ composer, `0 7px 21px rgb(0 0 0 / 25%)`.
- Interactive target: tối thiểu 44×44 px.
- Focus: outline 2 px, offset 2 px.
- Motion: 140 ms; reduced-motion tắt spinner animation nhưng giữ text trạng thái.

## Popup

- Target width 400 px; kiểm tra từ 320–430 px.
- Header phẳng 54 px, logo nhỏ; trạng thái mạng là metadata, không được gọi là receipt của Sync.
- Composer là vùng chính: heading/counter → textarea → helper/error → live status.
- Action theo thứ tự Save → Copy → Clear. Từ 361 px dùng một hàng; ở 320–360 px Save chiếm hàng đầu để nhãn tiếng Việt không bị cắt.
- Security là footer metadata có divider, không phải card.
- Textarea tối thiểu 206 px, resize theo chiều dọc, không tự chèn/format nội dung.
- Clear confirmation, remote conflict và lỗi là tonal inline panel duy nhất khi trạng thái đó xuất hiện.
- `Ctrl/Cmd+Enter` lưu; Enter thường tạo newline.

## Options

- Container tối đa 820 px, một cột và nền phẳng.
- Header 68 px, logo 44 px; không hero card.
- Section Sync, retention, Private Lock, permissions và limitations/reset đi từ trên xuống, ngăn bằng border 1 px.
- Retention dùng label/control hai cột khi đủ 680 px và tự về một cột ở màn hình hẹp.
- Chỉ form bật/tắt Private Lock đang mở được dùng tonal surface để biểu thị một tác vụ tạm thời.
- Version và Extension ID phải lấy từ runtime; ID giữ LTR, có thể copy.
- Mutation chạy tuần tự, form có `aria-busy`, các control liên quan disable nhất quán.

## Accessibility và responsive gates

- Chỉ dùng native `button`, `textarea`, `input`, `select` cho control.
- Visible label cho field; icon button bắt buộc có accessible name.
- `role=status` cho feedback polite, `role=alert` cho lỗi.
- Dark-first cố định để nhận diện nhất quán; vẫn hỗ trợ reduced motion và Windows forced colors.
- Forced colors thay surface bằng Canvas/ButtonBorder, bỏ shadow và không che focus.
- Popup: 320, 360, 390, 430 px. Options: 320, 360, 390, 430, 768, 1280 px.
- Mỗi gate kiểm tra không horizontal overflow, logo tải đúng 128×128, target ≥44 px, CTA không clip, font VI local tải thành công và thứ tự Save → Copy → Clear.
- Kiểm tra thủ công ở zoom 200% với cả copy tiếng Việt và tiếng Anh dài nhất.

## Copy tone

- Ngắn, cụ thể, không anthropomorphize Chrome Sync.
- Dùng “Có mạng / Network available”, không dùng như delivery receipt.
- Không dùng “đã gửi”, “đã nhận”, “realtime”, “zero knowledge” hoặc “secure erase”.
- Khi thêm copy, cập nhật cả VI/EN trong `src/shared/i18n.ts` và test bản dài hơn.

Mọi trang hoặc trạng thái mới phải kế thừa tokens, typography, composer, button, focus, locale, error/busy và truthful-copy rules ở tài liệu này.
