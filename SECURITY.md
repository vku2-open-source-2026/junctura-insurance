<!-- SPDX-FileCopyrightText: 2026 Junctura Contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Chính sách bảo mật

Junctura Insurance cho giám định viên đối chiếu hồ sơ thanh toán với dữ liệu điều trị và ghi quyết định chấp nhận hay từ chối, nên lỗi bảo mật, lỗi lộ dữ liệu người bệnh và lỗi làm sai quyết định được coi trọng hơn lỗi thông thường.

## Phiên bản được hỗ trợ

| Phiên bản | Hỗ trợ bản vá bảo mật |
| --- | --- |
| Nhánh `main` và bản phát hành mới nhất | Có |
| Bản cũ hơn | Không |

## Báo cáo lỗ hổng

**Vui lòng không mở Issue công khai cho lỗ hổng bảo mật.**

1. Vào tab **Security** của repo [junctura-insurance](https://github.com/vku2-open-source-2026/junctura-insurance/security) và chọn **Report a vulnerability** (báo cáo riêng tư của GitHub).
2. Nếu không dùng được cách trên, mở một Issue công khai chỉ ghi "cần báo cáo bảo mật" và **không** nêu chi tiết; người duy trì sẽ liên hệ lại để trao đổi riêng.

Nên kèm theo:

- Mô tả lỗ hổng và tác động (ai bị ảnh hưởng, dữ liệu nào lộ, quyết định có thể bị ghi sai không).
- Các bước tái hiện, phiên bản hoặc commit.
- Đề xuất cách sửa, nếu có.

Nhóm là nhóm sinh viên nên không cam kết thời hạn cố định, nhưng sẽ cố gắng phản hồi trong vòng 7 ngày, thông báo hướng xử lý và ghi nhận người báo cáo (nếu họ đồng ý) khi phát hành bản vá.

## Phạm vi

**Trong phạm vi:** đăng nhập và kiểm tra vai trò giám định viên (`claims-assessor`); cách gọi năng lực `claim-verify` qua Junctura (mục đích `claim_review`, người bệnh trong `context.dataSubject`, kiểm tra dữ liệu trả về theo hợp đồng); việc Insurance chỉ nhận kết quả khớp / không khớp và không bao giờ hiển thị chẩn đoán hay chi tiết điều trị; các quy tắc quyết định (chỉ chấp nhận khi lần đối chiếu mới nhất khớp, quyết định chấp nhận và từ chối là cuối cùng, lý do bắt buộc); việc lộ mã người bệnh qua API, giao diện, báo cáo CSV hoặc nhật ký; xử lý đầu vào; lộ bí mật trong mã nguồn hoặc lịch sử git.

**Ngoài phạm vi:** lỗi chỉ xảy ra khi cố tình cấu hình thiếu an toàn (ví dụ để lộ `JUNCTURA_APP_CLIENT_SECRET`, tắt HTTPS ở môi trường công khai); tấn công từ chối dịch vụ bằng lưu lượng lớn; lỗi trong thư viện bên thứ ba chưa có bản sửa (hãy báo cho tác giả thư viện); dữ liệu mẫu (đều là giả lập, không có người thật).

**Lưu ý về quyền riêng tư:** nếu bạn thấy giao diện, API, nhật ký hoặc CSV của Insurance để lộ chẩn đoán, thuốc, hoặc mã định danh đầy đủ của người bệnh, đó là lỗi bảo mật và nên báo như trên.

## Khi tự chạy ứng dụng

- Không commit `.env`, khóa, token; truyền thông tin kết nối Junctura bằng biến môi trường hoặc `--env-file`.
- Không đưa dữ liệu người bệnh thật vào môi trường thử nghiệm.
- Khi mở ứng dụng ra mạng, đặt nó sau một reverse proxy có HTTPS.
