import assert from 'node:assert';
import { 
  initDb, 
  normalizePhone, 
  createAppointment, 
  getAppointments, 
  getStats 
} from './db';
import { 
  parsePatientReply, 
  formatReminderMessage, 
  formatAutoResponse, 
  processInboundReply, 
  dispatchDueReminders 
} from './reminder';
import { 
  buildQontakReminderPayload, 
  sendWhatsAppViaQontak, 
  parseQontakInboundWebhook 
} from './qontak';

console.log('=== TEST: TWO-WAY WHATSAPP PATIENT REMINDER BOT ===');

// 1. Test Phone Normalization
assert.strictEqual(normalizePhone('081234567890'), '6281234567890');
assert.strictEqual(normalizePhone('+62 856-7890-1234'), '6285678901234');
assert.strictEqual(normalizePhone('81987654321'), '6281987654321');
console.log('✓ Phone normalization passed');

// 2. Test DB Initialization
const db = initDb(':memory:');
console.log('✓ In-memory database initialized');

// 3. Test Create Appointment
const apt1 = createAppointment(db, {
  patient_mrn: 'RM-001',
  patient_name: 'Budi Santoso',
  phone_number: '081234567890',
  doctor_name: 'dr. Hendro Sp.PD',
  clinic_name: 'Poli Penyakit Dalam',
  appointment_date: '2026-10-10',
  appointment_time: '08:30',
  queue_number: 'A-01'
});

assert.strictEqual(apt1.id, 1);
assert.strictEqual(apt1.phone_number, '6281234567890');
assert.strictEqual(apt1.reminder_status, 'pending');
console.log('✓ Appointment creation passed');

// 4. Test Reminder Dispatching
const msg = formatReminderMessage(apt1);
assert(msg.includes('Budi Santoso'));
assert(msg.includes('Poli Penyakit Dalam'));
assert(msg.includes('*1* - HADIR'));
console.log('✓ Format reminder message passed');

const dispatchRes = await dispatchDueReminders(db, '2026-10-10');
assert.strictEqual(dispatchRes.total, 1);
assert.strictEqual(dispatchRes.sent, 1);

const refreshedApt1 = getAppointments(db).find(a => a.id === 1);
assert.strictEqual(refreshedApt1?.reminder_status, 'sent');
console.log('✓ Dispatch due reminders passed');

// 5. Test Inbound Reply Parser
assert.strictEqual(parsePatientReply('1'), 'confirmed');
assert.strictEqual(parsePatientReply('Hadir'), 'confirmed');
assert.strictEqual(parsePatientReply('2'), 'reschedule_requested');
assert.strictEqual(parsePatientReply('minta jadwal ulang'), 'reschedule_requested');
assert.strictEqual(parsePatientReply('3'), 'cancelled');
assert.strictEqual(parsePatientReply('batal periksa'), 'cancelled');
assert.strictEqual(parsePatientReply('halo selamat pagi'), 'unknown');
console.log('✓ Reply intent parser passed');

// 6. Test Two-Way Interactive Confirmation (Patient replies "1")
const replyRes1 = await processInboundReply(db, '081234567890', '1 Hadir');
assert.strictEqual(replyRes1.success, true);
assert.strictEqual(replyRes1.intent, 'confirmed');
assert.strictEqual(replyRes1.appointment?.reminder_status, 'confirmed');
assert(replyRes1.responseText.includes('KONFIRMASI DITERIMA'));
console.log('✓ Inbound reply confirmation (Hadir) passed');

// 7. Test Two-Way Reschedule (Patient 2 replies "2")
const apt2 = createAppointment(db, {
  patient_mrn: 'RM-002',
  patient_name: 'Siti Rahayu',
  phone_number: '085678901234',
  doctor_name: 'dr. Maya Sp.JP',
  clinic_name: 'Poli Jantung',
  appointment_date: '2026-10-10',
  appointment_time: '09:00',
  queue_number: 'B-01'
});
await dispatchDueReminders(db, '2026-10-10');

const replyRes2 = await processInboundReply(db, '085678901234', 'Mohon reschedule dokter');
assert.strictEqual(replyRes2.success, true);
assert.strictEqual(replyRes2.intent, 'reschedule_requested');
assert.strictEqual(replyRes2.appointment?.reminder_status, 'reschedule_requested');
assert(replyRes2.responseText.includes('RESCHEDULE DICATAT'));
console.log('✓ Inbound reply reschedule passed');

// 8. Test Two-Way Cancellation (Patient 3 replies "3")
const apt3 = createAppointment(db, {
  patient_mrn: 'RM-003',
  patient_name: 'Joko Widodo',
  phone_number: '081987654321',
  doctor_name: 'dr. Agus Sp.M',
  clinic_name: 'Poli Mata',
  appointment_date: '2026-10-10',
  appointment_time: '10:00',
  queue_number: 'C-01'
});
await dispatchDueReminders(db, '2026-10-10');

const replyRes3 = await processInboundReply(db, '081987654321', '3 Batal');
assert.strictEqual(replyRes3.success, true);
assert.strictEqual(replyRes3.intent, 'cancelled');
assert.strictEqual(replyRes3.appointment?.reminder_status, 'cancelled');
assert(replyRes3.responseText.includes('PEMBATALAN KUNJUNGAN DICATAT'));
console.log('✓ Inbound reply cancellation passed');

// 9. Test Invalid Reply on active pending appointment
const apt4 = createAppointment(db, {
  patient_mrn: 'RM-004',
  patient_name: 'Hendra Wijaya',
  phone_number: '088123456789',
  doctor_name: 'dr. Anton Sp.A',
  clinic_name: 'Poli Anak',
  appointment_date: '2026-10-10',
  appointment_time: '11:00',
  queue_number: 'E-01'
});
await dispatchDueReminders(db, '2026-10-10');

const replyResInvalid = await processInboundReply(db, '088123456789', 'apakah ada obat?');
assert.strictEqual(replyResInvalid.success, false);
assert.strictEqual(replyResInvalid.intent, 'unknown');
assert(replyResInvalid.responseText.includes('format balasan belum sesuai'));
console.log('✓ Inbound invalid reply handling passed');

// 10. Test Stats
const stats = getStats(db);
assert.strictEqual(stats.total, 4);
assert.strictEqual(stats.confirmed, 1);
assert.strictEqual(stats.reschedule, 1);
assert.strictEqual(stats.cancelled, 1);
assert.strictEqual(stats.sent, 1);
console.log('✓ System stats aggregation passed:', stats);

// 11. Test Qontak Reminder Payload Builder
const qPayload = buildQontakReminderPayload(apt1, {
  baseUrl: 'https://service-chat.qontak.com/api/open/v1',
  token: 'mock-token',
  channelIntegrationId: 'chan-123',
  templateId: 'tmpl-456'
});
assert.strictEqual(qPayload.to_number, '6281234567890');
assert.strictEqual(qPayload.channel_integration_id, 'chan-123');
assert.strictEqual(qPayload.message_template_id, 'tmpl-456');
assert.strictEqual(qPayload.parameters.body[0].value_text, 'Budi Santoso');
assert.strictEqual(qPayload.parameters.body[1].value_text, 'Poli Penyakit Dalam');
console.log('✓ Qontak broadcast payload builder passed');

// 12. Test Qontak Mock Sender
const mockFetch = (async (url: string, init: any) => {
  assert(url.includes('/broadcasts/whatsapp/direct'));
  assert.strictEqual(init.headers['Authorization'], 'Bearer mock-token');
  return new Response(JSON.stringify({
    status: 'success',
    data: { id: 'broadcast-001' }
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}) as unknown as typeof fetch;

// Temporarily set env for mock test
process.env.QONTAK_TOKEN = 'mock-token';
process.env.QONTAK_CHANNEL_INTEGRATION_ID = 'chan-123';
const sendRes = await sendWhatsAppViaQontak(apt1, mockFetch);
assert.strictEqual(sendRes.success, true);
assert.strictEqual(sendRes.data.data.id, 'broadcast-001');
delete process.env.QONTAK_TOKEN;
delete process.env.QONTAK_CHANNEL_INTEGRATION_ID;
console.log('✓ Qontak mock sender passed');

// 13. Test Qontak Inbound Webhook Parser
const parsed1 = parseQontakInboundWebhook({
  event: 'message:created',
  data: {
    sender: { phone_number: '081234567890', name: 'Budi Santoso' },
    text: '1 Hadir'
  }
});
assert.strictEqual(parsed1?.phone, '6281234567890');
assert.strictEqual(parsed1?.text, '1 Hadir');
assert.strictEqual(parsed1?.senderName, 'Budi Santoso');

const parsed2 = parseQontakInboundWebhook({
  phone_number: '085678901234',
  message: '2 Reschedule'
});
assert.strictEqual(parsed2?.phone, '6285678901234');
assert.strictEqual(parsed2?.text, '2 Reschedule');
console.log('✓ Qontak inbound webhook parser passed');

console.log('=== ALL 13 TEST SUITES PASSED SUCCESSFULLY ===');
