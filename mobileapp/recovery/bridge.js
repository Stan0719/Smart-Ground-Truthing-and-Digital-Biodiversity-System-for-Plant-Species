// Account persistence is the only platform-specific part of the shared page.
let nextId = 0;
const pending = new Map();
window.__recoveryReply = ({ id, result, error }) => {
  const request = pending.get(id);
  if (!request) return;
  clearTimeout(request.timer);
  pending.delete(id);
  if (error) request.reject(new Error(error));
  else request.resolve(result);
};
function request(action, args) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Account could not be updated. Please try again.'));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    window.ReactNativeWebView.postMessage(JSON.stringify({ id, action, args }));
  });
}
export const findPrototypeUserByEmail = (email) => request('find', [email]);
export const updatePrototypePassword = (email, password) => request('update', [email, password]);
