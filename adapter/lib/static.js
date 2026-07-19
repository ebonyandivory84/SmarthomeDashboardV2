const fs = require("fs");
const path = require("path");

function resolveWebRoot(adapter) {
  const configured = adapter.config && typeof adapter.config.webDir === "string" ? adapter.config.webDir.trim() : "";
  const fallback = path.join(__dirname, "..", "www");
  if (!configured) {
    return fallback;
  }

  const absolute = path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  if (fs.existsSync(absolute)) {
    return absolute;
  }

  adapter.log.warn(`Configured webDir does not exist: ${absolute}. Falling back to ${fallback}`);
  return fallback;
}

module.exports = {
  resolveWebRoot,
};
