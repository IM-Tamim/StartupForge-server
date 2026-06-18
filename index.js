const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 5000;
require("dotenv").config();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  }),
);
app.use(express.json());

app.get("/", (req, res) => res.send("StartupForge API running"));

// ─── MongoDB ─────────────────────────────────────────────────────────────────
const uri = process.env.MONGO_DB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

client.connect().catch(console.dir);

const db = client.db(process.env.MONGO_DB_NAME || "StartupForge_db");
const startupsCol = db.collection("startups");
const opportunitiesCol = db.collection("opportunities");
const applicationsCol = db.collection("applications");

// ─── Auth Middleware ──────────────────────────────────────────────────────────

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(port, () => console.log(`StartupForge API running on port ${port}`));

module.exports = app;
