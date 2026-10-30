const API = "/api";
const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem("stockmaster_token") || "";
let user = null;
let page = "overview";
let products = [];
let sales = [];
let toastTimeout;

const money = (value) => "₦" + Number(value || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 });
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(API + path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && token) {
    logout(false);
    throw new Error(data.message || "Please sign in again.");
  }
  if (!response.ok) throw new Error(data.message || "Request failed.");
  return data;
}

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.remove("hidden");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $("toast").classList.add("hidden"), 3200);
}

function showAuth(which = "login") {
  $("authView").classList.remove("hidden");
  $("appView").classList.add("hidden");
  $("loginCard").classList.toggle("hidden", which !== "login");
  $("signupCard").classList.toggle("hidden", which !== "signup");
}

$("showSignup").addEventListener("click", () => showAuth("signup"));
$("showLogin").addEventListener("click", () => showAuth("login"));

$("signupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    fullName: $("signupName").value.trim(),
    businessName: $("signupBusiness").value.trim(),
    email: $("signupEmail").value.trim(),
    password: $("signupPassword").value
  };
  try {
    const data = await api("/auth/signup", { method: "POST", body: JSON.stringify(payload) });
    setSession(data);
    toast("Account created successfully.");
    await openApp();
  } catch (error) {
    toast(error.message);
  }
});

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: $("loginEmail").value.trim(), password: $("loginPassword").value })
    });
    setSession(data);
    $("loginPassword").value = "";
    await openApp();
  } catch (error) {
    toast(error.message);
  }
});

function setSession(data) {
  token = data.token;
  user = data.user;
  sessionStorage.setItem("stockmaster_token", token);
}

function logout(showMessage = true) {
  token = "";
  user = null;
  products = [];
  sales = [];
  sessionStorage.removeItem("stockmaster_token");
  $("appView").classList.add("hidden");
  showAuth("login");
  if (showMessage) toast("You have logged out.");
}

$("logoutBtn").addEventListener("click", () => logout());
$("menuBtn").addEventListener("click", () => $("sidebar").classList.toggle("open"));
document.querySelectorAll("[data-page]").forEach((button) => {
  button.addEventListener("click", () => goPage(button.dataset.page));
});
$("addProductTop").addEventListener("click", () => openProductModal());
$("exportBtn").addEventListener("click", exportCSV);

async function openApp() {
  try {
    const me = await api("/me");
    user = me.user;
    $("sideName").textContent = user.fullName;
    $("sideBusiness").textContent = user.businessName;
    $("avatar").textContent = (user.fullName || "S").charAt(0).toUpperCase();
    $("authView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    await refreshData();
    renderPage();
  } catch (error) {
    toast(error.message);
    if (!token) showAuth("login");
  }
}

async function refreshData() {
  const [productData, salesData] = await Promise.all([api("/products"), api("/sales")]);
  products = productData.products;
  sales = salesData.sales;
}

function metrics() {
  return {
    count: products.length,
    units: products.reduce((sum, p) => sum + Number(p.quantity), 0),
    low: products.filter((p) => p.quantity > 0 && p.quantity <= p.minimumQuantity).length,
    out: products.filter((p) => p.quantity <= 0).length,
    value: products.reduce((sum, p) => sum + Number(p.quantity) * Number(p.unitCost), 0),
    salesValue: sales.reduce((sum, s) => sum + Number(s.quantity) * Number(s.unitPrice), 0),
    soldUnits: sales.reduce((sum, s) => sum + Number(s.quantity), 0)
  };
}

function stockStatus(product) {
  if (product.quantity <= 0) return '<span class="pill out">● Out of stock</span>';
  if (product.quantity <= product.minimumQuantity) return '<span class="pill low">● Low stock</span>';
  return '<span class="pill good">● In stock</span>';
}

function productRows(list) {
  if (!list.length) return '<tr><td colspan="7"><div class="empty">▤<strong>No products found</strong>Add a product to start tracking your stock.</div></td></tr>';
  return list.map((p) => `<tr>
    <td><strong>${esc(p.name)}</strong><div class="muted">${esc(p.sku)}</div></td>
    <td>${esc(p.category)}</td><td><strong>${p.quantity}</strong> units</td><td>${p.minimumQuantity}</td>
    <td>${money(p.unitCost)}</td><td>${stockStatus(p)}</td>
    <td><div class="actions">
      <button class="icon-btn" title="Add stock" onclick="openStockModal(${p.id})">＋</button>
      <button class="icon-btn" title="Record sale" onclick="openSaleModal(${p.id})">↗</button>
      <button class="icon-btn" title="Edit product" onclick="openProductModal(${p.id})">✎</button>
      <button class="icon-btn" title="Delete product" onclick="deleteProduct(${p.id})">×</button>
    </div></td></tr>`).join("");
}

function productTable(title, subtitle, list, showSearch = true) {
  return `<section class="panel">
    <div class="panel-head"><div><h3>${title}</h3><p>${subtitle}</p></div><button class="btn soft" onclick="openProductModal()">＋ Add product</button></div>
    ${showSearch ? `<div class="toolbar"><input id="productSearch" placeholder="Search product, SKU or category…" oninput="filterProducts()"><select id="stockFilter" onchange="filterProducts()"><option value="all">All stock levels</option><option value="low">Low stock</option><option value="out">Out of stock</option><option value="good">In stock</option></select></div>` : ""}
    <div class="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Quantity</th><th>Alert at</th><th>Unit cost</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody id="productRows">${productRows(list)}</tbody></table></div></section>`;
}

function statCard(label, value, note, icon = "▦") {
  return `<div class="stat"><div class="stat-top">${label}<span class="stat-icon">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></div>`;
}

function renderPage() {
  const m = metrics();
  const content = $("pageContent");
  const titles = { overview: "Overview", products: "Products & Stock", sales: "Sales History", reports: "Inventory Reports" };
  $("pageTitle").textContent = titles[page] || "Overview";
  if (page === "overview") {
    const alerts = products.filter((p) => p.quantity <= p.minimumQuantity);
    content.innerHTML = `
      <div class="page-head"><div><div class="eyebrow-dark">YOUR BUSINESS AT A GLANCE</div><h1>Good day, ${esc((user?.fullName || "there").split(" ")[0])} 👋</h1><p>Here is what is happening with ${esc(user?.businessName || "your business")}.</p></div><button class="btn primary" onclick="openSaleModal()">↗ Record a sale</button></div>
      <div class="stats">
        ${statCard("Products listed", m.count, "Unique products in your store", "▤")}
        ${statCard("Units in stock", m.units.toLocaleString(), "Total quantity available", "▦")}
        ${statCard("Stock alerts", m.low + m.out, `${m.out} out of stock · ${m.low} running low`, "⚠")}
        ${statCard("Stock value", money(m.value), "Quantity × unit cost", "₦")}
      </div>
      <div class="two-col">
        <div>${productTable("Inventory overview", "Your current stock levels", products.slice(0, 5), false)}</div>
        <section class="panel"><div class="panel-head"><div><h3>Stock alerts</h3><p>Products that may need restocking</p></div><span class="pill ${alerts.length ? "low" : "good"}">${alerts.length} alerts</span></div>
        <div class="list">${alerts.length ? alerts.map((p) => `<div class="list-row"><div><strong>${esc(p.name)}</strong><small>${p.quantity <= 0 ? "Stock is empty" : `${p.quantity} units left · alert at ${p.minimumQuantity}`}</small></div>${stockStatus(p)}</div>`).join("") : '<div class="empty">✓<strong>All looking good</strong>No low-stock alerts right now.</div>'}</div></section>
      </div>
      ${salesTable("Recent sales", "Latest recorded transactions", sales.slice(0, 5))}
    `;
  } else if (page === "products") {
    content.innerHTML = `<div class="page-head"><div><div class="eyebrow-dark">INVENTORY CONTROL</div><h1>Products & Stock</h1><p>Add products, update quantities and monitor stock levels.</p></div><button class="btn primary" onclick="openProductModal()">＋ Add product</button></div>
      <div class="stats">${statCard("Products", m.count, "Different items tracked", "▤")}${statCard("Total units", m.units, "Across all products", "▦")}${statCard("Low stock", m.low, "Below alert threshold", "⚠")}${statCard("Out of stock", m.out, "Need restocking", "○")}</div>
      ${productTable("All products", "Your complete inventory list", products)}`;
  } else if (page === "sales") {
    content.innerHTML = `<div class="page-head"><div><div class="eyebrow-dark">SALES & STOCK MOVEMENT</div><h1>Sales History</h1><p>Every sale reduces stock automatically when saved.</p></div><button class="btn primary" onclick="openSaleModal()">＋ New sale</button></div>
      <div class="stats">${statCard("Transactions", sales.length, "Recorded sales", "↗")}${statCard("Sales value", money(m.salesValue), "Total recorded sales", "₦")}${statCard("Units sold", m.soldUnits, "Across all transactions", "▦")}${statCard("Available units", m.units, "Remaining inventory", "▤")}</div>
      ${salesTable("Sales history", "Recorded sales for your account", sales)}`;
  } else {
    const categories = {};
    products.forEach((p) => { categories[p.category] = (categories[p.category] || 0) + Number(p.quantity); });
    const alerts = products.filter((p) => p.quantity <= p.minimumQuantity);
    content.innerHTML = `<div class="page-head"><div><div class="eyebrow-dark">BUSINESS INSIGHTS</div><h1>Inventory Reports</h1><p>A summary of stock, sales and restocking needs.</p></div><button class="btn primary" onclick="exportCSV()">⇩ Export CSV</button></div>
      <div class="stats">${statCard("Inventory cost value", money(m.value), "Quantity × unit cost", "₦")}${statCard("Recorded sales", money(m.salesValue), "Gross recorded sales", "↗")}${statCard("Items needing attention", alerts.length, "Low or empty stock", "⚠")}</div>
      <section class="panel"><div class="panel-head"><div><h3>Quantity by category</h3><p>Available units grouped by category</p></div></div><div class="list">
        ${Object.entries(categories).length ? Object.entries(categories).map(([name, quantity]) => `<div class="list-row" style="display:block"><div style="display:flex;justify-content:space-between"><strong>${esc(name)}</strong><span>${quantity} units</span></div><div class="bar-line"><span style="width:${m.units ? Math.max(2, quantity / m.units * 100) : 0}%"></span></div></div>`).join("") : '<div class="empty">Add products to see category reports.</div>'}
      </div></section>
      <section class="panel"><div class="panel-head"><div><h3>Restocking list</h3><p>Products at or below their alert threshold</p></div></div><div class="table-wrap"><table><thead><tr><th>Product</th><th>Available</th><th>Alert level</th><th>Suggested to add</th><th>Status</th></tr></thead><tbody>
        ${alerts.length ? alerts.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.quantity}</td><td>${p.minimumQuantity}</td><td>${Math.max(0, p.minimumQuantity * 2 - p.quantity)} units</td><td>${stockStatus(p)}</td></tr>`).join("") : '<tr><td colspan="5"><div class="empty">No restocking needed based on current alert levels.</div></td></tr>'}
      </tbody></table></div></section>
      <p class="muted notice">Reports depend on the information entered into StockMaster and do not include unrecorded stock movements.</p>`;
  }
}

function salesTable(title, subtitle, list) {
  return `<section class="panel"><div class="panel-head"><div><h3>${title}</h3><p>${subtitle}</p></div></div><div class="table-wrap"><table><thead><tr><th>Product</th><th>Quantity sold</th><th>Unit price</th><th>Total</th><th>Date</th></tr></thead><tbody>
  ${list.length ? list.map((s) => `<tr><td><strong>${esc(s.productName)}</strong></td><td>${s.quantity}</td><td>${money(s.unitPrice)}</td><td><strong>${money(Number(s.quantity) * Number(s.unitPrice))}</strong></td><td>${esc(s.soldAt)}</td></tr>`).join("") : '<tr><td colspan="5"><div class="empty">No sales recorded yet.</div></td></tr>'}
  </tbody></table></div></section>`;
}

function goPage(nextPage) {
  page = nextPage;
  document.querySelectorAll("[data-page]").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  $("sidebar").classList.remove("open");
  renderPage();
}

function filterProducts() {
  const query = ($("productSearch")?.value || "").toLowerCase();
  const filter = $("stockFilter")?.value || "all";
  const filtered = products.filter((p) => {
    const matchesText = [p.name, p.sku, p.category].some((v) => String(v).toLowerCase().includes(query));
    const matchesStock = filter === "all" ||
      (filter === "low" && p.quantity > 0 && p.quantity <= p.minimumQuantity) ||
      (filter === "out" && p.quantity <= 0) ||
      (filter === "good" && p.quantity > p.minimumQuantity);
    return matchesText && matchesStock;
  });
  $("productRows").innerHTML = productRows(filtered);
}

function openModal(title, body, footer) {
  $("modalRoot").innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><section class="modal" role="dialog" aria-modal="true"><header class="modal-head"><h3>${title}</h3><button class="icon-btn" aria-label="Close" onclick="closeModal()">×</button></header><div class="modal-body">${body}</div><footer class="modal-foot">${footer}</footer></section></div>`;
}
function closeModal() { $("modalRoot").innerHTML = ""; }

function openProductModal(id = null) {
  const product = id === null ? null : products.find((p) => p.id === id);
  if (id !== null && !product) return toast("Product not found.");
  const p = product || {};
  openModal(product ? "Edit product" : "Add a product", `
    <form id="productForm">
      <div class="field"><label>Product name<input name="name" required maxlength="160" value="${esc(p.name || "")}" placeholder="e.g. Bag of rice"></label></div>
      <div class="form-grid">
        <div class="field"><label>SKU / product code<input name="sku" required maxlength="80" value="${esc(p.sku || `STK-${Date.now().toString().slice(-6)}`)}"></label></div>
        <div class="field"><label>Category<select name="category">${["Groceries", "Food & Drinks", "Drinks", "Electronics", "Household", "Other"].map((c) => `<option ${p.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></label></div>
        <div class="field"><label>Quantity on hand<input name="quantity" type="number" min="0" step="1" required value="${p.quantity ?? 0}"></label></div>
        <div class="field"><label>Low-stock alert at<input name="minimumQuantity" type="number" min="0" step="1" required value="${p.minimumQuantity ?? 5}"></label></div>
        <div class="field"><label>Unit cost (₦)<input name="unitCost" type="number" min="0" step="0.01" required value="${p.unitCost ?? 0}"></label></div>
        <div class="field"><label>Selling price (₦)<input name="sellingPrice" type="number" min="0" step="0.01" required value="${p.sellingPrice ?? 0}"></label></div>
      </div>
    </form>`, `<button class="btn outline" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveProduct(${id === null ? "null" : id})">Save product</button>`);
}

async function saveProduct(id) {
  const form = $("productForm");
  if (!form.reportValidity()) return;
  const formData = Object.fromEntries(new FormData(form));
  const payload = {
    name: formData.name.trim(), sku: formData.sku.trim(), category: formData.category,
    quantity: Number(formData.quantity), minimumQuantity: Number(formData.minimumQuantity),
    unitCost: Number(formData.unitCost), sellingPrice: Number(formData.sellingPrice)
  };
  try {
    await api(id === null ? "/products" : `/products/${id}`, {
      method: id === null ? "POST" : "PUT", body: JSON.stringify(payload)
    });
    closeModal();
    await refreshData();
    renderPage();
    toast(id === null ? "Product added successfully." : "Product updated.");
  } catch (error) { toast(error.message); }
}

function openStockModal(id) {
  const p = products.find((item) => item.id === id);
  if (!p) return;
  openModal("Add stock", `<p class="muted notice">Stock received is added to the quantity currently available.</p>
    <div class="field"><label>Product<input value="${esc(p.name)}" disabled></label></div>
    <div class="field"><label>Quantity received<input id="stockQuantity" type="number" min="1" step="1" value="1" required></label></div>
    <div class="field"><label>Current quantity<input value="${p.quantity} units" disabled></label></div>`,
    `<button class="btn outline" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveStock(${id})">Update stock</button>`);
}
async function saveStock(id) {
  const quantity = Number($("stockQuantity").value);
  if (!Number.isInteger(quantity) || quantity < 1) return toast("Enter a whole number greater than zero.");
  try {
    await api(`/products/${id}/stock`, { method: "POST", body: JSON.stringify({ quantity }) });
    closeModal(); await refreshData(); renderPage(); toast("Stock quantity updated.");
  } catch (error) { toast(error.message); }
}

function openSaleModal(id = null) {
  if (!products.length) return toast("Add a product before recording a sale.");
  const available = products.filter((p) => p.quantity > 0);
  if (!available.length) return toast("There is no stock available to sell.");
  const selected = available.find((p) => p.id === id) || available[0];
  openModal("Record a sale", `<p class="muted notice">The stock balance decreases when you save the sale.</p>
    <form id="saleForm">
      <div class="field"><label>Product<select id="saleProduct" name="productId" onchange="updateSalePrice()">${available.map((p) => `<option value="${p.id}" ${p.id === selected.id ? "selected" : ""}>${esc(p.name)} — ${p.quantity} available</option>`).join("")}</select></label></div>
      <div class="form-grid">
        <div class="field"><label>Quantity sold<input name="quantity" type="number" min="1" step="1" value="1" required></label></div>
        <div class="field"><label>Selling price per unit (₦)<input id="salePrice" name="unitPrice" type="number" min="0" step="0.01" value="${selected.sellingPrice}" required></label></div>
      </div>
      <p id="saleAvailable" class="notice">Available stock: ${selected.quantity} units.</p>
    </form>`, `<button class="btn outline" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveSale()">Save sale</button>`);
}
function updateSalePrice() {
  const product = products.find((p) => p.id === Number($("saleProduct").value));
  if (!product) return;
  $("salePrice").value = product.sellingPrice;
  $("saleAvailable").textContent = `Available stock: ${product.quantity} units.`;
}
async function saveSale() {
  const form = $("saleForm");
  if (!form.reportValidity()) return;
  const formData = Object.fromEntries(new FormData(form));
  try {
    await api("/sales", { method: "POST", body: JSON.stringify({
      productId: Number(formData.productId), quantity: Number(formData.quantity), unitPrice: Number(formData.unitPrice)
    }) });
    closeModal(); await refreshData(); renderPage(); toast("Sale saved. Stock balance updated.");
  } catch (error) { toast(error.message); }
}

async function deleteProduct(id) {
  const p = products.find((item) => item.id === id);
  if (!p || !confirm(`Delete "${p.name}" from your inventory? Past sales will remain in history.`)) return;
  try {
    await api(`/products/${id}`, { method: "DELETE" });
    await refreshData(); renderPage(); toast("Product deleted.");
  } catch (error) { toast(error.message); }
}

function exportCSV() {
  if (!products.length) return toast("There are no products to export.");
  const rows = [["Product", "SKU", "Category", "Quantity", "Low stock alert", "Unit cost (NGN)", "Selling price (NGN)", "Status"],
    ...products.map((p) => [p.name, p.sku, p.category, p.quantity, p.minimumQuantity, p.unitCost, p.sellingPrice,
      p.quantity <= 0 ? "Out of stock" : p.quantity <= p.minimumQuantity ? "Low stock" : "In stock"])];
  const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "stockmaster-inventory.csv"; anchor.click();
  URL.revokeObjectURL(url);
  toast("Inventory CSV exported.");
}

(async function init() {
  if (token) await openApp();
  else showAuth("login");
})();
