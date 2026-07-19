const isAppRuntime =
  typeof document !== "undefined" || (typeof navigator !== "undefined" && navigator.product === "ReactNative");

if (isAppRuntime) {
  require("./index");
} else {
  const startAdapter = eval("require")("./adapter/main");
  if (require.main === module) {
    startAdapter();
  } else {
    module.exports = startAdapter;
  }
}
