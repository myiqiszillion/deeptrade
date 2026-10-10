# DEPLOYMENT GUIDE

## 1. Prerequisites
- Docker & Docker Compose v2.
- Public Domain name trỏ về IP của máy chủ.

## 2. Configuration
1. Copy `.env.example` thành `.env`
2. Tạo JWT Secret ngẫu nhiên (32+ ký tự) và gán cho `AUTH_JWT_SECRET`.
   - **SECURITY WARNING**: KHÔNG TÁI SỬ DỤNG secret từ các môi trường local/dev/staging cũ.
   - Nếu bạn nghi ngờ secret bị lộ (vd: hiển thị trong log console), hãy thay đổi giá trị mới và khởi động lại server. Token cũ sẽ bị vô hiệu hóa ngay lập tức.
3. Điền các keys cần thiết:
   - `DATABENTO_API_KEY`
   - `STRIPE_SECRET_KEY`
   - `ADMIN_SECRET` (nếu cần bypass admin).
   - `DOMAIN` (ví dụ: `chart.example.com`).

## 3. Launch
Khởi chạy toàn bộ stack:
```bash
docker compose up -d --build
```
Hệ thống sẽ tự động build Frontend và Backend, khởi động Caddy, xin chứng chỉ Let's Encrypt và bắt đầu phục vụ.

## 4. Maintenance
- Xem logs: `docker compose logs -f`
- Backup Database: Copy thư mục `data/` chứa SQLite file ra nơi an toàn.
- Stop: `docker compose down`
