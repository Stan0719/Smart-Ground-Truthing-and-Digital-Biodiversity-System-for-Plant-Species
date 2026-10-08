export interface AccountEmailConfig {
  serviceId?: string
  templateId?: string
  publicKey?: string
  loginUrl?: string
}

export interface AccountEmailRecipient {
  name: string
  email: string
  role: string
  password: string
}

export async function sendTemporaryPasswordEmail(
  user: AccountEmailRecipient,
  config: AccountEmailConfig,
): Promise<void> {
  if (!config.serviceId || !config.templateId || !config.publicKey) {
    throw new Error('Email delivery is not configured. Ask the system administrator to configure EmailJS.')
  }

  let response: Response
  try {
    response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        service_id: config.serviceId,
        template_id: config.templateId,
        user_id: config.publicKey,
        template_params: {
          to_name: user.name,
          to_email: user.email,
          role: user.role,
          temporary_password: user.password,
          login_url: config.loginUrl ?? '',
        },
      }),
    })
  } catch {
    throw new Error('Email delivery could not be confirmed. Check your connection and try again; the email may already have been sent.')
  }

  if (!response.ok) {
    throw new Error(response.status === 429
      ? 'Email sending limit reached. Please wait before trying again.'
      : 'The email service rejected the request. Check the EmailJS configuration and try again.')
  }
}
