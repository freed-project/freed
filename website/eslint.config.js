import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      // Allow metadata exports and other Next.js patterns in page files
      "react-refresh/only-export-components": "off",
      // Disable strict react-hooks purity rules for animation code
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
      // Allow unescaped entities in JSX content
      "react/no-unescaped-entities": "off",
      // Allow setState in effects for client-side mounting patterns
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
