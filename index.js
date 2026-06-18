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

app.get("/api/my-startup", async (req, res) => {
  try {
    const { founder_email } = req.query;
    if (!founder_email) {
      return res.status(400).json({ message: "founder_email is required" });
    }
    const startup = await startupsCol.findOne({ founder_email });
    res.json(startup || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch startup" });
  }
});


app.get("/api/startups", async (req, res) => {
  try {
    const { search, industry } = req.query;
    const filter = {};
    if (industry) filter.industry = industry;
    if (search) {
      filter.$or = [
        { startup_name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }
    const startups = await startupsCol
      .find(filter)
      .sort({ created_at: -1 })
      .toArray();
    res.json(startups);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch startups" });
  }
});


app.get("/api/startups/:id", async (req, res) => {
  try {
    const startup = await startupsCol.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (!startup) return res.status(404).json({ message: "Startup not found" });
    res.json(startup);
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: "Invalid startup id" });
  }
});

app.post("/api/startups", async (req, res) => {
  try {
    const {
      startup_name,
      industry,
      description,
      funding_stage,
      logo,
      founder_email,
    } = req.body;
    if (!startup_name || !industry || !description || !founder_email) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const existing = await startupsCol.findOne({ founder_email });
    if (existing) {
      return res
        .status(409)
        .json({ message: "You already have a startup profile" });
    }

    const doc = {
      startup_name,
      industry,
      description,
      funding_stage: funding_stage || "Pre-Seed",
      logo: logo || "",
      founder_email,
      created_at: new Date(),
    };

    const result = await startupsCol.insertOne(doc);
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create startup" });
  }
});

app.patch("/api/startups/:id", async (req, res) => {
  try {
    const { founder_email, ...rest } = req.body;
    const filter = { _id: new ObjectId(req.params.id) };
    if (founder_email) filter.founder_email = founder_email;

    const allowed = [
      "startup_name",
      "industry",
      "description",
      "funding_stage",
      "logo",
    ];
    const update = {};
    for (const key of allowed) {
      if (rest[key] !== undefined) update[key] = rest[key];
    }

    const result = await startupsCol.updateOne(filter, { $set: update });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: "Failed to update startup" });
  }
});

app.delete("/api/startups/:id", async (req, res) => {
  try {
    const result = await startupsCol.deleteOne({
      _id: new ObjectId(req.params.id),
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: "Failed to delete startup" });
  }
});

app.listen(port, () => console.log(`StartupForge API running on port ${port}`));

module.exports = app;
