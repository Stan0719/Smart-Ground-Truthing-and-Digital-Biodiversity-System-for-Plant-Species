// No persistence or navigation: pending credentials stay in the login component's memory.
export async function changeFirstLoginPassword({ api, session, password, confirmation }) {
  if (!session?.token || session.user?.mustChangePassword !== true)
    throw new Error("Sign in again with your temporary password.");
  if (typeof password !== "string" || password.length < 15 || password.length > 128 || password !== confirmation)
    throw new Error("Use matching passwords with 15 to 128 characters.");
  const result = await api("/change-password", { password }, session.token);
  if (result?.changed !== true)
    throw new Error("The service did not confirm the password change. Sign in again to check your account.");
}
