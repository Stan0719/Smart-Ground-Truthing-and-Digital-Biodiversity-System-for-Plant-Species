// Publish only the identity returned by authenticated /me, never the scan's profile.
export async function completeFaceLogin({ result, session, onLogin, navigation, diagnostic }) {
  const reference = result.requestId;
  diagnostic("session_verification_started", reference);
  const user = await session.establish(result);
  diagnostic("session_verification_passed", reference);
  if (onLogin) onLogin(user, { reference });
  else navigation.replace("MainTabs", { screen: user.role === "botanist" ? "AccountTab" : "HomeTab" });
  diagnostic("navigation_dispatched", reference);
  return user;
}
