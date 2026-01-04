# Game Translate Tool (WuWa Localizer)

Công cụ hỗ trợ dịch thuật game tự động (đặc biệt tối ưu cho Wuthering Waves) sử dụng sức mạnh của LLM (AI) thông qua giao diện trực quan, tốc độ cao và ổn định.

## 🚀 Tính Năng Chính

*   **Dịch Đa Luồng (Multi-threading)**: Tự động chia nhỏ file thành các gói (Batch) và xử lý song song để tối đa hóa tốc độ.
*   **Worker Pool Thông Minh**: Quản lý số lượng luồng chạy đồng thời (Concurrency) theo cấu hình máy, đảm bảo không bị quá tải.
*   **Cơ Chế Tự Động Thử Lại (Auto-Retry)**: Nếu API gặp lỗi (mạng, timeout), tool sẽ tự động thử lại gói dữ liệu đó cho đến khi thành công (không bỏ sót dòng).
*   **Lưu Tạm Thời (Real-time Save)**: Kết quả được lưu ngay lập tức vào `temp_translating.txt` sau mỗi batch, tránh mất dữ liệu khi crash.
*   **Theo Dõi Trực Quan**:
    *   Thanh tiến trình tổng thể (**Progress**).
    *   Trạng thái chi tiết của từng Thread đang chạy.
    *   Log thời gian thực (Stream text) từ AI.
*   **Single Instance**: Chỉ cho phép chạy 1 cửa sổ ứng dụng để tránh xung đột file.

## 🛠️ Cài Đặt & Chạy (Dành cho Dev)

Yêu cầu:
*   Node.js (v18+)
*   Rust (Cargo)
*   Kiến thức cơ bản về Terminal

```bash
# 1. Cài đặt dependencies Frontend
npm install

# 2. Chạy chế độ Development (Hot Reload)
npm run tauri dev

# 3. Build ra file .exe (Production)
npm run tauri build
```

## ⚙️ Hướng Dẫn Cấu Hình (Settings)

*   **URL**: Endpoint của API (VD: `https://api.openai.com/v1` hoặc các dịch vụ Local/Proxy).
*   **Key**: API Key.
*   **Model**: Tên model (VD: `gpt-4`, `mistral-large`, `gemini-pro`).
*   **System Prompt**: Chỉ thị cốt lõi cho AI (Role, Context, Font style...).
*   **Threads**: Số lượng luồng dịch song song (Khuyên dùng: 2-5 tùy vào giới hạn API của bạn).
*   **Batch**: Số dòng trong 1 gói xử lý (Khuyên dùng: 50-100).
*   **Delay**: Thời gian nghỉ giữa các request (giây) để tránh bị chặn IP/Rate Limit.

## 📂 Cấu Trúc File Output

Trong quá trình chạy, Tool sẽ sinh ra các file tại thư mục gốc của ứng dụng:

1.  **`config.json`**: Lưu cấu hình cá nhân (được load tự động khi mở app).
2.  **`temp_translating.txt`**: File lưu tạm thời kết quả dịch. Dùng để backup.
3.  **`thread.txt`**: Log ghi lại phân chia nhiệm vụ (VD: `Thread 1: 0-49`). Thứ tự trong file này luôn tăng dần để dễ tra cứu.
4.  **`tran.txt`**: File kết quả cuối cùng (Chỉ sinh ra khi hoàn tất 100%).

## 📝 Định Dạng File Dịch

Tool nhận file đầu vào (`.txt`) có định dạng đặc biệt, thường là:
```text
ID:::Text Cần Dịch
101:::Hello World
102:::Attack
```
Kết quả trả về sẽ giữ nguyên ID:
```text
101:::Xin chào thế giới
102:::Tấn công
```

## 💖 Credits
Developed for Wuthering Waves Vietnamese Localization Project.
