import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { 
  initDb, 
  seedSampleData, 
  getAppointments, 
  createAppointment, 
  getStats, 
  normalizePhone 
} from './db';
import { 
  dispatchDueReminders, 
  processInboundReply, 
  formatReminderMessage 
} from './reminder';
import { 
  isQontakConfigured, 
  getQontakConfig, 
  parseQontakInboundWebhook, 
  sendWhatsAppViaQontak 
} from './qontak';

const app = new Hono();
const db = initDb('reminder.sqlite');
seedSampleData(db);

app.use('*', logger());
app.use('*', cors());

// UI Dashboard
app.get('/', (c) => {
  const stats = getStats(db);
  const appointments = getAppointments(db);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defDate = tomorrow.toISOString().slice(0, 10);
  const qontakActive = isQontakConfigured();
  const qontakCfg = getQontakConfig();

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <title>SIMRS — Interactive Patient Reminder Bot (Two-Way WA)</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }
    pre, code, .font-mono { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col selection:bg-emerald-500 selection:text-white">
  <!-- Top Header -->
  <header class="bg-slate-900/90 border-b border-slate-800 sticky top-0 z-30 backdrop-blur-md">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <div class="w-8 h-8 rounded-xl bg-emerald-600 flex items-center justify-center text-white font-black text-sm shadow-md shadow-emerald-600/30">
          WA
        </div>
        <div>
          <span class="font-extrabold text-sm sm:text-base text-white tracking-tight block leading-tight">
            Patient Reminder Bot
          </span>
          <span class="text-[10px] text-slate-400 font-medium block">
            Two-Way WhatsApp Engine & SIMRS Antrean
          </span>
        </div>
      </div>
      <div class="flex items-center space-x-2">
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${qontakActive ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'}">
          <span class="w-1.5 h-1.5 rounded-full ${qontakActive ? 'bg-emerald-400 animate-pulse' : 'bg-cyan-400'}"></span>
          ${qontakActive ? 'Qontak API Online' : 'Qontak Driver Ready'}
        </span>
      </div>
    </div>
  </header>

  <main class="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
    <!-- KPI Metrics -->
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <div class="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl">
        <span class="text-[11px] text-slate-400 uppercase font-semibold">Total Pasien</span>
        <p class="text-2xl font-black text-white mt-1">${stats.total}</p>
      </div>
      <div class="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl">
        <span class="text-[11px] text-slate-400 uppercase font-semibold">Menunggu Kirim</span>
        <p class="text-2xl font-black text-slate-300 mt-1">${stats.pending}</p>
      </div>
      <div class="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl">
        <span class="text-[11px] text-cyan-400 uppercase font-semibold">Terkirim (Menunggu)</span>
        <p class="text-2xl font-black text-cyan-400 mt-1">${stats.sent}</p>
      </div>
      <div class="bg-slate-900 border border-emerald-900/50 p-3.5 rounded-2xl">
        <span class="text-[11px] text-emerald-400 uppercase font-semibold">Konfirmasi Hadir</span>
        <p class="text-2xl font-black text-emerald-400 mt-1">${stats.confirmed}</p>
      </div>
      <div class="bg-slate-900 border border-amber-900/50 p-3.5 rounded-2xl">
        <span class="text-[11px] text-amber-400 uppercase font-semibold">Reschedule</span>
        <p class="text-2xl font-black text-amber-400 mt-1">${stats.reschedule}</p>
      </div>
      <div class="bg-slate-900 border border-rose-900/50 p-3.5 rounded-2xl">
        <span class="text-[11px] text-rose-400 uppercase font-semibold">Batal</span>
        <p class="text-2xl font-black text-rose-400 mt-1">${stats.cancelled}</p>
      </div>
    </div>

    <!-- Action Section: Batch Dispatch & Interactive Simulator -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <!-- Batch Reminder Dispatcher -->
      <div class="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xs">
        <h2 class="text-sm font-bold text-white flex items-center gap-2 mb-1">
          <span>🚀</span> Kirim Reminder Batch (H-1)
        </h2>
        <p class="text-xs text-slate-400 mb-4">
          Pindai jadwal poli berstatus pending pada tanggal target, kirim format interaktif ke WhatsApp pasien.
        </p>

        <form id="dispatchForm" class="space-y-3">
          <div>
            <label class="block text-xs font-semibold text-slate-300 mb-1">Tanggal Kunjungan</label>
            <input type="date" id="targetDate" value="${defDate}" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono">
          </div>
          <button type="submit" class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-98 transition rounded-xl text-xs font-bold text-white shadow-sm flex items-center justify-center gap-1.5">
            <span>Kirim Blast Reminder</span>
          </button>
        </form>
        <div id="dispatchResult" class="mt-3 text-xs hidden p-2.5 rounded-xl border font-mono"></div>
      </div>

      <!-- Interactive Two-Way WA Simulator -->
      <div class="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xs">
        <h2 class="text-sm font-bold text-white flex items-center gap-2 mb-1">
          <span>📱</span> Simulator Balasan WhatsApp Dua-Arah (Pasien)
        </h2>
        <p class="text-xs text-slate-400 mb-4">
          Simulasikan respon pasien dari WhatsApp. Bot akan otomatis mengurai jawaban, mengupdate status antrean SIMRS, dan membalas konfirmasi.
        </p>

        <form id="replyForm" class="space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Pilih Nomor Pasien</label>
              <select id="simPhone" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono">
                ${appointments.map(a => `
                  <option value="${a.phone_number}">
                    ${a.patient_name} (${a.phone_number}) - [${a.reminder_status}]
                  </option>
                `).join('')}
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Pesan / Balasan Pasien</label>
              <input type="text" id="simText" placeholder="Contoh: 1 Hadir / 2 Reschedule / 3 Batal" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500" value="1">
            </div>
          </div>

          <!-- Quick Option Buttons -->
          <div class="flex flex-wrap gap-2 pt-1">
            <button type="button" onclick="setSim('1 Hadir')" class="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 text-[11px] font-semibold transition">
              1 (Hadir)
            </button>
            <button type="button" onclick="setSim('2 Reschedule')" class="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 text-[11px] font-semibold transition">
              2 (Reschedule)
            </button>
            <button type="button" onclick="setSim('3 Batal')" class="px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 text-[11px] font-semibold transition">
              3 (Batal)
            </button>
            <button type="button" onclick="setSim('Mohon maaf belum tahu')" class="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-[11px] font-semibold transition">
              Teks Acak (Invalid)
            </button>
          </div>

          <button type="submit" class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-98 transition rounded-xl text-xs font-bold text-white shadow-sm flex items-center justify-center gap-1.5">
            <span>Kirim Respon Pasien & Cek Respon Balasan Bot</span>
          </button>
        </form>

        <div id="simResult" class="mt-3 text-xs hidden p-3 rounded-xl border border-slate-700 bg-slate-950 font-mono whitespace-pre-wrap leading-relaxed"></div>
      </div>
    </div>

    <!-- Appointments Table -->
    <div class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xs">
      <div class="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="text-sm font-bold text-white">Daftar Jadwal Antrean Poliklinik</h3>
          <p class="text-xs text-slate-400">Sinkronisasi status konfirmasi langsung dari WhatsApp ke SIMRS</p>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="location.reload()" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition">
            🔄 Refresh
          </button>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-950/60 text-slate-400 uppercase font-semibold border-b border-slate-800">
            <tr>
              <th class="p-3.5">No RM / Antrean</th>
              <th class="p-3.5">Nama Pasien</th>
              <th class="p-3.5">WhatsApp</th>
              <th class="p-3.5">Poli & Dokter</th>
              <th class="p-3.5">Jadwal Kunjungan</th>
              <th class="p-3.5">Status Konfirmasi</th>
              <th class="p-3.5 text-right">Balasan Pasien</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/60 text-slate-300">
            ${appointments.map(a => {
              let badge = 'bg-slate-800 text-slate-300 border-slate-700';
              let label = 'Pending';
              if (a.reminder_status === 'sent') {
                badge = 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30';
                label = 'Terkirim';
              } else if (a.reminder_status === 'confirmed') {
                badge = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-bold';
                label = '✓ Hadir';
              } else if (a.reminder_status === 'reschedule_requested') {
                badge = 'bg-amber-500/10 text-amber-400 border-amber-500/30 font-bold';
                label = '🔄 Reschedule';
              } else if (a.reminder_status === 'cancelled') {
                badge = 'bg-rose-500/10 text-rose-400 border-rose-500/30 font-bold';
                label = '✕ Batal';
              }

              return `
                <tr class="hover:bg-slate-800/40 transition">
                  <td class="p-3.5 font-mono">
                    <span class="text-white font-bold">${a.queue_number}</span>
                    <span class="text-[11px] text-slate-500 block">${a.patient_mrn}</span>
                  </td>
                  <td class="p-3.5 font-semibold text-white">${a.patient_name}</td>
                  <td class="p-3.5 font-mono text-slate-400">${a.phone_number}</td>
                  <td class="p-3.5">
                    <span class="text-slate-200 block">${a.clinic_name}</span>
                    <span class="text-[11px] text-slate-500 block">${a.doctor_name}</span>
                  </td>
                  <td class="p-3.5 font-mono text-slate-400">
                    <span>${a.appointment_date}</span>
                    <span class="text-slate-500 text-[11px] block">${a.appointment_time} WIB</span>
                  </td>
                  <td class="p-3.5">
                    <span class="px-2.5 py-1 rounded-full text-[11px] border ${badge}">
                      ${label}
                    </span>
                  </td>
                  <td class="p-3.5 text-right font-mono text-[11px] text-slate-400">
                    ${a.patient_reply_text ? `"${a.patient_reply_text}"` : '-'}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <footer class="bg-slate-900 border-t border-slate-800 py-4 text-center text-xs text-slate-500">
    <span>Interactive Two-Way WhatsApp Patient Reminder Bot • Bun + Hono + SQLite</span>
  </footer>

  <script>
    function setSim(txt) {
      document.getElementById('simText').value = txt;
    }

    document.getElementById('dispatchForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const date = document.getElementById('targetDate').value;
      const resEl = document.getElementById('dispatchResult');
      resEl.className = 'mt-3 text-xs p-2.5 rounded-xl border bg-slate-950 text-slate-300 border-slate-800 block';
      resEl.innerText = 'Mengirim reminder...';

      try {
        const res = await fetch('/api/reminders/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date })
        });
        const data = await res.json();
        resEl.className = 'mt-3 text-xs p-2.5 rounded-xl border bg-emerald-950/40 text-emerald-300 border-emerald-800/40 block';
        resEl.innerText = 'Sukses: ' + data.sent + ' reminder terkirim dari ' + data.total + ' pasien.';
        setTimeout(() => location.reload(), 1200);
      } catch (err) {
        resEl.className = 'mt-3 text-xs p-2.5 rounded-xl border bg-rose-950/40 text-rose-300 border-rose-800/40 block';
        resEl.innerText = 'Error: ' + err.message;
      }
    });

    document.getElementById('replyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = document.getElementById('simPhone').value;
      const text = document.getElementById('simText').value;
      const resEl = document.getElementById('simResult');
      resEl.classList.remove('hidden');
      resEl.innerText = 'Memproses respon...';

      try {
        const res = await fetch('/api/webhook/incoming', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: phone, text })
        });
        const data = await res.json();
        resEl.innerHTML = '<span class="text-emerald-400 font-bold">[Status Intent: ' + data.intent + ']</span>\\n\\n' +
          '<span class="text-slate-400">Pesan Balasan Otomatis Bot:</span>\\n' + data.responseText;
        setTimeout(() => location.reload(), 2500);
      } catch (err) {
        resEl.innerText = 'Error: ' + err.message;
      }
    });
  </script>
</body>
</html>`;

  return c.html(html);
});

// REST API: List appointments
app.get('/api/appointments', (c) => {
  const status = c.req.query('status');
  return c.json(getAppointments(db, status));
});

// REST API: Stats
app.get('/api/stats', (c) => {
  return c.json(getStats(db));
});

// REST API: Create Appointment
app.post('/api/appointments', async (c) => {
  const body = await c.req.json();
  const created = createAppointment(db, body);
  return c.json(created, 201);
});

// REST API: Dispatch due reminders
app.post('/api/reminders/dispatch', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const targetDate = body.date || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const result = await dispatchDueReminders(db, targetDate);
  return c.json(result);
});

// REST API: Inbound WhatsApp Webhook (Baileys / Gateway compatible)
app.post('/api/webhook/incoming', async (c) => {
  const body = await c.req.json();
  const phone = body.from || body.phone || body.sender || '';
  const text = body.text || body.message || body.body || '';

  if (!phone || !text) {
    return c.json({ error: 'Field from/phone and text/message are required' }, 400);
  }

  const result = await processInboundReply(db, phone, text);
  return c.json(result);
});

// REST API: Inbound WhatsApp Webhook khusus Mekari Qontak
app.post('/api/webhook/qontak', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = parseQontakInboundWebhook(body);
  if (!parsed) {
    return c.json({ error: 'Unrecognized Qontak webhook payload structure' }, 400);
  }

  const result = await processInboundReply(db, parsed.phone, parsed.text);
  return c.json({
    status: 'success',
    channel: 'qontak',
    parsed_sender: parsed.phone,
    sender_name: parsed.senderName || null,
    result
  });
});

// REST API: Status Konfigurasi Qontak
app.get('/api/qontak/status', (c) => {
  const cfg = getQontakConfig();
  return c.json({
    configured: isQontakConfigured(),
    baseUrl: cfg.baseUrl,
    hasToken: Boolean(cfg.token),
    channelIntegrationId: cfg.channelIntegrationId || null,
    templateId: cfg.templateId || null,
    webhookUrl: `http://208.76.40.125:${PORT}/api/webhook/qontak`
  });
});

const PORT = Number(process.env.PORT || 3003);

export default {
  port: PORT,
  hostname: '0.0.0.0',
  fetch: app.fetch,
};
