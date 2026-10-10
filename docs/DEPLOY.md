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

## 4. Maintenance & Backups
- Xem logs: `docker compose logs -f`
- **Backup Database (WAL-Safe):**
  - **CẢNH BÁO QUAN TRỌNG:** KHÔNG copy file thô `data/market_data.sqlite` khi database đang hoạt động. SQLite chạy ở chế độ WAL (`PRAGMA journal_mode = wal`) với các transaction đang mở trong file `-wal`, việc copy file thô từ host filesystem sẽ gây torn pages hoặc rủi ro hỏng cơ sở dữ liệu.
  - **Cách backup chuẩn:** Sử dụng lệnh snapshot online không khóa:
    ```bash
    docker compose exec app node scripts/backup_db.mjs
    ```
    hoặc dùng công cụ `sqlite3` chính thống:
    ```bash
    docker compose exec app sqlite3 /app/data/market_data.sqlite ".backup /app/backups/manual_backup.sqlite"
    ```
  - Bản snapshot an toàn được lưu trong `./backups/` trên host (được volume mount).
- Stop: `docker compose down`
