import tseslint from "typescript-eslint";

export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      eqeqeq: "error",
      "no-extra-semi": "error",
      "no-unused-vars": "error",
      quotes: ["error", "double"],
      semi: ["error", "always"],
    },
  },
];
