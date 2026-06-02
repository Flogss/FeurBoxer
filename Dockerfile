FROM node:20-slim

# Python + pip
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node deps
COPY package*.json ./
RUN npm install --omit=dev

# Python deps
COPY requirements.txt ./
RUN pip3 install -r requirements.txt --break-system-packages

# App
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
