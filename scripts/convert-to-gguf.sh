#!/bin/bash
# scripts/convert-to-gguf.sh
# 将 HuggingFace safetensors 模型转换为 GGUF 格式（供 node-llama-cpp 使用）
#
# 前置条件:
#   pip install llama-cpp-python  (或克隆 llama.cpp 仓库)
#
# 用法:
#   bash scripts/convert-to-gguf.sh <input_dir> <output_path>
#   例如: bash scripts/convert-to-gguf.sh data/models/qwen3.5-2b data/models/qwen3.5-2b/model.gguf

set -e

INPUT_DIR="${1:?用法: $0 <input_dir> <output_path>}"
OUTPUT="${2:?用法: $0 <input_dir> <output_path>}"

echo "=== CoBeing 模型转换工具 ==="
echo "输入目录: $INPUT_DIR"
echo "输出路径: $OUTPUT"

# 检查输入目录
if [ ! -f "$INPUT_DIR/config.json" ]; then
  echo "错误: $INPUT_DIR/config.json 不存在"
  exit 1
fi

# 检查是否已有 GGUF 文件
if [ -f "$OUTPUT" ]; then
  echo "GGUF 文件已存在: $OUTPUT"
  echo "如需重新转换，请先删除该文件"
  exit 0
fi

# 尝试使用 llama.cpp 的转换脚本
LLAMA_CPP_DIR="${LLAMA_CPP_DIR:-$HOME/llama.cpp}"

if [ -d "$LLAMA_CPP_DIR" ] && [ -f "$LLAMA_CPP_DIR/convert_hf_to_gguf.py" ]; then
  echo "使用 llama.cpp 转换..."
  python3 "$LLAMA_CPP_DIR/convert_hf_to_gguf.py" \
    "$INPUT_DIR" \
    --outfile "$OUTPUT" \
    --outtype q4_k_m
else
  echo "llama.cpp 未找到。请按以下步骤操作："
  echo ""
  echo "1. 克隆 llama.cpp:"
  echo "   git clone https://github.com/ggerganov/llama.cpp \$HOME/llama.cpp"
  echo ""
  echo "2. 安装依赖:"
  echo "   pip install -r \$HOME/llama.cpp/requirements.txt"
  echo ""
  echo "3. 重新运行本脚本"
  echo ""
  echo "或者手动运行:"
  echo "   python3 \$HOME/llama.cpp/convert_hf_to_gguf.py $INPUT_DIR --outfile $OUTPUT --outtype q4_k_m"
  exit 1
fi

echo "转换完成: $OUTPUT"
echo "文件大小: $(du -h "$OUTPUT" | cut -f1)"
