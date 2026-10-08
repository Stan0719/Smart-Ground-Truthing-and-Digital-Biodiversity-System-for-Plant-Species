export async function sendOtpEmail(
  email: string,
  name: string,
  code: string,
): Promise<void> {
  const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID
  const templateId = import.meta.env.VITE_EMAILJS_OTP_TEMPLATE_ID
  const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY

  if (!serviceId || !templateId || !publicKey) {
    throw new Error('EmailJS OTP settings are missing in .env.local.')
  }

  let response: Response

  try {
    response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        service_id: serviceId,
        template_id: templateId,
        user_id: publicKey,
        template_params: {
          to_email: email,
          to_name: name,
          otp_code: code,
        },
      }),
    })
  } catch {
    throw new Error(
      'Sending could not be confirmed. Check your connection and try again.',
    )
  }

  if (!response.ok) {
    throw new Error('Email could not be sent. Check your EmailJS settings or quota.')
  }
}