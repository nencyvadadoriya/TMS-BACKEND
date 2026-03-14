// require("dns").setServers(["8.8.8.8", "8.8.4.4"]);
require("dotenv").config();
const express = require("express");
const morgan = require("morgan");
const cors = require("cors");
const http = require("http");

require("./src/config/db.confing");
const { initSocket } = require("./src/realtime/socket");
const { startPersonalTaskReminderScheduler } = require("./src/utils/personalTaskReminder.scheduler");

const app = express();
const PORT = process.env.PORT || 9001;

/* ===============================
   GLOBAL ERROR HANDLING
================================ */

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Rejection:", err);
  process.exit(1);
});

/* ===============================
   MIDDLEWARE
================================ */

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

/* ===============================
   CORS CONFIG
================================ */

const allowedOrigins = new Set(
  String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

if (process.env.FRONTEND_URL) {
  allowedOrigins.add(process.env.FRONTEND_URL.trim());
}

const localhostOriginPattern =
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (
        allowedOrigins.has(origin) ||
        localhostOriginPattern.test(origin)
      ) {
        return callback(null, true);
      }

      return callback(
        new Error(`CORS blocked for origin: ${origin}`)
      );
    },
    credentials: true,
  })
);

/* ===============================
   ROUTES
================================ */

app.use("/api", require("./src/routes/index"));

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    uptime: process.uptime(),
    timestamp: new Date(),
    environment: process.env.NODE_ENV || "development",
  });
});

/* ===============================
   SERVER START (ONLY ONCE)
================================ */

const server = http.createServer(app);
initSocket(server);

server.listen(PORT, "0.0.0.0", (err) => {
  if (err) {
    console.error("❌ Server failed to start:", err);
    process.exit(1);
  }

  console.log("===================================");
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log("===================================");

  // Start personal task reminder scheduler
  startPersonalTaskReminderScheduler();
});

/* ===============================
   EXPORT
================================ */

module.exports = app;