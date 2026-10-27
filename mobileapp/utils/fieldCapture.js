// Native APIs are injected so permission and failure behavior can be tested safely.
export function createFieldCapture({ imagePicker, location }) {
  return {
    async photo(camera, count) {
      if (count >= 3)
        throw Error("Attach at most three photos per observation.");
      const permission = camera
        ? await imagePicker.requestCameraPermissionsAsync()
        : await imagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted)
        throw Error(
          "Photo permission was denied. Allow camera or photo access in device settings, then retry.",
        );
      const options = { mediaTypes: ["images"], base64: true, quality: 0.7 };
      const result = camera
        ? await imagePicker.launchCameraAsync(options)
        : await imagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return null;
      const asset = result.assets?.[0];
      if (!asset || typeof asset.base64 !== "string" || !asset.base64.length)
        throw Error(
          "The device returned no image data. Capture or choose the photo again.",
        );
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(asset.base64))
        throw Error("The photo data is invalid. Choose another image.");
      const bytes =
        (asset.base64.length * 3) / 4 -
        (asset.base64.match(/=*$/)?.[0].length || 0);
      if (bytes > 4194304) throw Error("Choose a photo smaller than 4 MB.");
      const content_type = asset.base64.startsWith("/9j/")
        ? "image/jpeg"
        : asset.base64.startsWith("iVBOR")
          ? "image/png"
          : null;
      if (!content_type) throw Error("Choose a JPEG or PNG photo.");
      return {
        base64: asset.base64,
        content_type,
        uri: asset.uri || `data:${content_type};base64,${asset.base64}`,
      };
    },
    async coordinates() {
      const permission = await location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted")
        throw Error(
          "Location permission was denied. Allow location access in device settings, then retry.",
        );
      const { coords } = await location.getCurrentPositionAsync({
        accuracy: location.Accuracy.High,
      });
      if (
        !coords ||
        !Number.isFinite(coords.latitude) ||
        Math.abs(coords.latitude) > 90 ||
        !Number.isFinite(coords.longitude) ||
        Math.abs(coords.longitude) > 180 ||
        (coords.accuracy != null &&
          (!Number.isFinite(coords.accuracy) || coords.accuracy < 0))
      )
        throw Error(
          "The device returned invalid GPS coordinates. Record GPS again.",
        );
      return {
        latitude: String(coords.latitude),
        longitude: String(coords.longitude),
        accuracy_m: coords.accuracy == null ? "" : String(coords.accuracy),
      };
    },
  };
}
