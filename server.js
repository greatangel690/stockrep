require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("./db");

const app = express();
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`StockMaster running on port ${PORT}`);
});
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("Missing JWT_SECRET. Copy .env.example to .env and set a secret.");
  process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "")));

function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ message: "Please sign in first." });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Your session has expired. Please sign in again." });
  }
}

function cleanText(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function positiveInteger(value, field, allowZero = true) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < (allowZero ? 0 : 1)) {
    throw new Error(`${field} must be a valid ${allowZero ? "non-negative" : "positive"} whole number.`);
  }
  return n;
}

function nonNegativeMoney(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 999999999999) {
    throw new Error(`${field} must be a valid non-negative amount.`);
  }
  return Number(n.toFixed(2));
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "StockMaster" });
});

app.post("/api/auth/signup", asyncRoute(async (req, res) => {
  const fullName = cleanText(req.body.fullName, 120);
  const businessName = cleanText(req.body.businessName, 160);
  const email = cleanText(req.body.email, 190).toLowerCase();
  const password = String(req.body.password || "");

  if (!fullName || !businessName || !email || !password) {
    return res.status(400).json({ message: "Please complete every field." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: "Enter a valid email address." });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters." });
  }

  const [existing] = await pool.execute("SELECT id FROM users WHERE email = ?", [email]);
  if (existing.length) return res.status(409).json({ message: "An account with this email already exists." });

  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await pool.execute(
    "INSERT INTO users (full_name, business_name, email, password_hash) VALUES (?, ?, ?, ?)",
    [fullName, businessName, email, passwordHash]
  );

  const user = { id: result.insertId, fullName, businessName, email };
  res.status(201).json({
    message: "Account created successfully.",
    token: makeToken({ id: user.id, email }),
    user
  });
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const email = cleanText(req.body.email, 190).toLowerCase();
  const password = String(req.body.password || "");
  if (!email || !password) return res.status(400).json({ message: "Enter your email and password." });

  const [rows] = await pool.execute(
    "SELECT id, full_name, business_name, email, password_hash FROM users WHERE email = ?",
    [email]
  );
  if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return res.status(401).json({ message: "Email or password is incorrect." });
  }

  const row = rows[0];
  const user = {
    id: row.id,
    fullName: row.full_name,
    businessName: row.business_name,
    email: row.email
  };
  res.json({ message: "Signed in successfully.", token: makeToken(user), user });
}));

app.get("/api/me", authRequired, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    "SELECT id, full_name, business_name, email FROM users WHERE id = ?",
    [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ message: "Account not found." });
  const row = rows[0];
  res.json({ user: { id: row.id, fullName: row.full_name, businessName: row.business_name, email: row.email } });
}));

app.get("/api/dashboard", authRequired, asyncRoute(async (req, res) => {
  const [productRows] = await pool.execute(
    `SELECT COUNT(*) AS productCount,
            COALESCE(SUM(quantity), 0) AS unitsInStock,
            COALESCE(SUM(quantity * unit_cost), 0) AS stockValue,
            COALESCE(SUM(CASE WHEN quantity > 0 AND quantity <= minimum_quantity THEN 1 ELSE 0 END), 0) AS lowStockCount,
            COALESCE(SUM(CASE WHEN quantity = 0 THEN 1 ELSE 0 END), 0) AS outOfStockCount
     FROM products WHERE user_id = ?`,
    [req.user.id]
  );
  const [salesRows] = await pool.execute(
    "SELECT COUNT(*) AS saleCount, COALESCE(SUM(quantity_sold * unit_price), 0) AS salesValue FROM sales WHERE user_id = ?",
    [req.user.id]
  );
  res.json({ ...productRows[0], ...salesRows[0] });
}));

app.get("/api/products", authRequired, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, name, sku, category, quantity, minimum_quantity AS minimumQuantity,
            unit_cost AS unitCost, selling_price AS sellingPrice, created_at AS createdAt
     FROM products WHERE user_id = ? ORDER BY name ASC`,
    [req.user.id]
  );
  res.json({ products: rows });
}));

app.post("/api/products", authRequired, asyncRoute(async (req, res) => {
  const name = cleanText(req.body.name);
  const sku = cleanText(req.body.sku, 80);
  const category = cleanText(req.body.category || "Other", 100);
  if (!name || !sku) return res.status(400).json({ message: "Product name and SKU are required." });

  let quantity, minimumQuantity, unitCost, sellingPrice;
  try {
    quantity = positiveInteger(req.body.quantity, "Quantity");
    minimumQuantity = positiveInteger(req.body.minimumQuantity, "Minimum quantity");
    unitCost = nonNegativeMoney(req.body.unitCost, "Unit cost");
    sellingPrice = nonNegativeMoney(req.body.sellingPrice, "Selling price");
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO products (user_id, name, sku, category, quantity, minimum_quantity, unit_cost, selling_price)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, name, sku, category, quantity, minimumQuantity, unitCost, sellingPrice]
    );
    res.status(201).json({ message: "Product added.", id: result.insertId });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "That SKU is already used in your inventory." });
    throw err;
  }
}));

app.put("/api/products/:id", authRequired, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid product ID." });
  const name = cleanText(req.body.name);
  const sku = cleanText(req.body.sku, 80);
  const category = cleanText(req.body.category || "Other", 100);
  if (!name || !sku) return res.status(400).json({ message: "Product name and SKU are required." });

  let quantity, minimumQuantity, unitCost, sellingPrice;
  try {
    quantity = positiveInteger(req.body.quantity, "Quantity");
    minimumQuantity = positiveInteger(req.body.minimumQuantity, "Minimum quantity");
    unitCost = nonNegativeMoney(req.body.unitCost, "Unit cost");
    sellingPrice = nonNegativeMoney(req.body.sellingPrice, "Selling price");
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE products SET name=?, sku=?, category=?, quantity=?, minimum_quantity=?, unit_cost=?, selling_price=?
       WHERE id=? AND user_id=?`,
      [name, sku, category, quantity, minimumQuantity, unitCost, sellingPrice, id, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Product not found." });
    res.json({ message: "Product updated." });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "That SKU is already used in your inventory." });
    throw err;
  }
}));

app.post("/api/products/:id/stock", authRequired, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  let quantity;
  try { quantity = positiveInteger(req.body.quantity, "Quantity received", false); }
  catch (err) { return res.status(400).json({ message: err.message }); }

  const [result] = await pool.execute(
    "UPDATE products SET quantity = quantity + ? WHERE id = ? AND user_id = ?",
    [quantity, id, req.user.id]
  );
  if (!result.affectedRows) return res.status(404).json({ message: "Product not found." });
  res.json({ message: "Stock quantity updated." });
}));

app.delete("/api/products/:id", authRequired, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const [result] = await pool.execute("DELETE FROM products WHERE id = ? AND user_id = ?", [id, req.user.id]);
  if (!result.affectedRows) return res.status(404).json({ message: "Product not found." });
  res.json({ message: "Product deleted." });
}));

app.get("/api/sales", authRequired, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT id, product_id AS productId, product_name AS productName, quantity_sold AS quantity,
            unit_price AS unitPrice, (quantity_sold * unit_price) AS total,
            DATE_FORMAT(sold_at, '%Y-%m-%d %H:%i') AS soldAt
     FROM sales WHERE user_id = ? ORDER BY sold_at DESC LIMIT 200`,
    [req.user.id]
  );
  res.json({ sales: rows });
}));

app.post("/api/sales", authRequired, asyncRoute(async (req, res) => {
  const productId = Number(req.body.productId);
  let quantity, unitPrice;
  try {
    quantity = positiveInteger(req.body.quantity, "Quantity sold", false);
    unitPrice = nonNegativeMoney(req.body.unitPrice, "Selling price");
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [products] = await connection.execute(
      "SELECT id, name, quantity FROM products WHERE id = ? AND user_id = ? FOR UPDATE",
      [productId, req.user.id]
    );
    if (!products.length) {
      await connection.rollback();
      return res.status(404).json({ message: "Product not found." });
    }
    const product = products[0];
    if (quantity > product.quantity) {
      await connection.rollback();
      return res.status(400).json({ message: `Only ${product.quantity} unit(s) are available.` });
    }

    await connection.execute(
      "UPDATE products SET quantity = quantity - ? WHERE id = ? AND user_id = ?",
      [quantity, productId, req.user.id]
    );
    const [saleResult] = await connection.execute(
      "INSERT INTO sales (user_id, product_id, product_name, quantity_sold, unit_price) VALUES (?, ?, ?, ?, ?)",
      [req.user.id, product.id, product.name, quantity, unitPrice]
    );
    await connection.commit();
    res.status(201).json({ message: "Sale recorded and stock updated.", id: saleResult.insertId });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}));

app.get("/api/reports", authRequired, asyncRoute(async (req, res) => {
  const [categories] = await pool.execute(
    `SELECT category, COALESCE(SUM(quantity), 0) AS units
     FROM products WHERE user_id = ? GROUP BY category ORDER BY category`,
    [req.user.id]
  );
  const [alerts] = await pool.execute(
    `SELECT id, name, sku, quantity, minimum_quantity AS minimumQuantity
     FROM products WHERE user_id = ? AND quantity <= minimum_quantity ORDER BY quantity ASC, name ASC`,
    [req.user.id]
  );
  res.json({ categories, alerts });
}));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ message: "A server error occurred. Check the terminal for details." });
});

async function start() {
  try {
    await pool.query("SELECT 1");
    app.listen(PORT, () => console.log(`StockMaster running at http://localhost:${PORT}`));
  } catch (err) {
    console.error("Could not connect to MySQL. Check your .env settings and database.sql.");
    console.error(err.message);
    process.exit(1);
  }
}
start();
