# WA Patient Reminder — Two-Way WhatsApp Outpatient Bot

Sistem konfirmasi kehadiran pasien rawat jalan poliklinik berbasis **WhatsApp Dua-Arah (Two-Way)** yang terintegrasi langsung dengan antrean SIMRS. 

Dibangun dengan **Bun**, **Hono**, dan **SQLite** untuk performa tinggi, hemat resource memori server, dan bebas dependensi berat.

---

## Masalah & Solusi

- **Masalah:** Pasien sering lupa jadwal kontrol atau tidak hadir tanpa konfirmasi, menyebabkan slot dokter terbuang dan antrean poli menumpuk.
- **Solusi:** Sistem otomatis mengirimkan reminder interaktif pada H-1:
  - Pasien balas `1`: Konfirmasi **Hadir** (otomatis tercatat di antrean SIMRS).
  - Pasien balas `2`: Konfirmasi **Reschedule** (notifikasi diteruskan ke admisi untuk opsi tanggal baru).
  - Pasien balas `3`: Konfirmasi **Batal** (slot antrean dilepaskan untuk pasien lain).

---

## Fitur Utama

1. **Pengiriman Reminder H-1 Batch**:
   - Deteksi otomatis jadwal pasien pending.
   - Normalisasi nomor telepon otomatis (`08xx`, `+628xx`, `628xx`).
2. **Pengenalan Maksud Pasien (Intent Parsing)**:
   - Memahami angka (`1`, `2`, `3`) maupun kata kunci alami (`Hadir`, `Jadwal ulang`, `Batal`).
   - Penanganan balasan tidak dikenal dengan instruksi panduan otomatis.
3. **Pencatatan Audit Trail & Log Pesan**:
   - Riwayat pesan keluar & masuk dicatat lengkap dengan timestamp.
4. **Dashboard SIMRS Interaktif**:
   - Visualisasi KPI real-time (Total, Menunggu Kirim, Hadir, Reschedule, Batal).
   - Simulator respon pasien langsung di antarmuka web.
5. **REST API & Webhook Gateway Ready**:
   - Kompatibel dengan Baileys, WhatsApp Business Cloud API, atau webhook gateway lokal.

---

## Tech Stack

- **Runtime:** Bun 1.4+
- **Web Framework:** Hono 4.x
- **Database:** SQLite (WAL mode, zero daemon)
- **Frontend:** HTML5 + Tailwind CSS (Responsive Desktop & Mobile)

---

## Cara Menjalankan

```bash
# 1. Jalankan unit & integration test
bun run test

# 2. Start server
bun run start
```

Akses dashboard pada: **`http://localhost:3003`**

---

## Endpoint REST API

| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `GET` | `/` | Web Dashboard & Simulator |
| `GET` | `/api/appointments` | Mengambil daftar jadwal antrean |
| `POST` | `/api/appointments` | Menambahkan jadwal kunjungan pasien baru |
| `POST` | `/api/reminders/dispatch` | Memicu pengiriman reminder batch H-1 |
| `POST` | `/api/webhook/incoming` | Webhook penerima pesan masuk WhatsApp umum |
| `POST` | `/api/webhook/qontak` | Webhook khusus integrasi resmi Mekari Qontak |
| `GET` | `/api/qontak/status` | Cek status konfigurasi API Qontak |
| `GET` | `/api/stats` | Statistik agregasi konfirmasi |

### Contoh Webhook Pesan Masuk (Inbound WA)

```bash
curl -X POST http://localhost:3003/api/webhook/incoming \
  -H "Content-Type: application/json" \
  -d '{"from": "081234567890", "text": "1 Hadir"}'
```

---

## Integrasi WhatsApp API Mekari Qontak

Sistem telah dilengkapi modul resmi Mekari Qontak (`/api/open/v1/broadcasts/whatsapp/direct`).

### 1. Konfigurasi Environment (`.env`)
Salin `.env.example` ke `.env`:
```bash
QONTAK_BASE_URL=https://service-chat.qontak.com/api/open/v1
QONTAK_TOKEN=your_qontak_bearer_token
QONTAK_CHANNEL_INTEGRATION_ID=your_channel_integration_id
QONTAK_TEMPLATE_ID=your_template_uuid
```

*Jika kredensial belum diisi, sistem berjalan dalam mode **Dry-Run** (simulasi log pengiriman).*

### 2. Pemasangan Webhook di Dashboard Qontak
Atur Webhook URL di dashboard Qontak ke:
```
http://208.76.40.125:3003/api/webhook/qontak
```
Setiap pasien membalas chat di WhatsApp, Qontak akan menembak webhook ini dan status antrean SIMRS langsung terupdate secara real-time.
