import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../components/PasswordVisibilityButton.js", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { fileName: "PasswordVisibilityButton.jsx", compilerOptions: {
  jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
} }).outputText;

for (const language of ["en", "ms", "zh"]) {
  test(`${language} password visibility control toggles its icon and accessible label without changing field values`, () => {
    const messages = JSON.parse(readFileSync(new URL(`../translations/${language}.json`, import.meta.url), "utf8"));
    const module = { exports: {} };
    new Function("require", "module", "exports", compiled)((name) => ({
      react: require("react"),
      "react-native": { TouchableOpacity: "TouchableOpacity" },
      "@expo/vector-icons": { Ionicons: "Ionicons" },
      "../translations/i18n": { t: (key) => key.split(".").reduce((value, part) => value?.[part], messages), useAppTranslation() {} },
    })[name], module, module.exports);
    const Button = module.exports.default;
    let firstVisible = false, secondVisible = false;
    const firstValue = "first secret", secondValue = "second secret";
    const first = () => Button({ visible: firstVisible, onPress: () => { firstVisible = !firstVisible; } });
    const second = () => Button({ visible: secondVisible, onPress: () => { secondVisible = !secondVisible; } });
    assert.equal(first().props.children.props.name, "eye");
    assert.equal(first().props.accessibilityLabel, messages.login.showPassword);
    assert.equal(first().props.style.width, 44);
    first().props.onPress();
    assert.equal(first().props.children.props.name, "eye-off");
    assert.equal(first().props.accessibilityLabel, messages.login.hidePassword);
    assert.equal(second().props.children.props.name, "eye");
    second().props.onPress();
    assert.equal(second().props.children.props.name, "eye-off");
    first().props.onPress();
    assert.equal(first().props.children.props.name, "eye");
    assert.equal(second().props.children.props.name, "eye-off");
    assert.equal(firstValue, "first secret");
    assert.equal(secondValue, "second secret");
  });
}
