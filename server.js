const http = require("http")
const fs = require("fs")
const path = require("path")
const { URL } = require("url")

loadEnvFile(path.join(__dirname, ".env"))

const PORT = process.env.PORT || 3000
const ROOT = __dirname
const DATA_DIR = resolveDataDir()
const STORE_FILE = path.join(DATA_DIR, "store.json")
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ""
const ADMIN_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL || "")

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
}

const COLLECTION_MAP = {
  campaigns: "campaigns",
  "scheduler-rules": "schedulerRules",
  accounts: "accounts",
  groups: "groups",
  templates: "templates",
  media: "mediaItems",
  "ai-drafts": "aiDrafts",
  leads: "leads",
  inbox: "inboxMessages",
  team: "teamMembers",
  support: "supportTickets",
  logs: "logs",
}

ensureStore()

const requestListener = async (req, res) => {
  setCorsHeaders(res)

  if (req.method === "OPTIONS") {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)

  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url).catch((error) => {
      sendJson(res, 500, { error: "Server error", detail: error.message })
    })
    return
  }

  serveStatic(url.pathname, res)
}

const server = http.createServer(requestListener)

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`UniSolveX Pilot server running on http://localhost:${PORT}`)
  })
}

function resolveDataDir() {
  if (process.env.VERCEL) {
    return path.join("/tmp", "unisolvex-pilot-data")
  }
  return path.join(ROOT, "data")
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIndex = trimmed.indexOf("=")
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const rawValue = trimmed.slice(eqIndex + 1).trim()
    if (!key || process.env[key]) continue
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "")
  }
}

function createDefaultStore() {
  return {
    settings: {
      projectName: "UniSolveX Pilot",
      slogan: "Automate. Reach. Grow.",
      workspaceEmail: "",
      adminEmails: ADMIN_EMAIL ? [ADMIN_EMAIL] : [],
      billing: {
        planName: "Starter",
        renewalDate: "",
        amount: "",
        status: "inactive",
      },
      firebase: {
        apiKey: "",
        authDomain: "",
        projectId: "",
        storageBucket: "",
        messagingSenderId: "",
        appId: "",
        measurementId: "",
      },
      cloudinary: {
        cloudName: "",
        uploadPreset: "",
        folder: "unisolvex-pilot",
      },
    },
    campaigns: [],
    schedulerRules: [],
    accounts: [],
    groups: [],
    templates: [],
    mediaItems: [],
    aiDrafts: [],
    leads: [],
    inboxMessages: [],
    teamMembers: [],
    supportTickets: [],
    logs: [],
  }
}

function getEnvSettings() {
  return {
    firebase: {
      apiKey: process.env.FIREBASE_API_KEY || "",
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
      projectId: process.env.FIREBASE_PROJECT_ID || "",
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
      appId: process.env.FIREBASE_APP_ID || "",
      measurementId: process.env.FIREBASE_MEASUREMENT_ID || "",
    },
    cloudinary: {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
      uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET || "",
      folder: process.env.CLOUDINARY_FOLDER || "unisolvex-pilot",
    },
  }
}

function mergeSettings(baseSettings = {}) {
  const defaults = createDefaultStore().settings
  const envSettings = getEnvSettings()

  return {
    ...defaults,
    ...baseSettings,
    adminEmails: uniqueEmails([
      ...(defaults.adminEmails || []),
      ...(Array.isArray(baseSettings.adminEmails) ? baseSettings.adminEmails : []),
      ADMIN_EMAIL,
      baseSettings.workspaceEmail,
    ]),
    billing: {
      ...defaults.billing,
      ...(baseSettings.billing || {}),
    },
    firebase: {
      ...defaults.firebase,
      ...(baseSettings.firebase || {}),
      ...pickDefined(envSettings.firebase),
    },
    cloudinary: {
      ...defaults.cloudinary,
      ...(baseSettings.cloudinary || {}),
      ...pickDefined(envSettings.cloudinary),
    },
  }
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  if (!fs.existsSync(STORE_FILE)) {
    writeStore(createDefaultStore())
    return
  }

  const normalized = readStore()
  writeStore(normalized)
}

function readStore() {
  const defaults = createDefaultStore()
  const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"))

  return {
    ...defaults,
    ...parsed,
    settings: mergeSettings(parsed.settings),
    campaigns: Array.isArray(parsed.campaigns) ? parsed.campaigns : [],
    schedulerRules: Array.isArray(parsed.schedulerRules) ? parsed.schedulerRules : [],
    accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    groups: Array.isArray(parsed.groups) ? parsed.groups : [],
    templates: Array.isArray(parsed.templates) ? parsed.templates : [],
    mediaItems: Array.isArray(parsed.mediaItems) ? parsed.mediaItems : [],
    aiDrafts: Array.isArray(parsed.aiDrafts) ? parsed.aiDrafts : [],
    leads: Array.isArray(parsed.leads) ? parsed.leads : [],
    inboxMessages: Array.isArray(parsed.inboxMessages) ? parsed.inboxMessages : [],
    teamMembers: Array.isArray(parsed.teamMembers) ? parsed.teamMembers : [],
    supportTickets: Array.isArray(parsed.supportTickets) ? parsed.supportTickets : [],
    logs: Array.isArray(parsed.logs) ? parsed.logs : [],
  }
}

function writeStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2))
}

function pickDefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== ""))
}

function uniqueEmails(values) {
  return [...new Set(values.map(normalizeEmail).filter(Boolean))]
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase()
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-User-Email")
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(payload))
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ""
    req.on("data", (chunk) => {
      body += chunk.toString()
    })
    req.on("end", () => {
      if (!body) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(body))
      } catch (error) {
        reject(new Error("Invalid JSON body"))
      }
    })
  })
}

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function addLog(store, { type, message, status = "info", meta = {} }) {
  store.logs.unshift({
    id: generateId("log"),
    type,
    message,
    status,
    meta,
    createdAt: new Date().toISOString(),
  })

  store.logs = store.logs.slice(0, 300)
}

function getRequester(req, store) {
  const email = normalizeEmail(req.headers["x-user-email"])
  return {
    email,
    role: resolveUserRole(store, email),
    isAdmin: resolveUserRole(store, email) === "admin",
  }
}

function resolveUserRole(store, email) {
  if (!email) return "guest"

  const adminEmails = uniqueEmails([
    ...(store.settings.adminEmails || []),
    store.settings.workspaceEmail,
    ADMIN_EMAIL,
  ])

  if (adminEmails.includes(email)) return "admin"

  const member = store.teamMembers.find((item) => normalizeEmail(item.email) === email)
  if (!member) return "executive"

  return String(member.role || "executive").trim().toLowerCase() === "admin" ? "admin" : "executive"
}

function requireAdmin(res, requester) {
  if (requester.isAdmin) return true
  sendJson(res, 403, { error: "Admin access required" })
  return false
}

function createLocalAiDraft(payload) {
  const topic = payload.topic || "your offer"
  const audience = payload.audience || "your audience"
  const tone = payload.tone || "premium"
  const cta = payload.ctaGoal || "Message us today"
  const emojiStyle = payload.emojiStyle || "balanced"
  const prefix = emojiStyle === "high" ? "[boosted]" : emojiStyle === "low" ? "[clean]" : "[smart]"
  const words = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((item) => `#${item}`)

  return {
    caption: `${prefix} ${topic} is ready for ${audience}. This ${tone} campaign message is written to feel direct, premium, and conversion-focused.`,
    cta,
    hashtags: [...new Set([...words, "#marketing", "#automation", "#growth"])].join(" "),
    variations: [
      `${topic} is now open for ${audience}. ${cta}.`,
      `Ready to convert faster? Promote ${topic} to ${audience}. ${cta}.`,
      `Make your next campaign sharper with ${topic} for ${audience}. ${cta}.`,
    ],
    provider: "local",
  }
}

async function generateAiDraft(payload) {
  if (!GEMINI_API_KEY) {
    return createLocalAiDraft(payload)
  }

  const prompt = [
    "Write a high-converting marketing draft as valid JSON.",
    "Return only JSON with keys: caption, cta, hashtags, variations.",
    `Topic: ${payload.topic || ""}`,
    `Audience: ${payload.audience || ""}`,
    `Tone: ${payload.tone || ""}`,
    `Emoji style: ${payload.emojiStyle || ""}`,
    `CTA goal: ${payload.ctaGoal || ""}`,
    "Caption should feel modern and premium.",
    "Hashtags should be space separated.",
    "Variations should be an array of exactly 3 short alternatives.",
  ].join("\n")

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          responseMimeType: "application/json",
        },
      }),
    })

    const payloadJson = await response.json()
    const rawText = payloadJson.candidates?.[0]?.content?.parts?.[0]?.text || ""
    if (!response.ok || !rawText) {
      throw new Error(payloadJson.error?.message || "AI generation failed")
    }

    const parsed = JSON.parse(rawText)
    return {
      caption: String(parsed.caption || "").trim(),
      cta: String(parsed.cta || payload.ctaGoal || "").trim(),
      hashtags: String(parsed.hashtags || "").trim(),
      variations: Array.isArray(parsed.variations) ? parsed.variations.slice(0, 3) : [],
      provider: "gemini",
    }
  } catch (error) {
    return {
      ...createLocalAiDraft(payload),
      provider: "local-fallback",
    }
  }
}

function buildDashboard(store) {
  const activeCampaigns = store.campaigns.filter((item) => item.status === "active").length
  const scheduledPosts = store.schedulerRules.filter((item) => item.status !== "archived").length
  const connectedGroups = store.groups.length
  const failedLogs = store.logs.filter((item) => item.status === "failed").length
  const successLogs = store.logs.filter((item) => item.status === "success").length
  const successRate =
    successLogs + failedLogs === 0 ? 0 : Math.round((successLogs / (successLogs + failedLogs)) * 100)

  const platformCounts = {}
  for (const item of [...store.accounts, ...store.groups]) {
    const platform = item.platform || "other"
    platformCounts[platform] = (platformCounts[platform] || 0) + 1
  }

  const platformStats = Object.entries(platformCounts)
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count)

  return {
    stats: {
      activeCampaigns,
      scheduledPosts,
      connectedGroups,
      failedLogs,
      successRate,
      aiDrafts: store.aiDrafts.length,
      inboxCount: store.inboxMessages.length,
      leadsCount: store.leads.length,
      openTickets: store.supportTickets.filter((item) => item.status !== "resolved").length,
    },
    platformStats,
    recentLogs: store.logs.slice(0, 8),
    upcomingQueue: store.schedulerRules
      .filter((rule) => ["running", "queued", "paused"].includes(rule.status))
      .slice(0, 8),
  }
}

async function handleApi(req, res, url) {
  const store = readStore()
  const requester = getRequester(req, store)

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    sendJson(res, 200, {
      dashboard: buildDashboard(store),
      campaigns: store.campaigns,
      schedulerRules: store.schedulerRules,
      accounts: store.accounts,
      groups: store.groups,
      templates: store.templates,
      mediaItems: store.mediaItems,
      aiDrafts: store.aiDrafts,
      leads: store.leads,
      inboxMessages: store.inboxMessages,
      teamMembers: store.teamMembers,
      supportTickets: store.supportTickets,
      logs: store.logs,
      settings: store.settings,
      session: {
        email: requester.email,
        role: requester.role,
        isAdmin: requester.isAdmin,
      },
      integrations: {
        aiProvider: GEMINI_API_KEY ? "gemini" : "local",
      },
    })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === "POST" && url.pathname === "/api/ai/generate") {
    const payload = await parseBody(req)
    const generated = await generateAiDraft(payload)
    const draft = {
      id: generateId("ai"),
      topic: payload.topic || "",
      audience: payload.audience || "",
      tone: payload.tone || "",
      emojiStyle: payload.emojiStyle || "",
      ctaGoal: payload.ctaGoal || "",
      ...generated,
      createdAt: new Date().toISOString(),
    }
    store.aiDrafts.unshift(draft)
    addLog(store, {
      type: "ai",
      status: "success",
      message: `AI draft generated for ${draft.topic || "new topic"}`,
      meta: { draftId: draft.id, provider: draft.provider },
    })
    writeStore(store)
    sendJson(res, 201, draft)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/campaigns") {
    const payload = await parseBody(req)
    const record = {
      id: generateId("campaign"),
      name: payload.name || "",
      description: payload.description || "",
      platforms: Array.isArray(payload.platforms) ? payload.platforms : [],
      caption: payload.caption || "",
      cta: payload.cta || "",
      mediaUrl: payload.mediaUrl || "",
      status: payload.status || "draft",
      createdBy: requester.email || "",
      createdAt: new Date().toISOString(),
    }
    store.campaigns.unshift(record)
    addLog(store, {
      type: "campaign",
      status: "success",
      message: `Campaign created: ${record.name || "Untitled campaign"}`,
      meta: { campaignId: record.id },
    })
    writeStore(store)
    sendJson(res, 201, record)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/scheduler-rules") {
    const payload = await parseBody(req)
    const days = Array.isArray(payload.days) ? payload.days : []
    const allDays = Boolean(payload.allDays) || days.includes("all_days")
    const normalizedDays = allDays
      ? ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
      : days.filter(Boolean)

    const record = {
      id: generateId("rule"),
      name: payload.name || "",
      campaignId: payload.campaignId || "",
      mode: payload.mode || "interval",
      intervalMinutes: payload.intervalMinutes || "",
      dailyTime: payload.dailyTime || "",
      weeklyDay: payload.weeklyDay || "",
      days: normalizedDays,
      allDays,
      randomDelaySeconds: payload.randomDelaySeconds || "",
      status: payload.status || "queued",
      createdBy: requester.email || "",
      createdAt: new Date().toISOString(),
    }
    store.schedulerRules.unshift(record)
    addLog(store, { type: "scheduler", status: "success", message: `Scheduler rule saved: ${record.name || "Unnamed rule"}` })
    writeStore(store)
    sendJson(res, 201, record)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/accounts") {
    const payload = await parseBody(req)
    const record = {
      id: generateId("account"),
      platform: payload.platform || "",
      accountName: payload.accountName || "",
      accountHandle: payload.accountHandle || "",
      status: payload.status || "connected",
      createdAt: new Date().toISOString(),
    }
    store.accounts.unshift(record)
    addLog(store, { type: "account", status: "success", message: `Account connected: ${record.accountName || "new account"}` })
    writeStore(store)
    sendJson(res, 201, record)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/groups") {
    const payload = await parseBody(req)
    const record = {
      id: generateId("group"),
      name: payload.name || "",
      platform: payload.platform || "",
      inviteLink: payload.inviteLink || "",
      categoryTags: Array.isArray(payload.categoryTags) ? payload.categoryTags : [],
      status: payload.status || "connected",
      createdAt: new Date().toISOString(),
    }
    store.groups.unshift(record)
    addLog(store, { type: "group", status: "success", message: `Group connected: ${record.name || "new group"}` })
    writeStore(store)
    sendJson(res, 201, record)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/templates") {
    const payload = await parseBody(req)
    const record = {
      id: generateId("template"),
      title: payload.title || "",
      channel: payload.channel || "",
      body: payload.body || "",
      createdAt: new Date().toISOString(),
    }
    store.templates.unshift(record)
    addLog(store, { type: "template", status: "success", message: `Template saved: ${record.title || "new template"}` })
    writeStore(store)
    sendJson(res, 201, record)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/media") {
    const payload = await parseBody(req)
    const record = {
      id: generateId("media"),
      name: payload.name || "",
      type: payload.type || "",
      url: payload.url || "",
      createdAt: new Date().toISOString(),
    }
    store.mediaItems.unshift(record)
    addLog(store, { type: "media", status: "success", message: `Media item added: ${record.name || "new media"}` })
    writeStore(store)
    sendJson(res, 201, record)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/leads") {
    const payload = await parseBody(req)
    const record = {
      id: generateId("lead"),
      name: payload.name || "",
      source: payload.source || "",
      stage: payload.stage || "new",
      contact: payload.contact || "",
      note: payload.note || "",
      createdAt: new Date().toISOString(),
    }
    store.leads.unshift(record)
    addLog(store, { type: "lead", status: "success", message: `Lead added: ${record.name || "new lead"}` })
    writeStore(store)
    sendJson(res, 201, record)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/inbox") {
    const payload = await parseBody(req)
    const record = {
      id: generateId("message"),
      sender: payload.sender || "",
      platform: payload.platform || "",
      message: payload.message || "",
      status: payload.status || "unread",
      createdAt: new Date().toISOString(),
    }
    store.inboxMessages.unshift(record)
    addLog(store, { type: "inbox", status: "success", message: `Inbox message added from ${record.sender || "new sender"}` })
    writeStore(store)
    sendJson(res, 201, record)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/team") {
    if (!requireAdmin(res, requester)) return
    const payload = await parseBody(req)
    const role = String(payload.role || "executive").trim().toLowerCase()
    const record = {
      id: generateId("team"),
      name: payload.name || "",
      role: role === "admin" ? "admin" : "executive",
      email: normalizeEmail(payload.email),
      status: payload.status || "active",
      createdAt: new Date().toISOString(),
    }
    store.teamMembers = store.teamMembers.filter((item) => normalizeEmail(item.email) !== record.email)
    store.teamMembers.unshift(record)
    addLog(store, { type: "team", status: "success", message: `Team member added: ${record.name || "new member"}` })
    writeStore(store)
    sendJson(res, 201, record)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/support") {
    const payload = await parseBody(req)
    const record = {
      id: generateId("support"),
      subject: payload.subject || "",
      priority: payload.priority || "medium",
      description: payload.description || "",
      status: "open",
      createdBy: requester.email || "",
      updatedBy: requester.email || "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    store.supportTickets.unshift(record)
    addLog(store, { type: "support", status: "success", message: `Support ticket created: ${record.subject || "new ticket"}` })
    writeStore(store)
    sendJson(res, 201, record)
    return
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/support/")) {
    if (!requireAdmin(res, requester)) return
    const itemId = url.pathname.split("/")[3]
    const payload = await parseBody(req)
    const ticket = store.supportTickets.find((item) => item.id === itemId)

    if (!ticket) {
      sendJson(res, 404, { error: "Ticket not found" })
      return
    }

    ticket.status = payload.status || ticket.status
    ticket.updatedBy = requester.email || ticket.updatedBy || ""
    ticket.updatedAt = new Date().toISOString()
    addLog(store, { type: "support", status: "success", message: `Ticket updated: ${ticket.subject || "ticket"}` })
    writeStore(store)
    sendJson(res, 200, ticket)
    return
  }

  if (req.method === "PUT" && url.pathname === "/api/settings") {
    if (!requireAdmin(res, requester)) return
    const payload = await parseBody(req)
    store.settings = mergeSettings({
      ...store.settings,
      ...payload,
      billing: {
        ...store.settings.billing,
        ...(payload.billing || {}),
      },
      firebase: {
        ...store.settings.firebase,
        ...(payload.firebase || {}),
      },
      cloudinary: {
        ...store.settings.cloudinary,
        ...(payload.cloudinary || {}),
      },
      adminEmails: uniqueEmails([
        ...(store.settings.adminEmails || []),
        ...(Array.isArray(payload.adminEmails) ? payload.adminEmails : []),
        payload.workspaceEmail,
      ]),
    })
    addLog(store, { type: "settings", status: "success", message: "Workspace settings updated" })
    writeStore(store)
    sendJson(res, 200, store.settings)
    return
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/")) {
    const [, , collection, itemId] = url.pathname.split("/")
    const key = COLLECTION_MAP[collection]
    if (!key || !itemId) {
      sendJson(res, 404, { error: "Unknown delete target" })
      return
    }

    if (["team"].includes(collection) && !requireAdmin(res, requester)) return

    const before = store[key].length
    store[key] = store[key].filter((item) => item.id !== itemId)
    if (store[key].length === before) {
      sendJson(res, 404, { error: "Item not found" })
      return
    }
    addLog(store, { type: collection, status: "info", message: `${collection} item deleted`, meta: { itemId } })
    writeStore(store)
    sendJson(res, 200, { ok: true })
    return
  }

  sendJson(res, 404, { error: "Route not found" })
}

function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? "/index.html" : pathname
  const filePath = path.join(ROOT, safePath)

  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
    res.end("Not found")
    return
  }

  const ext = path.extname(filePath)
  res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" })
  fs.createReadStream(filePath).pipe(res)
}

module.exports = {
  requestListener,
  handleApi,
}
