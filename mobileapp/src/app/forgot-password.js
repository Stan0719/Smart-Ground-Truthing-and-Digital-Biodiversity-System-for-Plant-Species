import React, { useRef } from 'react';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import recoveryHtml from '../../generated/recoveryHtml';
import { getVisitorAccounts, updateVisitorPassword } from '../../utils/visitorStorage';

const settings = {
  serviceId: process.env.EXPO_PUBLIC_EMAILJS_SERVICE_ID,
  templateId: process.env.EXPO_PUBLIC_EMAILJS_OTP_TEMPLATE_ID,
  publicKey: process.env.EXPO_PUBLIC_EMAILJS_PUBLIC_KEY,
};
const source = {
  html: recoveryHtml.replace('__OTP_SETTINGS__', JSON.stringify(settings).replace(/</g, '\\u003c')),
  baseUrl: 'https://localhost/',
};

export default function ForgotPassword() {
  const webView = useRef(null);
  async function onMessage(event) {
    let request;
    try {
      request = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (request.action === 'home') {
      router.dismissTo({ pathname: '/', params: { recoveryHome: String(Date.now()) } });
      return;
    }
    if (!Number.isInteger(request.id) || !Array.isArray(request.args)) return;
    const reply = { id: request.id };
    try {
      const [email, password] = request.args;
      if (typeof email !== 'string') throw new Error('Invalid account request.');
      if (request.action === 'find') {
        const accounts = await getVisitorAccounts();
        const user = accounts.find((account) => account.email?.trim().toLowerCase() === email.trim().toLowerCase() && account.status === 'Active' && account.role === 'Visitor');
        // Never send stored passwords into the WebView.
        reply.result = user ? { email: user.email, name: user.name } : null;
      } else if (request.action === 'update' && typeof password === 'string' && password.length >= 8) {
        reply.result = await updateVisitorPassword(email, password);
      } else {
        throw new Error('Invalid account request.');
      }
    } catch {
      reply.error = 'Account could not be updated. Please try again.';
    }
    webView.current?.injectJavaScript(`window.__recoveryReply(${JSON.stringify(reply).replace(/</g, '\\u003c')}); true;`);
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f3f6f2' }}>
      <WebView
        ref={webView}
        source={source}
        originWhitelist={['*']}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={({ url }) => url === 'about:blank' || url === 'https://localhost/'}
        javaScriptEnabled
        domStorageEnabled={false}
        style={{ flex: 1, backgroundColor: '#f3f6f2' }}
      />
    </SafeAreaView>
  );
}
