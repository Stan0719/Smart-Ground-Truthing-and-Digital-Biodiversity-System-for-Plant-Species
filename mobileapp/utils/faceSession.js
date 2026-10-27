import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { faceApi, normalizeFaceUrl, validFaceUser } from "./faceApi";
import { createFaceSessionManager } from "./faceSessionLifecycle";
const backend = normalizeFaceUrl((process.env.EXPO_PUBLIC_AUTH_API_URL||process.env.EXPO_PUBLIC_FACE_API_URL)?.trim());
let memoryOnly = null;
const supported = async () => Platform.OS !== "web" && await SecureStore.isAvailableAsync();
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export const faceSession = createFaceSessionManager({
  backend,
  api: faceApi,
  validUser: validFaceUser,
  authorizeOffline:async()=>Platform.OS!=="web"&&(await LocalAuthentication.authenticateAsync({promptMessage:"Unlock private offline drafts",disableDeviceFallback:false})).success,
  storage: {
    async get(key) { return await supported() ? SecureStore.getItemAsync(key, options) : memoryOnly; },
    async set(key, value) {
      if (await supported()) await SecureStore.setItemAsync(key, value, options);
      else memoryOnly = value;
    },
    async remove(key) {
      memoryOnly = null;
      if (await supported()) await SecureStore.deleteItemAsync(key, options);
    },
  },
});
