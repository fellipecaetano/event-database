import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";

export const inboxLintConfig = {
  files: ["apps/inbox/src/**/*.{ts,tsx}"],
  plugins: {
    "jsx-a11y": jsxA11y,
    "react-hooks": reactHooks,
  },
  languageOptions: {
    globals: {
      document: "readonly",
      fetch: "readonly",
      File: "readonly",
      TextEncoder: "readonly",
      URLSearchParams: "readonly",
      window: "readonly",
      XMLHttpRequest: "readonly",
    },
  },
  rules: {
    ...jsxA11y.flatConfigs.recommended.rules,
    ...reactHooks.configs.flat["recommended-latest"].rules,
  },
};
