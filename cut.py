import os

def main():
    source_file = 'goc.txt'
    output_file = 'temp.txt'

    if not os.path.exists(source_file):
        print(f"Lỗi: Không tìm thấy file {source_file}")
        return

    try:
        start_input = input("Nhập Start ID: ").strip()
        stop_input = input("Nhập Stop ID: ").strip()
        
        if not start_input or not stop_input:
            print("Vui lòng nhập đầy đủ Start ID và Stop ID.")
            return

        start_id = int(start_input)
        stop_id = int(stop_input)
    except ValueError:
        print("Lỗi: ID phải là số nguyên.")
        return

    if start_id > stop_id:
        print("Lỗi: Start ID không được lớn hơn Stop ID.")
        return

    print(f"Đang trích xuất từ ID {start_id} đến {stop_id}...")

    extracted_lines = []
    count = 0
    
    try:
        with open(source_file, 'r', encoding='utf-8') as f:
            for line in f:
                if ':::' in line:
                    try:
                        parts = line.split(':::', 1)
                        if len(parts) == 2:
                            line_id_str = parts[0].strip()
                            # Xử lý trường hợp ID có thể có ký tự lạ, nhưng thường là số ở đầu dòng
                            if line_id_str.isdigit() or (line_id_str.startswith('-') and line_id_str[1:].isdigit()):
                                line_id = int(line_id_str)
                                
                                if start_id <= line_id <= stop_id:
                                    extracted_lines.append(line)
                                    count += 1
                    except ValueError:
                        continue 

        with open(output_file, 'w', encoding='utf-8') as f:
            f.writelines(extracted_lines)
            
        print(f"Hoàn tất! Đã trích xuất {count} dòng sang {output_file}.")

    except Exception as e:
        print(f"Đã xảy ra lỗi: {e}")

if __name__ == "__main__":
    main()
