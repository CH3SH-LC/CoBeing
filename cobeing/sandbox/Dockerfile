FROM node:20-bookworm

# Python 3.11
RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

# Go 1.22
RUN wget -q https://go.dev/dl/go1.22.4.linux-amd64.tar.gz && \
    tar -C /usr/local -xzf go1.22.4.linux-amd64.tar.gz && \
    rm go1.22.4.linux-amd64.tar.gz
ENV PATH=$PATH:/usr/local/go/bin

# 常用工具
RUN apt-get update && \
    apt-get install -y git curl jq make && \
    rm -rf /var/lib/apt/lists/*

# 非 root 用户
RUN useradd -m -u 1000 cobeing && \
    mkdir -p /workspace && chown cobeing:cobeing /workspace

USER cobeing
WORKDIR /workspace

CMD ["bash"]
