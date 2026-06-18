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
const startupsCol      = db.collection("startups");
const opportunitiesCol = db.collection("opportunities");
const applicationsCol  = db.collection("applications");
const usersCol         = db.collection("user"); // better-auth stores users in "user"

// STARTUPS

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
        { description:  { $regex: search, $options: "i" } },
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
      startup_name, industry, description,
      funding_stage, logo, founder_email,
    } = req.body;

    if (!startup_name || !industry || !description || !founder_email) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const existing = await startupsCol.findOne({ founder_email });
    if (existing) {
      return res.status(409).json({ message: "You already have a startup profile" });
    }

    const doc = {
      startup_name,
      industry,
      description,
      funding_stage: funding_stage || "Pre-Seed",
      logo:          logo || "",
      founder_email,
      created_at:    new Date(),
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

    const allowed = ["startup_name", "industry", "description", "funding_stage", "logo"];
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

// OPPORTUNITIES

app.get("/api/opportunities", async (req, res) => {
  try {
    const query = {};

    if (req.query.search) {
      query.$or = [
        { role_title: { $regex: req.query.search, $options: "i" } },
        { required_skills: { $elemMatch: { $regex: req.query.search, $options: "i" } } },
      ];
    }
    if (req.query.workType)      query.work_type      = req.query.workType;
    if (req.query.industry)      query.industry       = req.query.industry;
    if (req.query.startup_id)    query.startup_id     = req.query.startup_id;
    if (req.query.founder_email) query.founder_email  = req.query.founder_email;

    // limit — used by home page featured section
    if (req.query.limit) {
      const limit = parseInt(req.query.limit);
      const result = await opportunitiesCol
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      return res.json(result);
    }

    // paginated — used by browse opportunities page
    if (req.query.page) {
      const page    = parseInt(req.query.page);
      const perPage = parseInt(req.query.perPage) || 9;
      const skip    = (page - 1) * perPage;
      const total   = await opportunitiesCol.countDocuments(query);
      const opportunities = await opportunitiesCol
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(perPage)
        .toArray();
      return res.json({ total, opportunities });
    }

    // all — used by founder dashboard
    const result = await opportunitiesCol
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/opportunities/:id", async (req, res) => {
  try {
    const result = await opportunitiesCol.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (!result) return res.status(404).json({ message: "Not found" });
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/opportunities", async (req, res) => {
  try {
    const opp = { ...req.body, createdAt: new Date() };
    const result = await opportunitiesCol.insertOne(opp);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.patch("/api/opportunities/:id", async (req, res) => {
  try {
    const { _id, ...updates } = req.body;
    const result = await opportunitiesCol.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updates },
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete("/api/opportunities/:id", async (req, res) => {
  try {
    const result = await opportunitiesCol.deleteOne({
      _id: new ObjectId(req.params.id),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Profile update
app.patch("/api/users/profile", async (req, res) => {
  try {
    const { email, name, bio, skills, image } = req.body;
    if (!email) return res.status(400).json({ message: "email is required" });

    const update = {};
    if (name   !== undefined) update.name   = name;
    if (bio    !== undefined) update.bio    = bio;
    if (skills !== undefined) update.skills = skills;
    if (image  !== undefined) update.image  = image;

    const result = await usersCol.updateOne(
      { email },
      { $set: update },
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Application

app.get("/api/applications", async (req, res) => {
  try {
    const query = {};

    if (req.query.applicant_email) {
      query.applicant_email = req.query.applicant_email;
    }

    if (req.query.opportunity_id) {
      query.opportunity_id = req.query.opportunity_id;
    }

    if (req.query.founder_email) {
      const founderOpps = await opportunitiesCol
        .find({ founder_email: req.query.founder_email })
        .project({ _id: 1 })
        .toArray();
      const oppIds = founderOpps.map((o) => o._id.toString());
      if (oppIds.length === 0) {
        return res.json([]); // founder has no opportunities → no applications
      }
      query.opportunity_id = { $in: oppIds };
    }

    const applications = await applicationsCol
      .find(query)
      .sort({ applied_at: -1 })
      .toArray();
    res.json(applications);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/applications/:id", async (req, res) => {
  try {
    const result = await applicationsCol.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (!result) return res.status(404).json({ message: "Not found" });
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/applications", async (req, res) => {
  try {
    const {
      opportunity_id, applicant_email,
      portfolio_link, motivation,
      role_title, startup_name,
    } = req.body;

    if (!opportunity_id || !applicant_email || !motivation) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // prevent duplicate applications
    const existing = await applicationsCol.findOne({ opportunity_id, applicant_email });
    if (existing) {
      return res.status(409).json({ message: "You have already applied to this opportunity" });
    }

    const doc = {
      opportunity_id,
      applicant_email,
      portfolio_link: portfolio_link || "",
      motivation,
      status:        "pending",
      applied_at:    new Date(),
      role_title:    role_title    || "",
      startup_name:  startup_name  || "",
    };

    const result = await applicationsCol.insertOne(doc);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.patch("/api/applications/:id", async (req, res) => {
  try {
    const { status } = req.body;
    if (!["pending", "accepted", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const result = await applicationsCol.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status } },
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// ─────────────────────────────────────────────
app.listen(port, () => console.log(`StartupForge API running on port ${port}`));

module.exports = app;