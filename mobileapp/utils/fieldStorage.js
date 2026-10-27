import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import {
  AESEncryptionKey,
  AESSealedData,
  aesEncryptAsync,
  aesDecryptAsync,
} from "expo-crypto";
import { Paths } from "expo-file-system";
import { faceSession } from "./faceSession";
import { createDraftStore } from "./offlineDraftStore";
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
async function keyFor(id, create) {
  if (!(await SecureStore.isAvailableAsync()))
    throw Error("Encrypted drafts require secure storage on a native device.");
  const name = `niah.draft-key.${id.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  let hex = await SecureStore.getItemAsync(name, options);
  if (!hex) {
    if (!create)
      throw Error(
        "Draft encryption key is unavailable. No drafts were deleted.",
      );
    const key = await AESEncryptionKey.generate();
    hex = await key.encoded("hex");
    await SecureStore.setItemAsync(name, hex, options);
  }
  return AESEncryptionKey.import(hex, "hex");
}
const store = createDraftStore({
  storage: AsyncStorage,
  async authorize(id) {
    const user = await faceSession.restore({ allowOffline: true });
    if (user?.id !== id || user.role !== "botanist")
      throw Error("Sign in with the draft owner account.");
  },
  async encrypt(id, value) {
    const sealed = await aesEncryptAsync(
      new TextEncoder().encode(value),
      await keyFor(id, true),
    );
    return { version: 1, ciphertext: await sealed.combined("base64") };
  },
  async decrypt(id, value) {
    if (value.version !== 1 || typeof value.ciphertext !== "string")
      throw Error("Invalid encrypted draft");
    const plain = await aesDecryptAsync(
      AESSealedData.fromCombined(value.ciphertext),
      await keyFor(id, false),
    );
    return new TextDecoder().decode(plain);
  },
  availableBytes: async () => Paths.availableDiskSpace,
});
export const readDrafts = store.readDrafts;
export const saveDraft = store.saveDraft;
export const removeDraft = store.removeDraft;
