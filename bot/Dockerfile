FROM node:20-slim

WORKDIR /app

# python3/make/g++ = build native module (better-sqlite3); poppler-utils = pdftoppm (PDF→รูป);
# qpdf = ถอดรหัส PDF statement ที่ติดรหัสผ่าน (ดู pdf.js)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ poppler-utils qpdf \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

RUN mkdir -p /app/data

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/index.js"]
