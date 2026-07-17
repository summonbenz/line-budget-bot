# Line budget bot — deploy บน DigitalOcean droplet (1 vCPU / 1GB RAM)

โครงสร้าง: Chiyu (reverse proxy + TLS) → line-bot (Node.js) → actual-server (Actual Budget)
รายละเอียดสถาปัตยกรรมดูจาก diagram ที่คุยกันไว้ก่อนหน้า

## สิ่งที่ต้องเตรียมก่อน

- Droplet DigitalOcean: Ubuntu 22.04, `s-1vcpu-1gb`
- โดเมนหรือ subdomain ที่ชี้ DNS A record มาที่ IP ของ droplet แล้ว (Chiyu ต้องใช้ขอ TLS cert)
- Line Developers Console: สร้าง Messaging API channel, เก็บ Channel secret + Channel access token
- Line Developers Console: สร้าง LINE Login channel สำหรับ LIFF dashboard (ทำตอนขั้นตอนที่ 7 ก็ได้)
- Google Cloud: เปิดใช้ Vision API แล้วสร้าง API key

## ขั้นตอนที่ 1 — เตรียมเครื่อง (รันบน droplet ผ่าน ssh)

```bash
ssh root@YOUR_DROPLET_IP

# อัปเดตระบบ
apt update && apt upgrade -y

# ตั้ง swap 2GB กัน RAM ไม่พอ
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# ติดตั้ง Docker + Compose plugin
curl -fsSL https://get.docker.com | sh

# firewall เปิดแค่ที่จำเป็น
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable
```

## ขั้นตอนที่ 2 — สร้างโฟลเดอร์และอัปโหลดโปรเจกต์

จากเครื่องตัวเอง (ไม่ใช่ droplet) อัปโหลดโฟลเดอร์ `line-budget-bot/` ทั้งหมดขึ้นไป:

```bash
scp -r line-budget-bot root@YOUR_DROPLET_IP:/opt/line-budget-bot
```

หรือถ้าจะใช้ git ให้ push โปรเจกต์นี้ขึ้น repo ก่อน แล้ว clone บน droplet แทน:

```bash
# บน droplet
mkdir -p /opt/line-budget-bot
cd /opt/line-budget-bot
git clone <your-repo-url> .
```

## ขั้นตอนที่ 3 — ตั้งค่า environment

```bash
cd /opt/line-budget-bot
cp .env.example .env
nano .env   # กรอก DOMAIN, LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN, GOOGLE_VISION_API_KEY, ACTUAL_SERVER_PASSWORD
```

`ACTUAL_SYNC_ID` ยังใส่ไม่ได้ตอนนี้ — ต้องรอสร้าง budget ในขั้นตอนที่ 5 ก่อน

## ขั้นตอนที่ 4 — build และรัน

```bash
docker compose up -d --build
docker compose ps      # เช็คว่าทั้ง 3 container ขึ้นสถานะ running
docker compose logs -f line-bot   # ดู log กันพลาด
```

## ขั้นตอนที่ 5 — สร้าง budget ใน Actual ครั้งแรก

1. เปิดเบราว์เซอร์ไปที่ `https://YOUR_ACTUAL_DOMAIN` (ค่า `ACTUAL_DOMAIN` ใน `.env` — ต้องเป็นซับโดเมนแยกจาก `DOMAIN` เพราะ Actual serve asset ด้วย absolute path ที่ proxy เป็น path prefix ไม่ได้)
2. ตั้งรหัสผ่าน (ใช้ค่าเดียวกับ `ACTUAL_SERVER_PASSWORD` ใน `.env`)
3. สร้างงบประมาณใหม่ (New budget) ตั้งชื่อ เช่น "ของฉัน"
4. ไปที่ Settings > Show advanced settings > คัดลอกค่า Sync ID
5. กลับไปแก้ `.env` ใส่ `ACTUAL_SYNC_ID=<ค่าที่คัดลอกมา>`
6. รีสตาร์ท bot ให้ดึงค่าใหม่:

```bash
docker compose restart line-bot
```

7. ในหน้าเว็บ Actual สร้าง account ให้ตรงกับที่ใช้จริง เช่น "เงินสด", "บัตรเครดิต A", "บัตรเครดิต B" — จด account id ไว้ใช้ mapping ในโค้ด (`bot/src/index.js` จุดที่มี `// TODO: map ไป accountId จริง`)

## ขั้นตอนที่ 6 — ผูก webhook กับ Line

1. Line Developers Console > Messaging API > Webhook URL ใส่ `https://YOUR_DOMAIN/webhook`
2. เปิด "Use webhook"
3. กด Verify ต้องได้ Success
4. ปิด auto-reply message ของ Line official account (Response settings) กันชนกับบอท

ทดสอบ: เพิ่มเพื่อนบอทแล้วพิมพ์ `ข้าว 60` ควรได้รับข้อความ "บันทึกแล้ว: ข้าว -60 บาท"

หลังจากทักบอทแล้ว เช็ค log เอา line user id ของตัวเองมาใส่ `.env` ในขั้นตอนถัดไป:

```bash
docker compose logs line-bot | grep line_user_id
```

## ขั้นตอนที่ 7 — ผูก LIFF dashboard

LIFF ต้องสร้างภายใต้ channel ที่มี "LINE Login" (จะเป็นคนละ channel id กับ Messaging API ก็ได้ แต่แนะนำสร้างในโปรเจกต์เดียวกันใน Line Developers Console เพื่อจัดการง่าย)

`liff-web/` เป็นโปรเจกต์ SvelteKit แยกต่างหาก (adapter-static) ต้อง build ก่อนถึงจะได้ static files ให้ Chiyu เสิร์ฟ

1. Line Developers Console > provider ของคุณ > สร้าง LINE Login channel (ถ้ายังไม่มี)
2. ในแท็บ LIFF ของ channel นั้น กด Add
   - Endpoint URL: `https://YOUR_DOMAIN/app/`
   - Size: Full
   - Scope: `profile`, `openid`
3. คัดลอก Channel ID ของ LINE Login channel นี้ (ไม่ใช่ Messaging API channel) มาใส่ `.env` ที่ root ที่ `LIFF_CHANNEL_ID`
4. ใส่ line user id ที่ได้จากขั้นตอนที่ 6 ลงใน `.env` ที่ root ที่ `ALLOWED_LINE_USER_ID`
5. ตั้งค่าฝั่ง `liff-web/` แยกต่างหาก:

```bash
cd liff-web
cp .env.example .env
nano .env   # ใส่ VITE_LIFF_ID=<LIFF ID ที่คัดลอกมาจากข้อ 2>
bun install # หรือ npm install ถ้าไม่ได้ใช้ bun
bun run build
cd ..
```

`bun run build` จะ output ไปที่ `liff-web/build/` ซึ่งเป็นโฟลเดอร์ที่ `docker-compose.yml` mount เข้า Chiyu อยู่แล้ว

6. รีสตาร์ท container:

```bash
docker compose restart line-bot chiyu
```

7. เปิดจากในแอป Line ด้วยลิงก์ `https://liff.line.me/{LIFF_ID}` (ส่งลิงก์นี้คุยกับตัวเองใน Line เพื่อทดสอบ กด link จะเปิด LIFF ในแอป) — ควรเห็นการ์ดยอดคงเหลือแต่ละบัญชีและกราฟ cashflow

หมายเหตุ: `/app/` ต้องเข้าจากในแอป Line เท่านั้นถึงจะ login อัตโนมัติผ่าน LIFF ได้ เปิดจากเบราว์เซอร์ปกติจะ redirect ไป login LINE ก่อน

ทุกครั้งที่แก้โค้ดใน `liff-web/` ต้อง `bun run build` ใหม่แล้ว `docker compose restart chiyu` ถึงจะเห็นผล (ไม่ใช่ hot reload แบบตอน dev)

## ความปลอดภัยที่ควรทำต่อ

- ปิด root SSH password login เปลี่ยนไปใช้ SSH key อย่างเดียว
- เปิด basicauth คุม `ACTUAL_DOMAIN` block ใน `Caddyfile` (มีตัวอย่าง comment ไว้ในไฟล์แล้ว) เพราะเป็นหน้าที่เห็นข้อมูลการเงินทั้งหมด
- สำรอง volume `actual_data` และ `bot_data` เป็นระยะ (`docker run --rm -v line-budget-bot_actual_data:/data -v $(pwd):/backup alpine tar czf /backup/actual-backup.tar.gz /data`)

## อัปเดตโค้ดทีหลัง

```bash
cd /opt/line-budget-bot
git pull            # หรือ scp ไฟล์ใหม่ทับ
docker compose up -d --build line-bot

# ถ้าแก้ liff-web/ ด้วย ต้อง build ใหม่ก่อน restart chiyu
cd liff-web && bun install && bun run build && cd ..
docker compose restart chiyu
```

## สิ่งที่ยังเป็น TODO ในโค้ด (จุดต่อยอด)

- `bot/src/index.js` — map ข้อความ/สลิปเข้า `accountId` จริงของ Actual แทนที่จะแค่ตอบข้อความเฉย ๆ
- `bot/src/index.js` (`handleImage`) — parse ยอดเงิน/เลขอ้างอิงจากผลลัพธ์ OCR + เช็คกันซ้ำผ่านตาราง `transaction_refs`
- `bot/src/index.js` (`handleFile`) — เขียน parser อ่าน PDF statement ต่อธนาคาร (แนะนำเริ่มจาก `pdf-parse` สำหรับ PDF ที่เป็นข้อความ)
- เพิ่มคำสั่ง summary/cashflow แบบดูผ่าน Line โดยตรง (ตอนนี้ดูได้ผ่าน LIFF dashboard แล้ว แต่ยังไม่มีคำสั่งข้อความ)
- เพิ่ม scheduled reminder (due date บัตร) ด้วย `node-cron` ภายใน `line-bot` container
- `bot/src/routes/api.js` — ตอนนี้ยังไม่มีคำสั่งเพิ่มบัตรเข้าตาราง `cards` ผ่าน Line เลยต้อง insert เข้า SQLite เองก่อน (หรือเพิ่ม text command เช่น "เพิ่มบัตร กรุงศรี" ใน `bot/src/index.js`)
- `bot/src/actualClient.js` (`getAccountBalance`) — เช็ค method จริงของ `@actual-app/api` เวอร์ชันที่ติดตั้งอีกครั้งก่อน deploy เพราะ API อาจมี field balance ให้ตรงๆ อยู่แล้วในบางเวอร์ชัน (เร็วกว่าการ sum transaction เอง)
- `liff-web/` — ตอนนี้เป็น SvelteKit (adapter-static) แล้ว หน้าเดียว ไม่มี routing เพิ่ม ถ้าจะเพิ่มหน้าเพิ่มบัตร/แก้ transaction ทีหลังค่อยเพิ่ม route ใหม่ใต้ `src/routes/`
