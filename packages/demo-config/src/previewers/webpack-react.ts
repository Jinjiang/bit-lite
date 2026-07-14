import { createRequire } from "node:module";
import path from "node:path";
import { mdxOptions } from "demo-utils";
import type { Configuration } from "webpack";

const require = createRequire(import.meta.url);

const config: Configuration = {
  resolve: {
    extensions: [".mdx", ".md", ".tsx", ".ts", ".jsx", ".js", ".json"],
    alias: {
      react: path.dirname(require.resolve("react")),
      "react-dom": path.dirname(require.resolve("react-dom")),
    },
    extensionAlias: {
      ".js": [".tsx", ".ts", ".js"],
      ".jsx": [".tsx", ".jsx"],
    },
  },
  module: {
    rules: [
      {
        test: /\.docs\.mdx?$/,
        use: {
          loader: require.resolve("@mdx-js/loader"),
          options: mdxOptions,
        },
      },
      {
        test: /\.[jt]sx?$/,
        exclude: /node_modules/,
        use: {
          loader: require.resolve("swc-loader"),
          options: {
            jsc: {
              parser: {
                syntax: "typescript",
                tsx: true,
              },
              transform: {
                react: {
                  runtime: "automatic",
                },
              },
            },
          },
        },
      },
    ],
  },
};

export default config;
