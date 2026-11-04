"use strict";
// Resolve relative to this file, even when started from the workspace root.
// Existing process variables (including Codespaces Secrets) retain priority.
require("dotenv").config({
  path: require("node:path").join(__dirname, ".env"),
  quiet: true,
});
