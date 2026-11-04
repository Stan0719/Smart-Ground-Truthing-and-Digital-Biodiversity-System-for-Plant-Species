# English and Bahasa Melayu interface localization

## Runtime

i18next 26.7.1 and react-i18next 17.1.11 use 896 bundled English/Malay resource entries. There is no translation API, language detector, remote resource backend, downloaded model, or native translation dependency. Expo Go does not need a new development build solely for this feature.

English (en) is the first-launch default. Bahasa Melayu uses the standard ms language code and is labeled BM in the selector. The compact selector appears at the top right of Login, Home, the Botanist Dashboard, the plant/species explorer, the per-species plant record list, and Account. The Botanist tab renders the Dashboard instead of Account. Home uses a safe-area-aware top bar; the Dashboard places the selector above its notification/logout row; Account places it beside its heading. The Plants tab maps to Species.js, while the per-species record list maps to Plant.js. Their navigation headers are hidden, so each screen owns its selector without a duplicate parent-header control. Forms and detail pages do not receive selectors. The existing QR button layout is unchanged.

The root LocalizationProvider restores AsyncStorage key niah.ui-language.v1 before mounting the app. Its scope is this installation/device, independent of account credentials. No auth/draft/notification storage keys are changed. A failed preference read falls back to English; a failed save leaves the selected language active for the current session and shows an explanatory alert. Saves are serialized so rapid changes persist the final selection.

Every localized screen subscribes through useAppTranslation. Navigation titles and already-mounted screens update on languageChanged without navigation resets or app restarts. Existing state/effect dependencies are preserved; language changes do not refetch records or change form values.

## Display versus data

- Direct UI text uses meaningful namespaced keys with t(key, values). Common actions are shared.
- Controlled status/category/life-stage labels use translateLabel or translateFieldValue at render time. English and already-localized field labels are supported. Their actual database/control values remain canonical.
- Existing client validation/error messages stay canonical in state and are localized at display time through the bundled message catalogue, including interpolation. Unknown server messages remain original text rather than being machine-translated.
- Scientific names, common names from records, user-entered descriptions/notes, Officer comments, IDs, QR tokens, API paths, field names, and role/status comparisons are unchanged.
- Notification titles/messages are localized in a presentation helper; persisted event types, ownership, read flags and Officer feedback remain unchanged. Notification/date displays use en-GB or ms-MY. Absolute timestamps are retained; no relative-time feature was added.
- QR print labels are passed to the existing print HTML builder and escaped. The selected QR image, its identifier, quiet zone and print workflow are unchanged.

## Created files

- translations/en.json
- translations/ms.json
- translations/core.js
- translations/i18n.js
- translations/LocalizationProvider.js
- translations/notifications.js
- components/LanguageSelector.js
- scripts/localization.test.mjs
- scripts/localization-contract.json
- docs/localization.md (this file)

## Modified files

- App.js
- screens/Account.js
- screens/AddObservation.js
- screens/AddPlant.js
- screens/BotanistDashboard.js
- screens/BotanistNotifications.js
- screens/BotanistPlantDetail.js
- screens/EditPlant.js
- screens/FavouritePlants.js
- screens/FieldCollection.js
- screens/Home.js
- screens/Login.js
- screens/MandatoryPasswordChange.js
- screens/Map.js
- screens/NotificationObservation.js
- screens/PersistentKnowledge.js
- screens/Plant.js
- screens/PlantDetail.js
- screens/PlantQRCode.js
- screens/Scan.js
- screens/ScanHistory.js
- screens/Species.js
- screens/SpeciesDetail.js
- screens/VisitorRegister.js
- components/FaceCameraModal.js
- components/PlantCard.js
- components/QRRefreshButton.js
- src/app/forgot-password.js
- src/app/_layout.js
- utils/qrPrint.js
- package.json
- package-lock.json
- scripts/first-login-screen.test.mjs
- scripts/plant-session.test.mjs

Screens covered include Dashboard, Add Plant, Plant QR Code, Notifications, observation details, collection/correction workflows, plant/species details and lists, map, home, favourites/history, Login, mandatory password change, recovery, Visitor registration and Account. Profile.js and StatusBadge.js are empty existing stubs with no UI to translate; no new profile/settings route was introduced.

## Adding translations

Add the same meaningful key to en.json and ms.json, then render t(key, interpolationValues) in a component subscribing via useAppTranslation(). Do not translate a value before using it as a status comparison, API payload, filter key or identifier. Keep record content outside UI-message translation helpers.

## Verification

- 118 mobile tests passed using node --test scripts/*.test.mjs.
- Nine localization tests cover default/fallback languages, immediate offline switching, persistence after recreation, storage failures, restore/save races, catalogue parity, every static key, interpolation parity, screen subscriptions and actual screen rendering in EN/BM/EN.
- Render fixtures exercise Dashboard, Add Plant validation, QR print preparation/disabled Delete UI, and Notifications while preserving QR token/identifier and original Officer comment.
- Contract checks verify all 231 existing transport/navigation/status-comparison expressions from before localization remain unchanged.
- Existing login tests use an English localization adapter. The business-session fetch mock now returns a standard Response compatible with the existing response.text() reader. No assertions or application authentication behavior were removed.
- Mobile lint, TypeScript checking, and Android JS bundle export passed.

These are automated component fixtures and build checks, not physical-device tests. Live database writes, native printing/scanning, airplane-mode device operation, and visual overflow on actual phone sizes were not tested. No backend/database schema, records, endpoints, permissions or approval workflows were changed. Native OS permission-dialog wording follows the phone OS; the custom biometric prompt uses the selected app language. Unknown free-form server errors and record content intentionally retain their original language.
