import { Appointment, normalizePhone } from './db';

export interface QontakConfig {
  baseUrl: string;
  token: string;
  channelIntegrationId: string;
  templateId: string;
}

export function getQontakConfig(): QontakConfig {
  return {
    baseUrl: process.env.QONTAK_BASE_URL || 'https://service-chat.qontak.com/api/open/v1',
    token: process.env.QONTAK_TOKEN || '',
    channelIntegrationId: process.env.QONTAK_CHANNEL_INTEGRATION_ID || '',
    templateId: process.env.QONTAK_TEMPLATE_ID || '',
  };
}

export function isQontakConfigured(): boolean {
  const cfg = getQontakConfig();
  return Boolean(cfg.token && cfg.channelIntegrationId);
}

export interface QontakBroadcastPayload {
  to_number: string;
  to_name: string;
  message_template_id: string;
  channel_integration_id: string;
  language: {
    code: string;
  };
  parameters: {
    body: Array<{
      key: string;
      value: string;
      value_text: string;
    }>;
  };
}

export function buildQontakReminderPayload(
  apt: Appointment,
  cfg: QontakConfig = getQontakConfig()
): QontakBroadcastPayload {
  const normPhone = normalizePhone(apt.phone_number);

  return {
    to_number: normPhone,
    to_name: apt.patient_name,
    message_template_id: cfg.templateId || 'qontak-hsm-patient-reminder',
    channel_integration_id: cfg.channelIntegrationId,
    language: {
      code: 'id'
    },
    parameters: {
      body: [
        { key: '1', value: 'patient_name', value_text: apt.patient_name },
        { key: '2', value: 'clinic_name', value_text: apt.clinic_name },
        { key: '3', value: 'doctor_name', value_text: apt.doctor_name },
        { key: '4', value: 'appointment_schedule', value_text: `${apt.appointment_date} jam ${apt.appointment_time} WIB` },
        { key: '5', value: 'queue_number', value_text: apt.queue_number }
      ]
    }
  };
}

export async function sendWhatsAppViaQontak(
  apt: Appointment,
  customFetch: typeof fetch = fetch
): Promise<{ success: boolean; data?: any; error?: string; dryRun?: boolean }> {
  const cfg = getQontakConfig();
  const payload = buildQontakReminderPayload(apt, cfg);

  if (!isQontakConfigured()) {
    console.log(`[QONTAK DRY-RUN] Token/Channel belum disetel. Payload tersimulasi untuk ${payload.to_number} (${apt.patient_name})`);
    return {
      success: true,
      dryRun: true,
      data: {
        status: 'simulated_success',
        to: payload.to_number,
        message: 'Qontak API credentials not set. Simulated broadcast OK.'
      }
    };
  }

  try {
    const url = `${cfg.baseUrl}/broadcasts/whatsapp/direct`;
    const res = await customFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.token}`
      },
      body: JSON.stringify(payload)
    });

    const resJson = await res.json();
    if (!res.ok) {
      return {
        success: false,
        error: resJson.error?.message || resJson.message || `HTTP ${res.status}`
      };
    }

    return {
      success: true,
      data: resJson
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message
    };
  }
}

export function parseQontakInboundWebhook(body: any): { phone: string; text: string; senderName?: string } | null {
  if (!body) return null;

  // Pattern 1: Qontak standard event payload (event: message:created / incoming)
  if (body.data?.sender || body.data?.text) {
    const phone = body.data.sender?.phone_number || body.data.phone_number || '';
    const text = body.data.text || body.data.message || '';
    const senderName = body.data.sender?.name || '';
    if (phone && text) return { phone: normalizePhone(phone), text, senderName };
  }

  // Pattern 2: Direct sender object
  if (body.sender && (body.text || body.message)) {
    const phone = body.sender.phone_number || body.sender.phone || '';
    const text = body.text || body.message || '';
    const senderName = body.sender.name || '';
    if (phone && text) return { phone: normalizePhone(phone), text, senderName };
  }

  // Pattern 3: Flat structure
  const phone = body.phone_number || body.from || body.phone || '';
  const text = body.text || body.message || body.body || '';
  if (phone && text) {
    return { phone: normalizePhone(phone), text, senderName: body.name };
  }

  return null;
}
