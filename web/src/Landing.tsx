// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { AlertBanner, Badge, ConsentBadge, IdChip, LandingPage, PreviewFrame, SourceBadge, type LandingProps } from "@junctura/health-ui";
import { ClipboardCheck, EyeOff, FileCheck2, FolderX, KeyRound, Landmark, ScrollText, Stethoscope, UserCheck } from "lucide-react";

/** A small, fictional picture of the check screen (no real member data). */
const HeroPicture = () => (
  <PreviewFrame label="Minh hoạ màn hình đối chiếu hồ sơ của Bảo hiểm, dữ liệu giả lập" title="Insurance · Đối chiếu">
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="whitespace-nowrap" tone="brand">Dữ liệu giả lập</Badge>
        <IdChip value="HS-2026-00987" label="Hồ sơ" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="whitespace-nowrap" tone="ok">Khớp</Badge>
        <ConsentBadge state="granted" />
      </div>
      <AlertBanner level="info" title="Số tiền và hồ sơ khớp">Chỉ nhận câu trả lời khớp hoặc không khớp. Không có chẩn đoán hay chi tiết điều trị.</AlertBanner>
      <SourceBadge source="Junctura" unit="Bệnh viện Đà Nẵng" />
      <p className="text-xs text-muted">Mã hồ sơ và tên cơ sở là ví dụ; không có thông tin người thật.</p>
    </div>
  </PreviewFrame>
);

const SOURCE = "https://github.com/vku2-open-source-2026/junctura-insurance";
const HEALTH = "https://github.com/vku2-open-source-2026/junctura-health";

export const landingProps = (facility?: string): Omit<LandingProps, "onSignIn"> => ({
  product: "Insurance",
  badge: "Bảo hiểm y tế",
  signInLabel: "Đăng nhập với Junctura",
  headline: "Đối chiếu chi phí nhanh, không cần xem dữ liệu điều trị",
  lead: "Với mỗi yêu cầu thanh toán, hỏi cơ sở điều trị qua Junctura xem số tiền có khớp hồ sơ hay không, rồi ghi quyết định kèm lý do. Bảo hiểm chỉ nhận câu trả lời khớp hoặc không khớp, và chỉ khi thành viên đã đồng ý.",
  note: facility ? `Hồ sơ từ ${facility}. Dữ liệu là dữ liệu giả lập.` : "Dữ liệu là dữ liệu giả lập.",
  hero: <HeroPicture />,
  benefits: {
    title: "Ba điều giám định viên cần",
    lead: "Thiết kế cho người xử lý nhiều hồ sơ mỗi ngày: một hồ sơ, một câu trả lời, một quyết định có lý do.",
    items: [
      { icon: <FileCheck2 className="size-5" />, title: "Đối chiếu chi phí nhanh", text: "Một lần bấm để biết số tiền đề nghị có khớp hồ sơ điều trị không; hồ sơ kế tiếp mở ngay sau khi quyết định." },
      { icon: <EyeOff className="size-5" />, title: "Không nhận dữ liệu điều trị", text: "Bảo hiểm không thấy chẩn đoán, thuốc hay chi tiết điều trị. Chỉ có câu trả lời khớp hoặc không khớp." },
      { icon: <ClipboardCheck className="size-5" />, title: "Lý do quyết định được lưu lại", text: "Chấp nhận, từ chối hay yêu cầu giải trình đều cần lý do, ghi kèm tên người quyết định và thời điểm." },
    ],
  },
  steps: {
    title: "Một lần đối chiếu diễn ra thế nào",
    lead: "Junctura đứng giữa Bảo hiểm và cơ sở điều trị, nên mỗi lần hỏi đều có mục đích và dấu vết.",
    items: [
      { title: "Mở hồ sơ trong hàng chờ", text: "Lọc theo trạng thái, số tiền hoặc tìm theo mã hồ sơ." },
      { title: "Junctura kiểm tra đồng thuận", text: "Junctura xác định đúng thành viên, đúng mục đích giám định chi phí và ghi lại lần hỏi." },
      { title: "Cơ sở điều trị trả có hoặc không", text: "Chỉ một câu trả lời: số tiền và hồ sơ có khớp hay không." },
      { title: "Ghi quyết định", text: "Chấp nhận (chỉ khi khớp), từ chối hoặc yêu cầu giải trình, kèm lý do." },
    ],
  },
  audiences: {
    title: "Dành cho ai",
    lead: "Một ứng dụng cho giám định viên, hoạt động cùng cơ sở điều trị và thành viên qua Junctura.",
    items: [
      { icon: <Landmark className="size-5" />, title: "Giám định viên", text: "Xử lý hàng chờ, đối chiếu, quyết định và xem báo cáo trong cùng một ứng dụng." },
      { icon: <Stethoscope className="size-5" />, title: "Cơ sở điều trị", text: "Trả lời câu hỏi của Bảo hiểm qua Junctura, không cần đăng nhập vào Insurance." },
      { icon: <UserCheck className="size-5" />, title: "Thành viên", text: "Quyết định có cho Bảo hiểm đối chiếu chi phí hay không qua MyHealth; mọi lần hỏi đều có dấu vết." },
    ],
  },
  trust: {
    title: "Bảo mật và riêng tư",
    lead: "Insurance chỉ hỏi đúng điều cần cho việc giám định và không giữ dữ liệu điều trị.",
    items: [
      { icon: <FolderX className="size-5" />, title: "Không giữ dữ liệu điều trị", text: "Ứng dụng không có kho hồ sơ bệnh. Thông tin duy nhất về điều trị là khớp hoặc không khớp." },
      { icon: <ScrollText className="size-5" />, title: "Mọi lần hỏi có dấu vết", text: "Nhật ký ghi năng lực, mục đích, kết quả, hồ sơ và giám định viên; không ghi mã thành viên hay nội dung điều trị." },
      { icon: <KeyRound className="size-5" />, title: "Đăng nhập qua Junctura", text: "Mật khẩu chỉ nhập trên trang của Junctura; chỉ tài khoản giám định viên của ứng dụng này vào được." },
    ],
  },
  faq: {
    title: "Câu hỏi thường gặp",
    items: [
      { q: "Bảo hiểm có thấy chẩn đoán hay chi tiết điều trị không?", a: "Không. Câu trả lời duy nhất từ cơ sở điều trị là khớp hoặc không khớp, theo hợp đồng chung của Junctura Health." },
      { q: "Chưa có đồng thuận thì ứng dụng hiện gì?", a: "Hiện rõ là thành viên chưa đồng ý, và hồ sơ vẫn ở trạng thái chưa đối chiếu. Không bao giờ coi đó là khớp hay không khớp." },
      { q: "Khi nào được chấp nhận hồ sơ?", a: "Chỉ khi lần đối chiếu gần nhất cho kết quả khớp. Từ chối và yêu cầu giải trình luôn làm được, kèm lý do." },
      { q: "Quyết định có sửa được không?", a: "Chấp nhận và từ chối là quyết định cuối cùng. Yêu cầu giải trình thì có thể quyết định tiếp sau đó." },
    ],
  },
  cta: { title: "Sẵn sàng xử lý hàng chờ?", lead: "Đăng nhập bằng tài khoản Junctura của giám định viên." },
  footer: {
    links: [
      { label: "Mã nguồn", href: SOURCE },
      { label: "Junctura Health", href: HEALTH },
      { label: "Báo lỗi", href: `${SOURCE}/issues` },
      { label: "Giấy phép", href: "https://www.apache.org/licenses/LICENSE-2.0" },
    ],
    note: "Dữ liệu giả lập",
  },
});

export const Landing = ({ facility, onSignIn }: { facility?: string; onSignIn: () => void }) => <LandingPage {...landingProps(facility)} onSignIn={onSignIn} />;
