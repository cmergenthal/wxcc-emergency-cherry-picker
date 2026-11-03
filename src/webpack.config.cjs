const path = require("path");



const config = {
  mode: "production",
  entry: { bundle: "./widget-SDK-Voice.js", "emergency-header": "./emergency-header-widget.js" },
  output: {
    path: path.resolve(__dirname, "dist/build"),
    filename: "[name].js",
    publicPath: "build/"
  },
  module: {
    rules: [
      {
        use: "babel-loader",
        test: /\.js$/
      }
    ]
  },
  plugins: []
};

module.exports = config;
