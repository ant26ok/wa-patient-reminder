import { Database } from 'bun:sqlite';

export interface Appointment {
  id: number;
  patient_mrn: string;
  patient_name: string;
  phone_number: string;
  doctor_name: string;
  clinic_name: string;
  appointment_date: string;
  appointment_time: string;
  queue_number: string;
  reminder_status: 'pending' | 'sent' | 'confirmed' | 'reschedule_requested' | 'cancelled';
  reminder_sent_at: string | null;
  confirmed_at: string | null;
  patient_reply_text: string | null;
  notes: string | null;
  created_at: string;
}

export interface MessageLog {
  id: number;
  appointment_id: number | null;
  direction: 'outbound' | 'inbound';
  phone_number: string;
  message_body: string;
  created_at: string;
}

export function normalizePhone(raw: string): string {
  let cleaned = raw.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.slice(1);
  } else if (cleaned.startsWith('8')) {
    cleaned = '62' + cleaned;
  }
  return cleaned;
}

export function initDb(dbPath: string = 'reminder.sqlite'): Database {
  const db = new Database(dbPath);
  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA foreign_keys = ON;');

  db.run(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_mrn TEXT NOT NULL,
      patient_name TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      doctor_name TEXT NOT NULL,
      clinic_name TEXT NOT NULL,
      appointment_date TEXT NOT NULL,
      appointment_time TEXT NOT NULL,
      queue_number TEXT NOT NULL,
      reminder_status TEXT NOT NULL DEFAULT 'pending',
      reminder_sent_at TEXT,
      confirmed_at TEXT,
      patient_reply_text TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_appointments_phone ON appointments(phone_number);
    CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date, reminder_status);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS message_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER,
      direction TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      message_body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY(appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
    );
  `);

  return db;
}

export function createAppointment(
  db: Database,
  data: {
    patient_mrn: string;
    patient_name: string;
    phone_number: string;
    doctor_name: string;
    clinic_name: string;
    appointment_date: string;
    appointment_time: string;
    queue_number: string;
    notes?: string;
  }
): Appointment {
  const phone = normalizePhone(data.phone_number);
  const query = db.query(`
    INSERT INTO appointments (
      patient_mrn, patient_name, phone_number, doctor_name, clinic_name,
      appointment_date, appointment_time, queue_number, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *;
  `);

  return query.get(
    data.patient_mrn,
    data.patient_name,
    phone,
    data.doctor_name,
    data.clinic_name,
    data.appointment_date,
    data.appointment_time,
    data.queue_number,
    data.notes || null
  ) as Appointment;
}

export function getDueAppointments(db: Database, targetDate: string): Appointment[] {
  return db.query(`
    SELECT * FROM appointments 
    WHERE appointment_date = ? AND reminder_status = 'pending'
    ORDER BY appointment_time ASC;
  `).all(targetDate) as Appointment[];
}

export function updateReminderSent(db: Database, id: number): void {
  db.run(`
    UPDATE appointments 
    SET reminder_status = 'sent', reminder_sent_at = datetime('now', 'localtime')
    WHERE id = ?;
  `, [id]);
}

export function logMessage(
  db: Database,
  appointmentId: number | null,
  direction: 'outbound' | 'inbound',
  phone: string,
  body: string
): void {
  db.run(`
    INSERT INTO message_logs (appointment_id, direction, phone_number, message_body)
    VALUES (?, ?, ?, ?);
  `, [appointmentId, direction, normalizePhone(phone), body]);
}

export function findActiveAppointmentForPhone(db: Database, phone: string): Appointment | null {
  const norm = normalizePhone(phone);
  // Find the latest appointment that has received a reminder or is upcoming
  return db.query(`
    SELECT * FROM appointments
    WHERE phone_number = ? AND reminder_status IN ('sent', 'pending')
    ORDER BY appointment_date DESC, id DESC
    LIMIT 1;
  `).get(norm) as Appointment | null;
}

export function updateAppointmentStatus(
  db: Database,
  id: number,
  status: 'confirmed' | 'reschedule_requested' | 'cancelled',
  rawReply: string
): Appointment {
  return db.query(`
    UPDATE appointments
    SET reminder_status = ?,
        confirmed_at = datetime('now', 'localtime'),
        patient_reply_text = ?
    WHERE id = ?
    RETURNING *;
  `).get(status, rawReply, id) as Appointment;
}

export function getAppointments(db: Database, status?: string): Appointment[] {
  if (status && status !== 'all') {
    return db.query(`
      SELECT * FROM appointments 
      WHERE reminder_status = ?
      ORDER BY appointment_date DESC, appointment_time ASC;
    `).all(status) as Appointment[];
  }
  return db.query(`
    SELECT * FROM appointments 
    ORDER BY appointment_date DESC, appointment_time ASC;
  `).all() as Appointment[];
}

export function getStats(db: Database) {
  const rows = db.query(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN reminder_status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN reminder_status = 'sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN reminder_status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
      SUM(CASE WHEN reminder_status = 'reschedule_requested' THEN 1 ELSE 0 END) as reschedule,
      SUM(CASE WHEN reminder_status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
    FROM appointments;
  `).get() as any;

  return {
    total: rows?.total || 0,
    pending: rows?.pending || 0,
    sent: rows?.sent || 0,
    confirmed: rows?.confirmed || 0,
    reschedule: rows?.reschedule || 0,
    cancelled: rows?.cancelled || 0,
  };
}

export function seedSampleData(db: Database): void {
  const count = (db.query('SELECT COUNT(*) as c FROM appointments;').get() as any).c;
  if (count > 0) return;

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const tStr = tomorrow.toISOString().slice(0, 10);

  const samples = [
    {
      mrn: 'RM-2026-081',
      name: 'Bpk. Budi Santoso',
      phone: '081234567890',
      doctor: 'dr. Hendro Sp.PD',
      clinic: 'Poli Penyakit Dalam',
      date: tStr,
      time: '08:30',
      queue: 'A-04'
    },
    {
      mrn: 'RM-2026-094',
      name: 'Ibu Siti Rahayu',
      phone: '085678901234',
      doctor: 'dr. Maya Sp.JP',
      clinic: 'Poli Jantung & Pembuluh Darah',
      date: tStr,
      time: '09:15',
      queue: 'B-02'
    },
    {
      mrn: 'RM-2026-112',
      name: 'Bpk. Joko Widodo',
      phone: '081987654321',
      doctor: 'dr. Agus Sp.M',
      clinic: 'Poli Mata',
      date: tStr,
      time: '10:00',
      queue: 'C-08'
    },
    {
      mrn: 'RM-2026-125',
      name: 'Ibu Maria Ulfah',
      phone: '087712345678',
      doctor: 'dr. Bambang Sp.S',
      clinic: 'Poli Saraf',
      date: tStr,
      time: '10:45',
      queue: 'D-05'
    }
  ];

  for (const s of samples) {
    createAppointment(db, {
      patient_mrn: s.mrn,
      patient_name: s.name,
      phone_number: s.phone,
      doctor_name: s.doctor,
      clinic_name: s.clinic,
      appointment_date: s.date,
      appointment_time: s.time,
      queue_number: s.queue
    });
  }
}
