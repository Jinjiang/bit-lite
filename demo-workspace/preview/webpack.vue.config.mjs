import { VueLoaderPlugin } from "vue-loader";

export default {
  module: {
    rules: [
      {
        test: /\.vue$/,
        loader: "vue-loader",
      },
    ],
  },
  plugins: [new VueLoaderPlugin()],
  devServer: {
    host: "127.0.0.1",
    hot: false,
    client: false,
  },
};
