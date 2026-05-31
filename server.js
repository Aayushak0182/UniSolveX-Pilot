const http = require("http")
const fs = require("fs")
const path = require("path")
const { URL } = require("url")
let firebaseAdmin = null
try {
  firebaseAdmin = require("firebase-admin")
} catch (error) {
  firebaseAdmin = null
}
const { TelegramClient, Api } = require("telegram")
const { StringSession } = require("telegram/sessions")
const WEEK_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

loadEnvFile(path.join(__dirname, ".env"))

const PORT = process.env.PORT || 3000
const ROOT = __dirname
const DATA_DIR = resolveDataDir()
const STORE_FILE = path.join(DATA_DIR, "store.json")
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ""
const ADMIN_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL || "")
const CLOUD_STORE_REF = initializeCloudStore()

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
  "telegram-dispatches": "telegramDispatches",
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

function initializeCloudStore() {
  if (!firebaseAdmin) return null

  try {
    if (!firebaseAdmin.apps.length) {
      const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || ""
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || ""
      const privateKey = process.env.FIREBASE_PRIVATE_KEY || ""
      const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || ""

      if (serviceAccountJson) {
        firebaseAdmin.initializeApp({
          credential: firebaseAdmin.credential.cert(JSON.parse(serviceAccountJson)),
        })
      } else if (clientEmail && privateKey && projectId) {
        firebaseAdmin.initializeApp({
          credential: firebaseAdmin.credential.cert({
            projectId,
            clientEmail,
            privateKey: privateKey.replace(/\\n/g, "\n"),
          }),
        })
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_CONFIG) {
        firebaseAdmin.initializeApp()
      } else {
        return null
      }
    }

    return firebaseAdmin.firestore().collection("server_workspace").doc("default")
  } catch (error) {
    console.warn("Cloud store disabled:", error.message)
    return null
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
    telegramDispatches: [],
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
    writeLocalStore(createDefaultStore())
    return
  }

  writeLocalStore(readLocalStore())
}

function readLocalStore() {
  const parsed = fs.existsSync(STORE_FILE) ? JSON.parse(fs.readFileSync(STORE_FILE, "utf8")) : {}
  return normalizeStore(parsed)
}

function writeLocalStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(normalizeStore(store), null, 2))
}

async function readStore() {
  const localStore = readLocalStore()

  if (!CLOUD_STORE_REF) {
    return localStore
  }

  try {
    const snapshot = await CLOUD_STORE_REF.get()
    if (!snapshot.exists) {
      await CLOUD_STORE_REF.set(localStore)
      return localStore
    }

    return normalizeStore(snapshot.data() || {})
  } catch (error) {
    console.warn("Cloud store read failed, using local fallback:", error.message)
    return localStore
  }
}

async function writeStore(store) {
  const normalized = normalizeStore(store)

  if (!process.env.VERCEL) {
    writeLocalStore(normalized)
  }

  if (CLOUD_STORE_REF) {
    try {
      await CLOUD_STORE_REF.set(normalized)
    } catch (error) {
      console.warn("Cloud store write failed, using local store only:", error.message)
    }
  } else if (process.env.VERCEL) {
    writeLocalStore(normalized)
  }
}

function normalizeStore(parsed = {}) {
  const defaults = createDefaultStore()

  return {
    ...defaults,
    ...parsed,
    settings: mergeSettings(parsed.settings),
    campaigns: Array.isArray(parsed.campaigns) ? parsed.campaigns : [],
    schedulerRules: Array.isArray(parsed.schedulerRules) ? parsed.schedulerRules : [],
    accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    groups: Array.isArray(parsed.groups) ? parsed.groups : [],
    telegramDispatches: Array.isArray(parsed.telegramDispatches) ? parsed.telegramDispatches : [],
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

function sanitizeApiId(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10)
  return Number.isFinite(parsed) ? parsed : ""
}

function maskSecret(value) {
  const text = String(value || "")
  if (!text) return ""
  if (text.length <= 6) return "*".repeat(text.length)
  return `${text.slice(0, 3)}${"*".repeat(Math.max(3, text.length - 6))}${text.slice(-3)}`
}

function sanitizeAccountForClient(account = {}) {
  return {
    ...account,
    apiHash: undefined,
    sessionString: undefined,
    pendingSessionString: undefined,
    pendingPhoneCodeHash: undefined,
    pendingPhoneNumber: undefined,
    apiHashMasked: maskSecret(account.apiHash),
    isTelegramConnected: account.sessionStatus === "connected",
  }
}

function sanitizeGroupForClient(group = {}) {
  return {
    ...group,
    telegramPeer: group.telegramPeer || "",
  }
}

function getTelegramApiCredentials(account) {
  return {
    apiId: Number(account.apiId),
    apiHash: String(account.apiHash || "").trim(),
  }
}

async function createTelegramClient(sessionString, account) {
  const credentials = getTelegramApiCredentials(account)
  if (!credentials.apiId || !credentials.apiHash) {
    throw new Error("Telegram API credentials are missing for this account")
  }

  return new TelegramClient(new StringSession(String(sessionString || "")), credentials.apiId, credentials.apiHash, {
    connectionRetries: 5,
  })
}

async function safelyDisconnectTelegramClient(client) {
  if (!client) return
  try {
    await client.disconnect()
  } catch (error) {
    console.warn("Telegram disconnect failed", error)
  }
}

function normalizeTelegramPeer(value) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  const urlMatch = raw.match(/https?:\/\/t\.me\/[^\s]+/i)
  const usernameMatch = raw.match(/@[a-zA-Z0-9_]{4,}/)
  const candidate = urlMatch?.[0] || usernameMatch?.[0] || raw.split(/\s+/)[0]

  if (/^https?:\/\/t\.me\/(\+|joinchat\/)/i.test(candidate)) {
    return candidate.replace(/[)\],.!?]+$/g, "")
  }

  if (candidate.startsWith("https://t.me/")) {
    return candidate.replace("https://t.me/", "@").replace(/\/+$/, "").replace(/[)\],.!?]+$/g, "")
  }
  if (candidate.startsWith("http://t.me/")) {
    return candidate.replace("http://t.me/", "@").replace(/\/+$/, "").replace(/[)\],.!?]+$/g, "")
  }
  return candidate.replace(/[)\],.!?]+$/g, "")
}

function extractTelegramInviteHash(value) {
  const normalized = String(value || "").trim()
  const plusMatch = normalized.match(/t\.me\/\+([a-zA-Z0-9_-]+)/i)
  if (plusMatch) return plusMatch[1]
  const joinChatMatch = normalized.match(/t\.me\/joinchat\/([a-zA-Z0-9_-]+)/i)
  if (joinChatMatch) return joinChatMatch[1]
  return ""
}

async function resolveTelegramTargetEntity(client, targetPeer) {
  const normalized = normalizeTelegramPeer(targetPeer)
  if (!normalized) {
    throw new Error("Telegram target peer is empty")
  }

  try {
    return await client.getInputEntity(normalized)
  } catch (primaryError) {
    const inviteHash = extractTelegramInviteHash(normalized)
    if (!inviteHash) {
      throw primaryError
    }

    try {
      const invite = await client.invoke(new Api.messages.CheckChatInvite({ hash: inviteHash }))
      if (invite?.chat) {
        return await client.getInputEntity(invite.chat)
      }
    } catch (inviteError) {
      throw primaryError
    }

    throw primaryError
  }
}

function resolveTelegramAccount(store, payload = {}) {
  const requestedId = String(payload.accountId || "").trim()
  const requestedPhone = normalizePhoneNumber(payload.accountPhoneNumber || "")
  const requestedName = String(payload.accountName || "").trim().toLowerCase()
  const telegramAccounts = store.accounts.filter((item) => item.platform === "telegram")

  if (!requestedId && !requestedPhone && !requestedName && telegramAccounts.length === 1) {
    return telegramAccounts[0]
  }

  return telegramAccounts.find((item) => {
    if (requestedId && item.id === requestedId) return true
    if (requestedPhone && normalizePhoneNumber(item.phoneNumber || "") === requestedPhone) return true
    if (requestedName && String(item.accountName || "").trim().toLowerCase() === requestedName) return true
    return false
  })
}

function normalizePhoneNumber(value) {
  return String(value || "").replace(/[^\d+]/g, "")
}

function describeTelegramSendError(error, targetPeer) {
  const code = Number(error?.code || 0)
  const message = String(error?.errorMessage || error?.message || "").trim()

  if (message.includes("CHAT_WRITE_FORBIDDEN")) {
    return {
      statusCode: 403,
      error: `Aapke Telegram account ko ${targetPeer} me post permission nahi hai. Admin rights dijiye ya dusra group select kijiye.`,
      telegramCode: "CHAT_WRITE_FORBIDDEN",
    }
  }

  if (message.includes("CHANNEL_PRIVATE")) {
    return {
      statusCode: 403,
      error: `${targetPeer} private ya inaccessible hai. Invite/link/username verify kijiye.`,
      telegramCode: "CHANNEL_PRIVATE",
    }
  }

  if (message.includes("USERNAME_INVALID") || message.includes("PEER_ID_INVALID")) {
    return {
      statusCode: 400,
      error: `${targetPeer} valid Telegram target nahi hai. Username ya peer dobara check kijiye.`,
      telegramCode: "INVALID_TARGET",
    }
  }

  return {
    statusCode: code >= 400 && code < 600 ? code : 500,
    error: message || `Telegram send failed for ${targetPeer}`,
    telegramCode: "SEND_FAILED",
  }
}

function sanitizeTelegramSecretPayload(payload = {}) {
  return {
    phoneNumber: normalizePhoneNumber(payload.phoneNumber || payload.accountPhoneNumber || ""),
    apiId: sanitizeApiId(payload.apiId),
    apiHash: String(payload.apiHash || "").trim(),
    sessionString: String(payload.sessionString || "").trim(),
    pendingSessionString: String(payload.pendingSessionString || "").trim(),
    pendingPhoneCodeHash: String(payload.pendingPhoneCodeHash || "").trim(),
    pendingPhoneNumber: normalizePhoneNumber(payload.pendingPhoneNumber || ""),
    sessionStatus: String(payload.sessionStatus || "").trim(),
    telegramLastVerifiedAt: String(payload.telegramLastVerifiedAt || "").trim(),
    telegramLastPostedAt: String(payload.telegramLastPostedAt || "").trim(),
  }
}

function buildTelegramState(account = {}) {
  return {
    phoneNumber: account.phoneNumber || "",
    apiId: sanitizeApiId(account.apiId),
    apiHash: account.apiHash || "",
    sessionString: account.sessionString || "",
    pendingSessionString: account.pendingSessionString || "",
    pendingPhoneCodeHash: account.pendingPhoneCodeHash || "",
    pendingPhoneNumber: account.pendingPhoneNumber || "",
    sessionStatus: account.sessionStatus || "",
    telegramLastVerifiedAt: account.telegramLastVerifiedAt || "",
    telegramLastPostedAt: account.telegramLastPostedAt || "",
  }
}

function mergeTelegramAccountData(target = {}, payload = {}) {
  const secure = sanitizeTelegramSecretPayload(payload)
  return {
    ...target,
    phoneNumber: secure.phoneNumber || target.phoneNumber || "",
    apiId: secure.apiId || target.apiId || "",
    apiHash: secure.apiHash || target.apiHash || "",
    sessionString: secure.sessionString || target.sessionString || "",
    pendingSessionString: secure.pendingSessionString || target.pendingSessionString || "",
    pendingPhoneCodeHash: secure.pendingPhoneCodeHash || target.pendingPhoneCodeHash || "",
    pendingPhoneNumber: secure.pendingPhoneNumber || target.pendingPhoneNumber || "",
    sessionStatus: secure.sessionStatus || target.sessionStatus || "",
    telegramLastVerifiedAt: secure.telegramLastVerifiedAt || target.telegramLastVerifiedAt || "",
    telegramLastPostedAt: secure.telegramLastPostedAt || target.telegramLastPostedAt || "",
  }
}

function resolveOrHydrateTelegramAccount(store, payload = {}) {
  const existing = resolveTelegramAccount(store, payload)
  if (existing) {
    Object.assign(existing, mergeTelegramAccountData(existing, payload))
    return existing
  }

  const secure = sanitizeTelegramSecretPayload(payload)
  const requestedId = String(payload.accountId || "").trim()
  if (!requestedId || !secure.apiId || !secure.apiHash) return null

  const restored = {
    id: requestedId,
    platform: "telegram",
    accountName: String(payload.accountName || "Telegram").trim(),
    accountHandle: String(payload.accountHandle || "").trim(),
    status: String(payload.status || "connected").trim() || "connected",
    createdAt: new Date().toISOString(),
    ...secure,
  }
  store.accounts.unshift(restored)
  return restored
}

function createSchedulerMessage(store, rule) {
  const campaign = store.campaigns.find((item) => item.id === rule.campaignId)
  const template = store.templates.find((item) => item.id === rule.templateId)
  const parts = []
  if (template?.title) parts.push(template.title)
  if (template?.body) parts.push(template.body)
  if (campaign?.name) parts.push(campaign.name)
  if (campaign?.description) parts.push(campaign.description)
  if (campaign?.caption) parts.push(campaign.caption)
  if (campaign?.cta) parts.push(`CTA: ${campaign.cta}`)
  return parts.filter(Boolean).join("\n\n").trim()
}

function getSchedulerTargets(store, rule) {
  const telegramGroups = store.groups.filter((item) => item.platform === "telegram" && (item.telegramPeer || item.inviteLink))
  if (!telegramGroups.length) return []

  const batchSize = Math.min(Math.max(Number(rule.batchSize) || 35, 1), 40)
  const cursor = Math.max(Number(rule.lastGroupCursor) || 0, 0)
  const items = []
  for (let index = 0; index < Math.min(batchSize, telegramGroups.length); index += 1) {
    items.push(telegramGroups[(cursor + index) % telegramGroups.length])
  }
  return items
}

function isRuleDue(rule, now = new Date()) {
  if (!rule || !["queued", "running"].includes(rule.status)) return false
  const nextRunAt = rule.nextRunAt ? new Date(rule.nextRunAt) : null
  if (nextRunAt && nextRunAt.getTime() > now.getTime()) return false

  if (rule.mode === "interval") {
    return true
  }

  const today = WEEK_DAYS[now.getDay() === 0 ? 6 : now.getDay() - 1]
  if (Array.isArray(rule.days) && rule.days.length && !rule.days.includes(today)) return false

  if (rule.dailyTime) {
    const [hours, minutes] = String(rule.dailyTime).split(":").map((value) => Number(value) || 0)
    const scheduledAt = new Date(now)
    scheduledAt.setHours(hours, minutes, 0, 0)
    const lastRunAt = rule.lastRunAt ? new Date(rule.lastRunAt) : null
    return scheduledAt.getTime() <= now.getTime() && (!lastRunAt || lastRunAt.getTime() < scheduledAt.getTime())
  }

  return true
}

function calculateNextRunAt(rule, now = new Date()) {
  if (rule.mode === "interval") {
    const intervalMinutes = Math.max(Number(rule.intervalMinutes) || 1, 1)
    return new Date(now.getTime() + (intervalMinutes * 60000)).toISOString()
  }

  const next = new Date(now)
  next.setDate(next.getDate() + 1)
  if (rule.dailyTime) {
    const [hours, minutes] = String(rule.dailyTime).split(":").map((value) => Number(value) || 0)
    next.setHours(hours, minutes, 0, 0)
  }
  return next.toISOString()
}

async function processDueSchedulerRules(store) {
  const now = new Date()
  let processedCount = 0

  for (const rule of store.schedulerRules) {
    if (!isRuleDue(rule, now)) continue

    const account = resolveTelegramAccount(store, { accountId: rule.accountId }) || store.accounts.find((item) => item.platform === "telegram" && item.sessionString)
    const message = createSchedulerMessage(store, rule)
    const targets = getSchedulerTargets(store, rule)

    if (!account || !account.sessionString || !message || !targets.length) continue

    const client = await createTelegramClient(account.sessionString, account)
    try {
      await client.connect()
      if (!await client.isUserAuthorized()) {
        account.sessionStatus = "expired"
        continue
      }

      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index]
        const targetPeer = normalizeTelegramPeer(target.telegramPeer || target.inviteLink)
        if (!targetPeer) continue
        try {
          const entity = await resolveTelegramTargetEntity(client, targetPeer)
          await client.sendMessage(entity, { message })
          processedCount += 1

          store.telegramDispatches = store.telegramDispatches || []
          store.telegramDispatches.unshift({
            id: generateId("tg"),
            accountId: account.id,
            accountName: account.accountName || "",
            campaignId: rule.campaignId || "",
            campaignName: store.campaigns.find((item) => item.id === rule.campaignId)?.name || "",
            templateId: rule.templateId || "",
            templateTitle: store.templates.find((item) => item.id === rule.templateId)?.title || "",
            groupId: target.id,
            groupName: target.name || "",
            message,
            targetPeer,
            status: "sent",
            createdAt: new Date().toISOString(),
          })
        } catch (error) {
          const failure = describeTelegramSendError(error, targetPeer)
          addLog(store, {
            type: "telegram",
            status: "error",
            message: `Scheduled post failed for ${targetPeer}`,
            meta: { ruleId: rule.id, targetPeer, telegramCode: failure.telegramCode, detail: failure.error },
          })
          continue
        }

        const waitMs = Math.max(Number(rule.dispatchIntervalSeconds) || 20, 5) * 1000
        if (index < targets.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, waitMs))
        }
      }

      rule.lastRunAt = new Date().toISOString()
      rule.nextRunAt = calculateNextRunAt(rule, new Date())
      rule.lastGroupCursor = ((Number(rule.lastGroupCursor) || 0) + targets.length) % Math.max(store.groups.filter((item) => item.platform === "telegram").length, 1)
      rule.status = "running"
      account.telegramLastPostedAt = new Date().toISOString()
      addLog(store, { type: "scheduler", status: "success", message: `Scheduled batch posted for ${rule.name || "Unnamed rule"}`, meta: { ruleId: rule.id, count: targets.length } })
    } finally {
      await safelyDisconnectTelegramClient(client)
    }
  }

  return processedCount
}

async function handleApi(req, res, url) {
  const store = await readStore()
  const requester = getRequester(req, store)

    if (req.method === "GET" && url.pathname === "/api/bootstrap") {
      sendJson(res, 200, {
        dashboard: buildDashboard(store),
        campaigns: store.campaigns,
        schedulerRules: store.schedulerRules,
        accounts: store.accounts.map(sanitizeAccountForClient),
        groups: store.groups.map(sanitizeGroupForClient),
        telegramDispatches: store.telegramDispatches || [],
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
    await writeStore(store)
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
    await writeStore(store)
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
      accountId: payload.accountId || "",
      templateId: payload.templateId || "",
      mode: payload.mode || "interval",
      intervalMinutes: payload.intervalMinutes || "",
      dailyTime: payload.dailyTime || "",
      weeklyDay: payload.weeklyDay || "",
      batchSize: Math.min(Math.max(Number(payload.batchSize) || 35, 1), 40),
      dispatchIntervalSeconds: Math.max(Number(payload.dispatchIntervalSeconds) || 20, 5),
      days: normalizedDays,
      allDays,
      randomDelaySeconds: payload.randomDelaySeconds || "",
      status: payload.status || "queued",
      lastRunAt: "",
      nextRunAt: "",
      lastGroupCursor: 0,
      createdBy: requester.email || "",
      createdAt: new Date().toISOString(),
    }
    store.schedulerRules.unshift(record)
    addLog(store, { type: "scheduler", status: "success", message: `Scheduler rule saved: ${record.name || "Unnamed rule"}` })
    await writeStore(store)
    sendJson(res, 201, record)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/scheduler/run-due") {
    const processedCount = await processDueSchedulerRules(store)
    await writeStore(store)
    sendJson(res, 200, { ok: true, processedCount })
    return
  }

  if (req.method === "POST" && url.pathname === "/api/accounts") {
    const payload = await parseBody(req)
    const record = {
      id: generateId("account"),
      platform: payload.platform || "",
      accountName: payload.accountName || "",
      accountHandle: payload.accountHandle || "",
      phoneNumber: payload.phoneNumber || "",
      apiId: sanitizeApiId(payload.apiId),
      apiHash: payload.apiHash || "",
      sessionStatus: payload.platform === "telegram" ? "not_connected" : "",
      sessionString: "",
      pendingSessionString: "",
      pendingPhoneCodeHash: "",
      pendingPhoneNumber: "",
      telegramLastVerifiedAt: "",
      telegramLastPostedAt: "",
      status: payload.status || "connected",
      createdAt: new Date().toISOString(),
    }
    store.accounts.unshift(record)
    addLog(store, { type: "account", status: "success", message: `Account connected: ${record.accountName || "new account"}` })
    await writeStore(store)
    sendJson(res, 201, sanitizeAccountForClient(record))
    return
  }

  if (req.method === "POST" && url.pathname === "/api/accounts/restore") {
    const payload = await parseBody(req)
    const accounts = Array.isArray(payload.accounts) ? payload.accounts : []

    for (const item of accounts) {
      const id = String(item.id || "").trim()
      if (!id) continue

      let record = store.accounts.find((entry) => entry.id === id)
      if (!record) {
        record = {
          id,
          platform: item.platform || "telegram",
          accountName: item.accountName || "Telegram",
          accountHandle: item.accountHandle || "",
          status: item.status || "connected",
          createdAt: new Date().toISOString(),
        }
        store.accounts.unshift(record)
      }

      Object.assign(record, mergeTelegramAccountData(record, item), {
        platform: "telegram",
        accountName: item.accountName || record.accountName || "Telegram",
        accountHandle: item.accountHandle || record.accountHandle || "",
        status: item.status || record.status || "connected",
      })
    }

    await writeStore(store)
    sendJson(res, 200, { ok: true, restoredCount: accounts.length })
    return
  }

  if (req.method === "POST" && url.pathname === "/api/workspace/restore") {
    const payload = await parseBody(req)

    const mergeCollection = (key, items) => {
      const list = Array.isArray(items) ? items : []
      for (const item of list) {
        const id = String(item?.id || "").trim()
        if (!id) continue
        const existing = store[key].find((entry) => entry.id === id)
        if (existing) {
          Object.assign(existing, item)
        } else {
          store[key].unshift(item)
        }
      }
    }

    mergeCollection("campaigns", payload.campaigns)
    mergeCollection("schedulerRules", payload.schedulerRules)
    mergeCollection("groups", payload.groups)
    mergeCollection("templates", payload.templates)
    mergeCollection("accounts", payload.accounts)

    await writeStore(store)
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === "POST" && url.pathname === "/api/groups") {
    const payload = await parseBody(req)
    const record = {
      id: generateId("group"),
      name: payload.name || "",
      platform: payload.platform || "",
      inviteLink: payload.inviteLink || "",
      telegramPeer: payload.telegramPeer || "",
      categoryTags: Array.isArray(payload.categoryTags) ? payload.categoryTags : [],
      status: payload.status || "connected",
      createdAt: new Date().toISOString(),
    }
    store.groups.unshift(record)
    addLog(store, { type: "group", status: "success", message: `Group connected: ${record.name || "new group"}` })
    await writeStore(store)
    sendJson(res, 201, sanitizeGroupForClient(record))
    return
  }

  if (req.method === "POST" && url.pathname === "/api/groups/bulk-delete") {
    const payload = await parseBody(req)
    const ids = Array.isArray(payload.ids) ? payload.ids.map((item) => String(item || "").trim()).filter(Boolean) : []

    if (!ids.length) {
      sendJson(res, 400, { error: "Select at least one group to delete" })
      return
    }

    const before = store.groups.length
    store.groups = store.groups.filter((item) => !ids.includes(item.id))
    const deletedCount = before - store.groups.length

    if (!deletedCount) {
      sendJson(res, 404, { error: "Selected groups not found" })
      return
    }

    addLog(store, { type: "groups", status: "info", message: `${deletedCount} groups deleted`, meta: { ids } })
    await writeStore(store)
    sendJson(res, 200, { ok: true, deletedCount })
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
    await writeStore(store)
    sendJson(res, 201, record)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/telegram/auth/start") {
    const payload = await parseBody(req)
    const account = resolveOrHydrateTelegramAccount(store, payload)

    if (!account || account.platform !== "telegram") {
      sendJson(res, 404, { error: "Telegram account not found. Select the account again, or resave/reconnect it if the server was restarted." })
      return
    }

    if (!account.phoneNumber || !account.apiId || !account.apiHash) {
      sendJson(res, 400, { error: "Telegram account is missing phone number, API ID, or API hash" })
      return
    }

    const client = await createTelegramClient(account.pendingSessionString || account.sessionString || "", account)
    try {
      await client.connect()
      if (account.sessionString && await client.isUserAuthorized()) {
        account.sessionStatus = "connected"
        await writeStore(store)
        sendJson(res, 200, { ok: true, status: "connected", detail: "Telegram account is already connected.", telegramState: buildTelegramState(account) })
        return
      }

      const sentCode = await client.sendCode(getTelegramApiCredentials(account), account.phoneNumber, false)
      account.pendingSessionString = client.session.save()
      account.pendingPhoneCodeHash = sentCode.phoneCodeHash
      account.pendingPhoneNumber = account.phoneNumber
      account.sessionStatus = "code_sent"
      await writeStore(store)
      addLog(store, { type: "telegram", status: "success", message: `Telegram login code sent for ${account.accountName || account.phoneNumber}` })
      await writeStore(store)
      sendJson(res, 200, {
        ok: true,
        status: "code_sent",
        isCodeViaApp: Boolean(sentCode.isCodeViaApp),
        detail: sentCode.isCodeViaApp ? "Code sent to Telegram app." : "Code sent by SMS/Telegram.",
        telegramState: buildTelegramState(account),
      })
      return
    } finally {
      await safelyDisconnectTelegramClient(client)
    }
  }

  if (req.method === "POST" && url.pathname === "/api/telegram/auth/verify") {
    const payload = await parseBody(req)
    const account = resolveOrHydrateTelegramAccount(store, payload)

    if (!account || account.platform !== "telegram") {
      sendJson(res, 404, { error: "Telegram account not found. Select the account again, or resave/reconnect it if the server was restarted." })
      return
    }

    if (!account.pendingSessionString || !account.pendingPhoneCodeHash || !account.pendingPhoneNumber) {
      sendJson(res, 400, { error: "Start Telegram auth first to request a login code" })
      return
    }

    if (!payload.phoneCode) {
      sendJson(res, 400, { error: "Telegram login code is required" })
      return
    }

    const client = await createTelegramClient(account.pendingSessionString, account)
    try {
      await client.connect()
      try {
        await client.invoke(new Api.auth.SignIn({
          phoneNumber: account.pendingPhoneNumber,
          phoneCodeHash: account.pendingPhoneCodeHash,
          phoneCode: String(payload.phoneCode).trim(),
        }))
      } catch (error) {
        if (error?.errorMessage === "SESSION_PASSWORD_NEEDED") {
          if (!payload.password) {
            sendJson(res, 400, { error: "Two-step password is required for this Telegram account" })
            return
          }

          await client.signInWithPassword(getTelegramApiCredentials(account), {
            password: async () => String(payload.password).trim(),
            onError: (err) => {
              throw err
            },
          })
        } else {
          throw error
        }
      }

      const profile = await client.getMe()
      account.sessionString = client.session.save()
      account.pendingSessionString = ""
      account.pendingPhoneCodeHash = ""
      account.pendingPhoneNumber = ""
      account.sessionStatus = "connected"
      account.telegramLastVerifiedAt = new Date().toISOString()
      account.accountHandle = profile?.username ? `@${profile.username}` : account.accountHandle
      if (profile?.firstName && !account.accountName) {
        account.accountName = profile.firstName
      }
      addLog(store, { type: "telegram", status: "success", message: `Telegram account verified: ${account.accountName || account.phoneNumber}` })
      await writeStore(store)
      sendJson(res, 200, { ok: true, status: "connected", account: sanitizeAccountForClient(account), telegramState: buildTelegramState(account) })
      return
    } finally {
      await safelyDisconnectTelegramClient(client)
    }
  }

  if (req.method === "POST" && url.pathname === "/api/telegram/post") {
    const payload = await parseBody(req)
    const account = resolveOrHydrateTelegramAccount(store, payload)

    if (!account || account.platform !== "telegram") {
      sendJson(res, 404, { error: "Telegram account not found. Select the account again, or resave/reconnect it if the server was restarted." })
      return
    }

    if (!account.sessionString) {
      sendJson(res, 400, { error: "Telegram account is not connected yet" })
      return
    }

    const message = String(payload.message || "").trim()
    if (!message) {
      sendJson(res, 400, { error: "Telegram message is required" })
      return
    }

    const group = store.groups.find((item) => item.id === payload.groupId)
    const targetPeer = normalizeTelegramPeer(payload.targetPeer || group?.telegramPeer || group?.inviteLink)
    if (!targetPeer) {
      sendJson(res, 400, { error: "Telegram target peer is required. Add a channel username, group username, or Telegram peer." })
      return
    }

    const client = await createTelegramClient(account.sessionString, account)
    try {
      await client.connect()
      if (!await client.isUserAuthorized()) {
        account.sessionStatus = "expired"
        await writeStore(store)
        sendJson(res, 401, { error: "Telegram session expired. Reconnect the account and try again." })
        return
      }

      let result
      try {
        const entity = await resolveTelegramTargetEntity(client, targetPeer)
        result = await client.sendMessage(entity, { message })
      } catch (error) {
        const failure = describeTelegramSendError(error, targetPeer)
        addLog(store, {
          type: "telegram",
          status: "error",
          message: `Telegram message failed for ${targetPeer}`,
          meta: { accountId: account.id, groupId: payload.groupId || "", telegramCode: failure.telegramCode, detail: failure.error },
        })
        await writeStore(store)
        sendJson(res, failure.statusCode, { error: failure.error, telegramCode: failure.telegramCode })
        return
      }
      account.telegramLastPostedAt = new Date().toISOString()
      const dispatch = {
        id: generateId("tg"),
        accountId: account.id,
        accountName: account.accountName || "",
        campaignId: payload.campaignId || "",
        campaignName: store.campaigns.find((item) => item.id === payload.campaignId)?.name || "",
        templateId: payload.templateId || "",
        templateTitle: store.templates.find((item) => item.id === payload.templateId)?.title || "",
        groupId: payload.groupId || "",
        groupName: group?.name || "",
        message,
        targetPeer,
        messageId: result?.id || "",
        status: "sent",
        createdAt: new Date().toISOString(),
      }
      store.telegramDispatches = store.telegramDispatches || []
      store.telegramDispatches.unshift(dispatch)
      addLog(store, {
        type: "telegram",
        status: "success",
        message: `Telegram message posted to ${targetPeer}`,
        meta: {
          accountId: account.id,
          campaignId: payload.campaignId || "",
          templateId: payload.templateId || "",
          groupId: payload.groupId || "",
          messageId: result?.id || "",
        },
      })
      await writeStore(store)
      sendJson(res, 200, { ok: true, targetPeer, messageId: result?.id || null, dispatch })
      return
    } finally {
      await safelyDisconnectTelegramClient(client)
    }
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
    await writeStore(store)
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
    await writeStore(store)
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
    await writeStore(store)
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
    await writeStore(store)
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
    await writeStore(store)
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
    await writeStore(store)
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
    await writeStore(store)
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
    await writeStore(store)
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
