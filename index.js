const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
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
app.use(cookieParser());

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
const paymentsCol = db.collection("payments");
const usersCol = db.collection("user");

// AUTH MIDDLEWARE — JWT based

const verifyToken = async (req, res, next) => {
  const token = req.cookies["access_token"];

  if (!token) {
    return res.status(401).json({ message: "unauthorized access" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if the user has been blocked since the token was issued
    const dbUser = await usersCol.findOne(
      { email: decoded.email },
      { projection: { isBlocked: 1 } },
    );
    if (dbUser?.isBlocked) {
      return res
        .status(403)
        .json({ message: "Your account has been blocked." });
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "unauthorized access" });
  }
};

const verifyFounder = (req, res, next) => {
  if (req.user?.role !== "founder") {
    return res.status(403).json({ message: "forbidden access" });
  }
  next();
};

const verifyCollaborator = (req, res, next) => {
  if (req.user?.role !== "collaborator") {
    return res.status(403).json({ message: "forbidden access" });
  }
  next();
};

const verifyAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "forbidden access" });
  }
  next();
};

const verifyInternal = (req, res, next) => {
  const key = req.headers["x-internal-key"];
  if (!key || key !== process.env.INTERNAL_API_KEY) {
    return res.status(403).json({ message: "forbidden access" });
  }
  next();
};

// PUBLIC STATS

app.get("/api/stats", async (req, res) => {
  try {
    const [startupsCount, oppsCount, appsCount] = await Promise.all([
      startupsCol.countDocuments({ status: "approved" }),
      opportunitiesCol.countDocuments({}),
      applicationsCol.countDocuments({ status: "accepted" }),
    ]);
    res.json({
      startups: startupsCount,
      opportunities: oppsCount,
      teamsFormed: appsCount,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// STARTUPS

app.get("/api/my-startup", verifyToken, async (req, res) => {
  try {
    const { founder_email } = req.query;
    if (!founder_email) {
      return res.status(400).json({ message: "founder_email is required" });
    }
    if (req.user.email !== founder_email && req.user.role !== "admin") {
      return res.status(403).json({ message: "forbidden access" });
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
    const { search, industry, limit } = req.query;
    const filter = { status: "approved" };
    if (industry) filter.industry = industry;
    if (search) {
      filter.$or = [
        { startup_name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }
    let q = startupsCol.find(filter).sort({ created_at: -1 });
    if (limit) q = q.limit(parseInt(limit));
    const startups = await q.toArray();
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

app.post("/api/startups", verifyToken, verifyFounder, async (req, res) => {
  try {
    const {
      startup_name,
      industry,
      description,
      funding_stage,
      logo,
      founder_email,
      founder_name,
      team_size,
    } = req.body;

    if (!startup_name || !industry || !description || !founder_email) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (req.user.email !== founder_email) {
      return res.status(403).json({ message: "forbidden access" });
    }

    const existing = await startupsCol.findOne({
      founder_email: req.user.email,
    });
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
      team_size: team_size ? parseInt(team_size) : 0,
      founder_email: req.user.email,
      founder_name: founder_name || req.user.name || "",
      status: "pending",
      created_at: new Date(),
    };

    const result = await startupsCol.insertOne(doc);
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create startup" });
  }
});

app.patch("/api/startups/:id", verifyToken, async (req, res) => {
  try {
    const { founder_email, ...rest } = req.body;
    const filter = { _id: new ObjectId(req.params.id) };
    if (req.user.role !== "admin") {
      filter.founder_email = req.user.email;
    }

    const allowed = [
      "startup_name",
      "industry",
      "description",
      "funding_stage",
      "logo",
      "team_size",
      "founder_name",
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

app.delete("/api/startups/:id", verifyToken, async (req, res) => {
  try {
    const filter = { _id: new ObjectId(req.params.id) };
    if (req.user.role !== "admin") {
      filter.founder_email = req.user.email;
    }
    const result = await startupsCol.deleteOne(filter);
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
        {
          required_skills: {
            $elemMatch: { $regex: req.query.search, $options: "i" },
          },
        },
      ];
    }
    if (req.query.workType) query.work_type = { $in: [req.query.workType] };
    if (req.query.industry) query.industry = { $in: [req.query.industry] };
    if (req.query.startup_id) query.startup_id = req.query.startup_id;
    if (req.query.founder_email) query.founder_email = req.query.founder_email;

    if (req.query.limit) {
      const limit = parseInt(req.query.limit);
      const result = await opportunitiesCol
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      return res.json(result);
    }

    if (req.query.page) {
      const page = parseInt(req.query.page);
      const perPage = parseInt(req.query.perPage) || 9;
      const skip = (page - 1) * perPage;
      const total = await opportunitiesCol.countDocuments(query);
      const opportunities = await opportunitiesCol
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(perPage)
        .toArray();
      return res.json({ total, opportunities });
    }

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

app.post("/api/opportunities", verifyToken, verifyFounder, async (req, res) => {
  try {
    const user = await usersCol.findOne({ email: req.user.email });
    const isPremium = user?.plan === "founder_premium";

    if (!isPremium) {
      const count = await opportunitiesCol.countDocuments({
        founder_email: req.user.email,
      });
      if (count >= 3) {
        return res.status(403).json({
          message:
            "Free limit reached. Upgrade to Premium to post more opportunities.",
          requiresUpgrade: true,
        });
      }
    }

    const opp = { ...req.body, createdAt: new Date() };
    opp.founder_email = req.user.email;
    const result = await opportunitiesCol.insertOne(opp);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.patch("/api/opportunities/:id", verifyToken, async (req, res) => {
  try {
    const { _id, ...updates } = req.body;
    const filter = { _id: new ObjectId(req.params.id) };
    if (req.user.role !== "admin") {
      filter.founder_email = req.user.email;
    }
    const result = await opportunitiesCol.updateOne(filter, { $set: updates });
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete("/api/opportunities/:id", verifyToken, async (req, res) => {
  try {
    const filter = { _id: new ObjectId(req.params.id) };
    if (req.user.role !== "admin") {
      filter.founder_email = req.user.email;
    }
    const result = await opportunitiesCol.deleteOne(filter);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ADMIN — USERS

app.get("/api/users", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const users = await usersCol
      .find({}, { projection: { password: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.patch(
  "/api/users/:id/block",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { isBlocked } = req.body;
      const result = await usersCol.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { isBlocked: isBlocked === true } },
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },
);

// ADMIN — STARTUPS

app.get("/api/admin/startups", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const startups = await startupsCol
      .find(filter)
      .sort({ created_at: -1 })
      .toArray();
    res.json(startups);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.patch(
  "/api/admin/startups/:id/approve",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const result = await startupsCol.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: "approved" } },
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },
);

app.delete(
  "/api/admin/startups/:id",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const result = await startupsCol.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },
);

// APPLICATIONS

app.get("/api/applications", verifyToken, async (req, res) => {
  try {
    const query = {};

    if (req.query.applicant_email) {
      if (
        req.user.email !== req.query.applicant_email &&
        req.user.role !== "admin"
      ) {
        return res.status(403).json({ message: "forbidden access" });
      }
      query.applicant_email = req.query.applicant_email;
    }
    if (req.query.opportunity_id) {
      query.opportunity_id = req.query.opportunity_id;
    }
    if (req.query.founder_email) {
      if (
        req.user.email !== req.query.founder_email &&
        req.user.role !== "admin"
      ) {
        return res.status(403).json({ message: "forbidden access" });
      }
      const founderOpps = await opportunitiesCol
        .find({ founder_email: req.query.founder_email })
        .project({ _id: 1 })
        .toArray();
      const oppIds = founderOpps.map((o) => o._id.toString());
      if (oppIds.length === 0) {
        return res.json([]);
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

app.get("/api/applications/:id", verifyToken, async (req, res) => {
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

app.post(
  "/api/applications",
  verifyToken,
  verifyCollaborator,
  async (req, res) => {
    try {
      const {
        opportunity_id,
        applicant_email,
        portfolio_link,
        motivation,
        role_title,
        startup_name,
      } = req.body;

      if (!opportunity_id || !applicant_email || !motivation) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      if (req.user.email !== applicant_email) {
        return res.status(403).json({ message: "forbidden access" });
      }

      const existing = await applicationsCol.findOne({
        opportunity_id,
        applicant_email: req.user.email,
      });
      if (existing) {
        return res
          .status(409)
          .json({ message: "You have already applied to this opportunity" });
      }

      const doc = {
        opportunity_id,
        applicant_email: req.user.email,
        portfolio_link: portfolio_link || "",
        motivation,
        status: "pending",
        applied_at: new Date(),
        role_title: role_title || "",
        startup_name: startup_name || "",
      };

      const result = await applicationsCol.insertOne(doc);
      res.status(201).json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },
);

app.patch("/api/applications/:id", verifyToken, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["pending", "accepted", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    if (req.user.role !== "founder" && req.user.role !== "admin") {
      return res.status(403).json({ message: "forbidden access" });
    }

    if (req.user.role === "founder") {
      const application = await applicationsCol.findOne({
        _id: new ObjectId(req.params.id),
      });
      if (!application) {
        return res.status(404).json({ message: "Application not found" });
      }
      const opportunity = await opportunitiesCol.findOne({
        _id: new ObjectId(application.opportunity_id),
      });
      if (!opportunity || opportunity.founder_email !== req.user.email) {
        return res.status(403).json({ message: "forbidden access" });
      }
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

// USER PROFILE UPDATE

app.patch("/api/users/profile", verifyToken, async (req, res) => {
  try {
    const { name, image, bio, skills, email } = req.body;
    if (req.user.email !== email && req.user.role !== "admin") {
      return res.status(403).json({ message: "forbidden access" });
    }
    const update = {};
    if (name !== undefined) update.name = name;
    if (image !== undefined) update.image = image;
    if (bio !== undefined) update.bio = bio;
    if (skills !== undefined) update.skills = skills;

    const result = await usersCol.updateOne(
      { email: req.user.email },
      { $set: update },
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin summary stats
app.get("/api/admin/stats", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const [usersCount, startupsCount, oppsCount, paymentsArr, appsArr] =
      await Promise.all([
        usersCol.countDocuments({}),
        startupsCol.countDocuments({}),
        opportunitiesCol.countDocuments({}),
        paymentsCol.find({ payment_status: "paid" }).toArray(),
        applicationsCol.countDocuments({ status: "pending" }),
      ]);
    const revenue = paymentsArr.reduce((sum, p) => sum + (p.amount || 0), 0);
    res.json({
      users: usersCount,
      startups: startupsCount,
      opportunities: oppsCount,
      revenue,
      pendingApps: appsArr,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PAYMENTS

app.get("/api/payments", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const payments = await paymentsCol.find().sort({ paid_at: -1 }).toArray();
    res.json(payments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/payments", verifyInternal, async (req, res) => {
  try {
    const { user_email, amount, transaction_id, payment_status, paid_at } =
      req.body;

    if (!user_email || !transaction_id) {
      return res
        .status(400)
        .json({ message: "user_email and transaction_id are required" });
    }

    const existing = await paymentsCol.findOne({ transaction_id });
    if (existing) return res.json({ acknowledged: true, duplicate: true });

    const result = await paymentsCol.insertOne({
      user_email,
      amount: amount || 19,
      transaction_id,
      payment_status: payment_status || "paid",
      paid_at: paid_at ? new Date(paid_at) : new Date(),
    });

    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.patch("/api/users/plan", verifyInternal, async (req, res) => {
  try {
    const { email, plan } = req.body;
    if (!email || !plan) {
      return res.status(400).json({ message: "email and plan are required" });
    }
    const result = await usersCol.updateOne({ email }, { $set: { plan } });
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.listen(port, () => console.log(`StartupForge API running on port ${port}`));

module.exports = app;
