import { Database } from 'bun:sqlite';
import { 
  Appointment, 
  getDueAppointments, 
  updateReminderSent, 
  logMessage, 
  findActiveAppointmentForPhone, 
  updateAppointmentStatus 
} from './db';

export type ParsedIntent = 'confirmed' | 'reschedule_requested' | 'cancelled' | 'unknown';

export function formatReminderMessage(apt: Appointment): string {
  return `Halo Bpk/Ibu *${apt.patient_name}*,\n\n` +
    `Kami mengonfirmasi jadwal kunjungan pemeriksaan Anda:\n` +
    `🏥 Poli: *${apt.clinic_name}*\n` +
    `👨‍⚕️ Dokter: *${apt.doctor_name}*\n` +
    `📅 Tanggal: *${apt.appointment_date}*\n` +
    `⏰ Jam: *${apt.appointment_time} WIB*\n` +
    `🔢 No Antrean: *${apt.queue_number}*\n` +
    `📋 No RM: *${apt.patient_mrn}*\n\n` +
    `Mohon balas pesan ini dengan memilih salah satu nomor:\n` +
    `*1* - HADIR (Konfirmasi kedatangan)\n` +
    `*2* - RESCHEDULE (Minta ganti jadwal/hari lain)\n` +
    `*3* - BATAL (Tidak dapat hadir)\n\n` +
    `_Pesan otomatis Sistem Informasi Rekam Medis faskes._`;
}

export function parsePatientReply(raw: string): ParsedIntent {
  const text = raw.trim().toLowerCase();

  // Pattern matching for Option 1: Hadir
  if (
    text === '1' ||
    text.startsWith('1 ') ||
    text.includes('hadir') ||
    text.includes('datang') ||
    text.includes('konfirmasi') ||
    text === 'ya' ||
    text === 'ok' ||
    text === 'bisa'
  ) {
    return 'confirmed';
  }

  // Pattern matching for Option 2: Reschedule
  if (
    text === '2' ||
    text.startsWith('2 ') ||
    text.includes('reschedule') ||
    text.includes('jadwal ulang') ||
    text.includes('ganti') ||
    text.includes('tunda') ||
    text.includes('undur') ||
    text.includes('geser')
  ) {
    return 'reschedule_requested';
  }

  // Pattern matching for Option 3: Batal
  if (
    text === '3' ||
    text.startsWith('3 ') ||
    text.includes('batal') ||
    text.includes('cancel') ||
    text.includes('tidak bisa') ||
    text.includes('berhalangan')
  ) {
    return 'cancelled';
  }

  return 'unknown';
}

export function formatAutoResponse(apt: Appointment | null, intent: ParsedIntent): string {
  if (!apt) {
    return `Halo, nomor Anda belum terdaftar pada jadwal antrean poli aktif faskes untuk hari ini. Silakan hubungi bagian pendaftaran untuk informasi lebih lanjut.`;
  }

  switch (intent) {
    case 'confirmed':
      return `✅ *KONFIRMASI DITERIMA*\n\n` +
        `Terima kasih Bpk/Ibu *${apt.patient_name}*.\n` +
        `Kedatangan Anda untuk kunjungan di *${apt.clinic_name}* (*${apt.appointment_date}*, jam *${apt.appointment_time} WIB*) telah kami tandai: *HADIR*.\n\n` +
        `Silakan tiba 15 menit sebelum waktu periksa dan scan barcode di mesin antrean mandiri dengan No RM: *${apt.patient_mrn}*. Semoga lekas sembuh.`;

    case 'reschedule_requested':
      return `🔄 *PERMINTAAN RESCHEDULE DICATAT*\n\n` +
        `Permintaan perubahan jadwal pemeriksaan di *${apt.clinic_name}* atas nama Bpk/Ibu *${apt.patient_name}* telah kami teruskan ke petugas admisi poliklinik.\n\n` +
        `Petugas kami akan segera menghubungi Anda untuk pemilihan alternatif hari & jadwal dokter yang tersedia. Terima kasih.`;

    case 'cancelled':
      return `❌ *PEMBATALAN KUNJUNGAN DICATAT*\n\n` +
        `Jadwal pemeriksaan di *${apt.clinic_name}* (*${apt.appointment_date}*) atas nama Bpk/Ibu *${apt.patient_name}* telah dibatalkan dari antrean.\n\n` +
        `Jika di kemudian hari ingin mendaftar kembali, Anda dapat menghubungi layanan pendaftaran faskes. Terima kasih atas konfirmasinya.`;

    case 'unknown':
    default:
      return `Mohon maaf, format balasan belum sesuai.\n\n` +
        `Silakan balas dengan angka:\n` +
        `*1* untuk HADIR\n` +
        `*2* untuk RESCHEDULE\n` +
        `*3* untuk BATAL`;
  }
}

export async function processInboundReply(
  db: Database,
  phone: string,
  replyText: string,
  sendReplyFn?: (phone: string, text: string) => Promise<boolean>
): Promise<{
  success: boolean;
  intent: ParsedIntent;
  appointment: Appointment | null;
  responseText: string;
}> {
  // 1. Log inbound message
  const apt = findActiveAppointmentForPhone(db, phone);
  logMessage(db, apt ? apt.id : null, 'inbound', phone, replyText);

  // 2. Determine intent
  const intent = parsePatientReply(replyText);

  // 3. Update appointment if intent recognized
  let updatedApt: Appointment | null = null;
  if (apt && intent !== 'unknown') {
    updatedApt = updateAppointmentStatus(db, apt.id, intent, replyText);
  } else {
    updatedApt = apt;
  }

  // 4. Generate automated reply
  const responseText = formatAutoResponse(updatedApt, intent);

  // 5. Log outbound response
  logMessage(db, updatedApt ? updatedApt.id : null, 'outbound', phone, responseText);

  // 6. Optional external sending hook
  if (sendReplyFn) {
    try {
      await sendReplyFn(phone, responseText);
    } catch (e) {
      console.error(`Failed to send WA reply to ${phone}:`, e);
    }
  }

  return {
    success: intent !== 'unknown',
    intent,
    appointment: updatedApt,
    responseText
  };
}

export async function dispatchDueReminders(
  db: Database,
  targetDate: string,
  senderFn?: (phone: string, text: string) => Promise<boolean>
): Promise<{ total: number; sent: number }> {
  const dues = getDueAppointments(db, targetDate);
  let sentCount = 0;

  for (const apt of dues) {
    const text = formatReminderMessage(apt);
    logMessage(db, apt.id, 'outbound', apt.phone_number, text);
    updateReminderSent(db, apt.id);
    sentCount++;

    if (senderFn) {
      try {
        await senderFn(apt.phone_number, text);
      } catch (e) {
        console.error(`Error sending reminder to ${apt.phone_number}:`, e);
      }
    }
  }

  return { total: dues.length, sent: sentCount };
}
