import re

def clean_text(text):
    # Loại bỏ ID::: ở đầu nếu có (để lấy phần nội dung)
    if ':::' in text:
        text = text.split(':::', 1)[1]
    # Chỉ giữ lại chữ cái (a-z, A-Z) và khoảng trắng
    text = re.sub(r'[^a-zA-Z\s]', '', text).lower()
    return text.split()

def load_file_map(file_path):
    data_map = {}
    ids = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                if ':::' in line:
                    parts = line.split(':::', 1)
                    if len(parts) == 2:
                        try:
                            t_id_str = parts[0].strip()
                            t_id = int(t_id_str)
                            content = parts[1].strip()
                            data_map[t_id] = content
                            ids.append(t_id)
                        except ValueError:
                            pass # Bỏ qua dòng không có ID hợp lệ
    except FileNotFoundError:
        print(f"Không tìm thấy file: {file_path}")
        return {}, []
    return data_map, ids

def check_missing_ids_and_content():
    final_path = 'final.txt'
    goc_path = 'goc.txt'

    print(f"Đang đọc {final_path}...")
    final_map, final_ids = load_file_map(final_path)
    
    if not final_ids:
        print("File final.txt rỗng hoặc không đúng định dạng.")
        return

    # Sắp xếp ID để kiểm tra tính liên tục
    final_ids.sort()
    start_id = final_ids[0]
    end_id = final_ids[-1]

    print(f"Phạm vi ID: {start_id} -> {end_id}")
    print("--- Kiểm tra ID thiếu ---")
    
    # Tạo set để tra cứu nhanh
    final_id_set = set(final_ids)
    
    # Tạo danh sách đầy đủ các ID lý thuyết từ start đến end
    # Lưu ý: Cách này giả định ID file gốc liên tục. 
    # Nhưng đề bài yêu cầu "đang 8 mà lên 10 luôn", tức là kiểm tra liên tục số học.
    missing_count = 0
    # Logic tối ưu: Duyệt qua list đã sort, kiểm tra gap
    for i in range(len(final_ids) - 1):
        gap = final_ids[i+1] - final_ids[i]
        if gap > 1:
            # Có gap
            missing_range = list(range(final_ids[i]+1, final_ids[i+1]))
            # Chỉ in 10 cái đầu tiên nếu gap quá lớn để tránh spam
            if len(missing_range) > 10:
                 print(f"Thiếu ID từ {final_ids[i]+1} đến {final_ids[i+1]-1} ({len(missing_range)} IDs)")
            else:
                 for mid in missing_range:
                     print(f"Thiếu ID: {mid}")
            missing_count += len(missing_range)
    
    if missing_count == 0:
        print(">> Không phát hiện ID nào bị thiếu (liên tục).")
    else:
        print(f">> Tổng cộng thiếu {missing_count} ID.")

    print("\n--- Kiểm tra nội dung (so khớp với goc.txt) ---")
    print(f"Đang đọc {goc_path} (chỉ đọc các ID cần thiết)...")
    
    # Chỉ load những dòng trong goc.txt khớp ID với final.txt để tiết kiệm RAM
    # Tuy nhiên thực tế đọc line-by-line là tốt nhất.
    
    goc_issue_count = 0
    
    try:
        with open(goc_path, 'r', encoding='utf-8') as f:
            for line in f:
                if ':::' in line:
                    parts = line.split(':::', 1)
                    if len(parts) == 2:
                        try:
                            g_id = int(parts[0].strip())
                            
                            # Chỉ kiểm tra nếu ID này có trong final.txt
                            if g_id in final_map:
                                final_content = final_map[g_id]
                                goc_content = parts[1].strip()
                                
                                # Nếu nội dung trống thì bỏ qua check
                                if not final_content and not goc_content:
                                    continue

                                # So sánh 3 từ đầu tiên liền nhau
                                f_words_list = clean_text(final_content)
                                g_words_list = clean_text(goc_content)
                                
                                is_suspicious = False
                                
                                # Chỉ so sánh nếu cả 2 bên đều có ít nhất 1 từ (chữ cái)
                                if f_words_list and g_words_list:
                                    if len(f_words_list) >= 3 and len(g_words_list) >= 3:
                                        if f_words_list[:3] == g_words_list[:3]:
                                            is_suspicious = True
                                    elif len(f_words_list) == len(g_words_list) and f_words_list == g_words_list:
                                        # Trường hợp câu ngắn < 3 từ nhưng giống hệt nhau
                                        is_suspicious = True

                                if is_suspicious:
                                    print(f"[CẢNH BÁO] ID {g_id}: 3 từ đầu giống hệt bản gốc.")
                                    print(f"  - Gốc: {goc_content[:50]}...")
                                    print(f"  - Dịch: {final_content[:50]}...")
                                    goc_issue_count += 1
                                    
                        except ValueError:
                            pass
    except FileNotFoundError:
        print(f"Không tìm thấy file: {goc_path}")
        return

    if goc_issue_count == 0:
        print(">> Tuyệt vời! Không có dòng nào bị nghi ngờ giống bản gốc.")
    else:
        print(f">> Phát hiện {goc_issue_count} dòng có nội dung giống bản gốc (nghi ngờ chưa dịch).")

if __name__ == "__main__":
    check_missing_ids_and_content()
