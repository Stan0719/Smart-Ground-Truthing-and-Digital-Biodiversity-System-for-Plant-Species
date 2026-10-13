// These operations never fall back to one another. Request state is memory-only.
export const FACE_CAPTURE_VERSION = 'face-routing-v2';
export function createFaceCameraController({ reference, onChange, clearMessages, diagnostic }) {
  let current = null;
  const open = (mode, fields = {}) => {
    if (current) throw new Error('Close the current camera before starting another operation.');
    clearMessages();
    current = Object.freeze({ ...fields, mode, id: reference() });
    diagnostic('camera_opened', current.id, { mode, flowVersion: FACE_CAPTURE_VERSION });
    onChange(current);
    return current;
  };
  return {
    openLogin: () => open('recognize'),
    openEnrollment: ({ token, user, legacyProof }) => {
      if (!/^[a-f0-9]{64}$/.test(token || '') || !user?.id || !user?.email) throw new Error('Authenticated enrollment account is required.');
      return open('enroll', { token, userId: user.id, email: user.email,
        ...(legacyProof ? { legacyProof: Object.freeze({ ...legacyProof }) } : {}) });
    },
    isCurrent: id => current?.id === id,
    finish: id => {
      if (!current || current.id !== id) return null;
      const finished = current;
      current = null;
      onChange(null);
      return finished;
    },
    reset: () => { current = null; clearMessages(); onChange(null); },
  };
}

export async function runFaceCapture({ request, api, capture, validateSession, reference,
  isActive, stage, diagnostic, consent = false }) {
  if (!request || !['recognize', 'enroll'].includes(request.mode)) throw new Error('Invalid camera operation. Close and reopen the camera.');
  const enrollment = request.mode === 'enroll';
  if (enrollment && (consent !== true || !/^[a-f0-9]{64}$/.test(request.token || '') || !request.userId || !request.email)) {
    throw new Error('Face registration requires an authenticated account and explicit consent.');
  }
  if (!isActive()) return null;
  stage('Connecting to face recognition server…');
  const health = await api('/health', {}, undefined, 'GET', reference);
  if (!isActive()) return null;
  if (health.ready !== true) throw new Error('Face or account service is not ready. Check its health status.');
  let challenge;
  if (enrollment) {
    const authenticated = await api('/me', {}, request.token, 'POST', reference);
    if (!isActive()) return null;
    validateSession({ token: request.token, user: authenticated.user });
    if (authenticated.user.id !== request.userId || authenticated.user.email !== request.email) throw new Error('Enrollment session belongs to a different account.');
  } else {
    const result = await api('/challenge', {}, undefined, 'POST', reference);
    if (!isActive()) return null;
    if (!/^[a-f0-9]{64}$/.test(result.challenge || '')) throw new Error('Invalid face challenge. Retry Face Login.');
    challenge = result.challenge;
  }
  stage('Capturing photo…');
  const photo = await capture();
  if (!isActive()) return null;
  if (!photo?.base64 || !Number.isFinite(photo.width) || !Number.isFinite(photo.height) || photo.width < 64 || photo.height < 64) throw new Error('Camera did not return a valid photo. Reopen the camera.');
  if (photo.base64.length > 2800000) throw new Error('Captured photo is too large. Close the camera and retry.');
  stage('Scanning and processing face…');
  // Explicit branches: no default operation can reach /enroll.
  if (enrollment) {
    const endpoint = request.legacyProof ? '/legacy-reenroll' : '/enroll';
    diagnostic('capture_endpoint_selected', reference, { mode: 'enroll', endpoint, flowVersion: FACE_CAPTURE_VERSION });
    const result = await api(endpoint, { ...request.legacyProof, image: photo.base64, consent: true }, request.token, 'POST', reference);
    if (!isActive()) return null;
    if (result.enrolled !== true || result.user?.id !== request.userId || result.user?.email !== request.email) throw new Error('Backend did not confirm registration for this account.');
    return result;
  }
  diagnostic('capture_endpoint_selected', reference, { mode: 'recognize', endpoint: '/face-login', flowVersion: FACE_CAPTURE_VERSION });
  const result = await api('/face-login', { image: photo.base64, challenge }, undefined, 'POST', reference);
  if (!isActive()) return null;
  validateSession(result);
  return result;
}
