const WEEK_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

const state = {
  dashboard: null,
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
  settings: null,
  session: {
    email: "",
    role: "guest",
    isAdmin: false,
  },
  integrations: {
    aiProvider: "local",
  },
}

const sectionTitles = {
  dashboard: ["Dashboard", "A premium control center for campaigns, content, channels, leads, and operations."],
  campaigns: ["Campaigns", "Create and manage real marketing campaigns with channels, captions, and CTA."],
  scheduled: ["Scheduled Posts", "Manage interval, daily, and multi-day posting automation rules."],
  accounts: ["Accounts", "Connect and manage the platform accounts used in your CRM."],
  groups: ["Groups / Channels", "Import, tag, and manage target communities and broadcast spaces."],
  telegram: ["Telegram Share", "Open campaigns and templates inside your real Telegram session for live sharing."],
  templates: ["Message Templates", "Store reusable copy blocks for outreach, promos, and nurtures."],
  media: ["Media Library", "Upload through your cloud media stack or register direct media links."],
  writer: ["AI Content Generator", "Generate sharper marketing drafts, CTA, hashtags, and audience-specific variants."],
  leads: ["Leads / CRM", "Track prospects, lifecycle stage, source, and notes."],
  inbox: ["Inbox", "Capture chats locally and sync them into your cloud database when configured."],
  analytics: ["Analytics", "Review performance summaries and CRM-wide health indicators."],
  logs: ["Logs", "Inspect backend events, creation history, and workflow changes."],
  settings: ["Settings", "Manage sign-in, cloud storage, and workspace configuration."],
  billing: ["Billing", "Store plan and renewal information for the workspace."],
  team: ["Team", "Manage account access for admins and executives."],
  support: ["Help & Support", "Create tickets and let admins manage open requests."],
}

const firebaseContext = {
  appReady: false,
  auth: null,
  firestore: null,
  user: null,
  config: null,
}

const appConfig = window.__APP_CONFIG__ || {}
const apiBaseUrl = String(appConfig.apiBaseUrl || "").trim().replace(/\/+$/, "")
const FIRESTORE_COLLECTIONS = {
  campaigns: "crm_campaigns",
  accounts: "crm_accounts",
  groups: "crm_groups",
  templates: "crm_templates",
  telegramDispatches: "crm_telegram_dispatches",
}
const DELETE_SYNC_COLLECTIONS = {
  campaigns: FIRESTORE_COLLECTIONS.campaigns,
  accounts: FIRESTORE_COLLECTIONS.accounts,
  groups: FIRESTORE_COLLECTIONS.groups,
  templates: FIRESTORE_COLLECTIONS.templates,
}

document.addEventListener("DOMContentLoaded", async () => {
  bindNavigation()
  bindForms()
  bindAuthUi()

  try {
    await refreshWorkspace()
    initFirebase()
  } catch (error) {
    toast(error.message || "Unable to load workspace", true)
    updateAuthStatus(error.message || "Unable to prepare sign-in")
  }
})

function bindNavigation() {
  document.querySelectorAll(".menu-item").forEach((button) => {
    button.addEventListener("click", () => activateSection(button.dataset.section))
  })

  document.querySelectorAll("[data-jump]").forEach((button) => {
    button.addEventListener("click", () => activateSection(button.dataset.jump))
  })
}

function bindForms() {
  bindSubmit("campaign-form", handleCampaignSubmit)
  bindSubmit("scheduler-form", handleSchedulerSubmit)
  bindSubmit("account-form", handleAccountSubmit)
  bindSubmit("group-form", handleGroupSubmit)
  bindSubmit("telegram-auth-start-form", handleTelegramAuthStartSubmit)
  bindSubmit("telegram-auth-verify-form", handleTelegramAuthVerifySubmit)
  bindSubmit("telegram-share-form", handleTelegramShareSubmit)
  bindSubmit("template-form", handleTemplateSubmit)
  bindSubmit("media-form", handleMediaSubmit)
  bindSubmit("writer-form", handleWriterSubmit)
  bindSubmit("lead-form", handleLeadSubmit)
  bindSubmit("inbox-form", handleInboxSubmit)
  bindSubmit("support-form", handleSupportSubmit)
  bindSubmit("settings-form", handleSettingsSubmit)
  bindSubmit("billing-form", handleBillingSubmit)
  bindSubmit("create-account-form", handleCreateAccountSubmit)

  const telegramForm = document.getElementById("telegram-share-form")
  if (telegramForm) {
    telegramForm.addEventListener("change", syncTelegramPreview)
    telegramForm.addEventListener("input", syncTelegramPreview)
  }
}

function bindSubmit(id, handler) {
  const el = document.getElementById(id)
  if (el) el.addEventListener("submit", handler)
}

function bindAuthUi() {
  document.getElementById("signin-form").addEventListener("submit", handleLoginSubmit)
  document.getElementById("auth-open-button").addEventListener("click", () => {
    document.getElementById("session-modal").classList.remove("hidden")
  })
  document.getElementById("session-close-button").addEventListener("click", () => {
    document.getElementById("session-modal").classList.add("hidden")
  })
  document.getElementById("logout-button").addEventListener("click", handleLogout)
  document.getElementById("admin-create-account-button").addEventListener("click", openCreateAccountModal)
  document.getElementById("create-account-close-button").addEventListener("click", closeCreateAccountModal)
}

async function bootstrap() {
  const data = await api("/api/bootstrap", { allowGuest: true })
  Object.assign(state, data)
}

function initFirebase() {
  const cfg = state.settings?.firebase
  if (!cfg?.apiKey || !window.firebase) {
    updateAuthStatus("Sign-in is not configured yet.")
    return
  }

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(cfg)
    }
    firebaseContext.appReady = true
    firebaseContext.config = cfg
    firebaseContext.auth = firebase.auth()
    firebaseContext.firestore = firebase.firestore()
    firebaseContext.auth.onAuthStateChanged(async (user) => {
      firebaseContext.user = user
      state.session.email = user?.email || ""
      if (user) {
        updateAuthStatus(`Signed in as ${user.email}`)
        document.getElementById("signin-form").reset()
        await refreshWorkspace()
        showWorkspace()
      } else {
        state.session = { email: "", role: "guest", isAdmin: false }
        renderAll()
        applyPermissions()
        showAuthScreen()
        updateAuthStatus("Sign in to continue.")
      }
    })
  } catch (error) {
    updateAuthStatus("Sign-in could not be initialized.")
  }
}

function activateSection(sectionId) {
  const target = document.getElementById(sectionId)
  if (!target || target.hasAttribute("hidden")) return

  document.querySelectorAll(".menu-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.section === sectionId)
  })

  document.querySelectorAll(".view-section").forEach((section) => {
    section.classList.toggle("active", section.id === sectionId)
  })

  const [title, subtitle] = sectionTitles[sectionId] || sectionTitles.dashboard
  setText("page-title", title)
  setText("page-subtitle", subtitle)
}

async function handleCampaignSubmit(event) {
  event.preventDefault()
  const form = event.currentTarget
  const data = new FormData(form)
  await runSave(async () => {
    let mediaUrl = textValue(data, "mediaUrl")
    const mediaFile = data.get("mediaFile")
    if (!mediaUrl && mediaFile && mediaFile.size) {
      mediaUrl = await uploadToCloudinary(mediaFile)
    }
    const record = await api("/api/campaigns", {
      method: "POST",
      body: {
        name: textValue(data, "name"),
        description: textValue(data, "description"),
        caption: textValue(data, "caption"),
        cta: textValue(data, "cta"),
        mediaUrl,
        status: data.get("status"),
        platforms: data.getAll("platforms"),
      },
    })
    await syncManagedRecord(FIRESTORE_COLLECTIONS.campaigns, record)
    form.reset()
  }, "Campaign saved")
}

async function handleSchedulerSubmit(event) {
  event.preventDefault()
  const form = event.currentTarget
  const data = new FormData(form)
  const days = data.getAll("days")
  await runSave(async () => {
    await api("/api/scheduler-rules", {
      method: "POST",
      body: {
        name: textValue(data, "name"),
        campaignId: data.get("campaignId"),
        mode: data.get("mode"),
        intervalMinutes: data.get("intervalMinutes"),
        dailyTime: data.get("dailyTime"),
        days,
        allDays: days.includes("all_days"),
        randomDelaySeconds: data.get("randomDelaySeconds"),
        status: data.get("status"),
      },
    })
    form.reset()
  }, "Scheduler rule saved")
}

async function handleAccountSubmit(event) {
  event.preventDefault()
  const form = event.currentTarget
  const data = new FormData(form)
  await runSave(async () => {
    const record = await api("/api/accounts", {
      method: "POST",
      body: {
        platform: data.get("platform"),
        accountName: textValue(data, "accountName"),
        accountHandle: textValue(data, "accountHandle"),
        phoneNumber: textValue(data, "phoneNumber"),
        apiId: textValue(data, "apiId"),
        apiHash: textValue(data, "apiHash"),
        status: data.get("status"),
      },
    })
    await syncManagedRecord(FIRESTORE_COLLECTIONS.accounts, record)
    form.reset()
  }, "Account saved")
}

async function handleGroupSubmit(event) {
  event.preventDefault()
  const form = event.currentTarget
  const data = new FormData(form)
  await runSave(async () => {
    const inviteFile = data.get("inviteFile")
    const platform = data.get("platform")
    const categoryTags = splitTags(data.get("categoryTags"))

    if (inviteFile && inviteFile.size && isCsvFile(inviteFile)) {
      const importedGroups = await parseGroupCsvFile(inviteFile, {
        platform,
        fallbackName: textValue(data, "name"),
        fallbackPeer: textValue(data, "telegramPeer"),
        fallbackLink: textValue(data, "inviteLink"),
        categoryTags,
      })

      if (!importedGroups.length) {
        throw new Error("CSV me koi valid group/channel row nahi mila")
      }

      for (const item of importedGroups) {
        const record = await api("/api/groups", {
          method: "POST",
          body: item,
        })
        await syncManagedRecord(FIRESTORE_COLLECTIONS.groups, record)
      }

      form.reset()
      toast(`${importedGroups.length} channels imported from CSV`)
      return
    }

    let inviteLink = textValue(data, "inviteLink")
    if (!inviteLink && inviteFile && inviteFile.size) {
      inviteLink = await uploadToCloudinary(inviteFile)
    }
    const record = await api("/api/groups", {
      method: "POST",
      body: {
        name: textValue(data, "name"),
        platform,
        telegramPeer: textValue(data, "telegramPeer"),
        inviteLink,
        categoryTags,
      },
    })
    await syncManagedRecord(FIRESTORE_COLLECTIONS.groups, record)
    form.reset()
  }, "Channel saved")
}

async function handleTelegramAuthStartSubmit(event) {
  event.preventDefault()
  const data = new FormData(event.currentTarget)
  await runSave(async () => {
    await api("/api/telegram/auth/start", {
      method: "POST",
      body: {
        accountId: data.get("accountId"),
      },
    })
  }, "Telegram login code sent")
}

async function handleTelegramAuthVerifySubmit(event) {
  event.preventDefault()
  const form = event.currentTarget
  const data = new FormData(form)
  await runSave(async () => {
    await api("/api/telegram/auth/verify", {
      method: "POST",
      body: {
        accountId: data.get("accountId"),
        phoneCode: textValue(data, "phoneCode"),
        password: textValue(data, "password"),
      },
    })
    form.reset()
  }, "Telegram account connected")
}

async function handleTemplateSubmit(event) {
  event.preventDefault()
  const form = event.currentTarget
  const data = new FormData(form)
  await runSave(async () => {
    const record = await api("/api/templates", {
      method: "POST",
      body: {
        title: textValue(data, "title"),
        channel: data.get("channel"),
        body: textValue(data, "body"),
      },
    })
    await syncManagedRecord(FIRESTORE_COLLECTIONS.templates, record)
    form.reset()
  }, "Template saved")
}

async function handleTelegramShareSubmit(event) {
  event.preventDefault()
  const form = event.currentTarget
  const data = new FormData(form)
  const campaign = state.campaigns.find((item) => item.id === data.get("campaignId"))
  const template = state.templates.find((item) => item.id === data.get("templateId"))
  const account = state.accounts.find((item) => item.id === data.get("accountId"))
  const group = state.groups.find((item) => item.id === data.get("groupId"))
  const customMessage = textValue(data, "customMessage")
  const message = buildTelegramMessage({ campaign, template, customMessage })

  if (!message) {
    toast("Choose a template or campaign, or write a Telegram message first", true)
    return
  }

  const dispatch = {
    id: `tg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    accountId: account?.id || "",
    accountName: account?.accountName || "",
    campaignId: campaign?.id || "",
    campaignName: campaign?.name || "",
    templateId: template?.id || "",
    templateTitle: template?.title || "",
    groupId: group?.id || "",
    groupName: group?.name || "",
    message,
    targetPeer: textValue(data, "targetPeer") || group?.telegramPeer || group?.inviteLink || "",
    status: "sent",
    createdAt: new Date().toISOString(),
  }

  await runSave(async () => {
    state.telegramDispatches = mergeRecords([dispatch], state.telegramDispatches)
    persistLocalCache()
    const response = await api("/api/telegram/post", {
      method: "POST",
      body: {
        accountId: data.get("accountId"),
        groupId: data.get("groupId"),
        targetPeer: dispatch.targetPeer,
        campaignId: dispatch.campaignId,
        templateId: dispatch.templateId,
        message,
      },
    })
    dispatch.messageId = response.messageId || ""
    dispatch.targetPeer = response.targetPeer || dispatch.targetPeer
    state.telegramDispatches = mergeRecords([dispatch], state.telegramDispatches)
    await syncManagedRecord(FIRESTORE_COLLECTIONS.telegramDispatches, dispatch)
    form.reset()
  }, "Telegram message posted")
}

async function handleMediaSubmit(event) {
  event.preventDefault()
  const form = event.currentTarget
  const data = new FormData(form)
  await runSave(async () => {
    let mediaUrl = textValue(data, "url")
    const file = data.get("file")
    if (!mediaUrl && file && file.size) {
      mediaUrl = await uploadToCloudinary(file)
    }
    if (!mediaUrl) {
      throw new Error("Provide a media URL or choose a file to upload")
    }
    await api("/api/media", {
      method: "POST",
      body: {
        name: textValue(data, "name"),
        type: data.get("type"),
        url: mediaUrl,
      },
    })
    form.reset()
  }, "Media saved")
}

async function handleWriterSubmit(event) {
  event.preventDefault()
  const form = event.currentTarget
  const data = new FormData(form)
  await runSave(async () => {
    await api("/api/ai/generate", {
      method: "POST",
      body: {
        topic: textValue(data, "topic"),
        audience: textValue(data, "audience"),
        tone: data.get("tone"),
        emojiStyle: data.get("emojiStyle"),
        ctaGoal: textValue(data, "ctaGoal"),
      },
    })
    form.reset()
  }, "AI draft generated")
}

async function handleLeadSubmit(event) {
  event.preventDefault()
  const form = event.currentTarget
  const data = new FormData(form)
  const lead = {
    name: textValue(data, "name"),
    source: textValue(data, "source"),
    stage: data.get("stage"),
    contact: textValue(data, "contact"),
    note: textValue(data, "note"),
  }
  await runSave(async () => {
    await api("/api/leads", { method: "POST", body: lead })
    await syncToFirestore("crm_leads", lead)
    form.reset()
  }, "Lead saved")
}

async function handleInboxSubmit(event) {
  event.preventDefault()
  const form = event.currentTarget
  const data = new FormData(form)
  const chat = {
    sender: textValue(data, "sender"),
    platform: data.get("platform"),
    status: data.get("status"),
    message: textValue(data, "message"),
  }
  await runSave(async () => {
    await api("/api/inbox", { method: "POST", body: chat })
    await syncToFirestore("crm_chats", chat)
    form.reset()
  }, "Inbox message saved")
}

async function handleSupportSubmit(event) {
  event.preventDefault()
  const form = event.currentTarget
  const data = new FormData(form)
  await runSave(async () => {
    await api("/api/support", {
      method: "POST",
      body: {
        subject: textValue(data, "subject"),
        priority: data.get("priority"),
        description: textValue(data, "description"),
      },
    })
    form.reset()
  }, "Support ticket saved")
}

async function handleSettingsSubmit(event) {
  event.preventDefault()
  const form = event.currentTarget
  const data = new FormData(form)
  await runSave(async () => {
    await api("/api/settings", {
      method: "PUT",
      body: {
        projectName: textValue(data, "projectName"),
        workspaceEmail: textValue(data, "workspaceEmail"),
        slogan: textValue(data, "slogan"),
        firebase: {
          apiKey: textValue(data, "apiKey"),
          authDomain: textValue(data, "authDomain"),
          projectId: textValue(data, "projectId"),
          storageBucket: textValue(data, "storageBucket"),
          messagingSenderId: textValue(data, "messagingSenderId"),
          appId: textValue(data, "appId"),
        },
        cloudinary: {
          cloudName: textValue(data, "cloudName"),
          uploadPreset: textValue(data, "uploadPreset"),
          folder: textValue(data, "cloudinaryFolder"),
        },
      },
    })
  }, "Settings saved")
}

async function handleBillingSubmit(event) {
  event.preventDefault()
  const form = event.currentTarget
  const data = new FormData(form)
  await runSave(async () => {
    await api("/api/settings", {
      method: "PUT",
      body: {
        billing: {
          planName: textValue(data, "planName"),
          status: data.get("status"),
          renewalDate: data.get("renewalDate"),
          amount: textValue(data, "amount"),
        },
      },
    })
  }, "Billing saved")
}

async function handleLoginSubmit(event) {
  event.preventDefault()
  const data = new FormData(event.currentTarget)
  if (!firebaseContext.auth) {
    toast("Sign-in is not configured yet", true)
    return
  }
  try {
    await firebaseContext.auth.signInWithEmailAndPassword(textValue(data, "email"), data.get("password"))
    toast("Login successful")
  } catch (error) {
    toast(error.message, true)
  }
}

async function handleCreateAccountSubmit(event) {
  event.preventDefault()
  if (!state.session.isAdmin) {
    toast("Only admins can create accounts", true)
    return
  }
  if (!firebaseContext.config || !window.firebase) {
    toast("Sign-in service is not configured", true)
    return
  }

  const form = event.currentTarget
  const data = new FormData(form)
  const email = textValue(data, "email")
  const password = data.get("password")
  const role = data.get("role")
  const name = textValue(data, "name")
  const secondaryName = `account_creator_${Date.now()}`
  let secondaryApp

  await runSave(async () => {
    secondaryApp = firebase.initializeApp(firebaseContext.config, secondaryName)
    await secondaryApp.auth().createUserWithEmailAndPassword(email, password)
    await api("/api/team", {
      method: "POST",
      body: {
        name,
        email,
        role,
        status: "active",
      },
    })
    form.reset()
    closeCreateAccountModal()
  }, "Account created")

  if (secondaryApp) {
    try {
      await secondaryApp.auth().signOut()
      await secondaryApp.delete()
    } catch (error) {
      console.warn(error)
    }
  }
}

async function handleLogout() {
  if (!firebaseContext.auth) {
    toast("Sign-in service is not ready", true)
    return
  }
  try {
    await firebaseContext.auth.signOut()
    document.getElementById("session-modal").classList.add("hidden")
    toast("Logged out")
  } catch (error) {
    toast(error.message, true)
  }
}

async function runSave(work, successMessage) {
  try {
    await work()
    await refreshWorkspace()
    toast(successMessage)
  } catch (error) {
    toast(error.message || "Save failed", true)
  }
}

function renderAll() {
  renderDashboard()
  renderCampaigns()
  renderScheduler()
  renderAccounts()
  renderGroups()
  renderTelegram()
  renderTemplates()
  renderMedia()
  renderWriter()
  renderLeads()
  renderInbox()
  renderAnalytics()
  renderLogs()
  renderSettings()
  renderBilling()
  renderTeam()
  renderSupport()
  renderProfile()
}

function renderDashboard() {
  const stats = state.dashboard?.stats || {}
  const activeCampaigns = state.campaigns.filter((item) => item.status === "active").length
  const scheduledPosts = state.schedulerRules.filter((item) => item.status !== "archived").length
  const connectedGroups = state.groups.length
  const failedLogs = state.logs.filter((item) => item.status === "failed").length
  const successLogs = state.logs.filter((item) => item.status === "success").length
  const successRate = successLogs + failedLogs === 0 ? 0 : Math.round((successLogs / (successLogs + failedLogs)) * 100)

  setText("stat-active-campaigns", activeCampaigns || stats.activeCampaigns || 0)
  setText("stat-scheduled-posts", scheduledPosts || stats.scheduledPosts || 0)
  setText("stat-connected-groups", connectedGroups || stats.connectedGroups || 0)
  setText("stat-success-rate", `${successRate || stats.successRate || 0}%`)
  setText("stat-ai-drafts", state.aiDrafts.length || stats.aiDrafts || 0)
  setText("stat-open-tickets", state.supportTickets.filter((item) => item.status !== "resolved").length || stats.openTickets || 0)
  setText("menu-inbox-count", state.inboxMessages.length || stats.inboxCount || 0)

  renderList("upcoming-queue", state.dashboard?.upcomingQueue, "No scheduled posts yet.", (item) => {
    const campaign = state.campaigns.find((entry) => entry.id === item.campaignId)
    return renderStandardCard(item.name || "Unnamed rule", formatRuleSubtitle(item, campaign), item.status, `deleteItem('scheduler-rules','${item.id}')`)
  })

  const platformStats = buildPlatformStats()
  document.getElementById("platform-stats").innerHTML = platformStats.length
    ? platformStats.map(renderPlatformCard).join("")
    : `<div class="empty-state">No accounts or channels connected yet.</div>`

  renderList("recent-logs", state.dashboard?.recentLogs, "No recent activity.", (item) => renderLogCard(item))
}

function renderCampaigns() {
  renderList("campaign-list", state.campaigns, "No campaigns created yet.", (item) =>
    renderStandardCard(item.name || "Untitled campaign", item.description || "No description added.", item.status, `deleteItem('campaigns','${item.id}')`, item.platforms, item.createdBy ? `Created by ${item.createdBy}` : "")
  )
}

function renderScheduler() {
  const select = document.getElementById("scheduler-campaign-select")
  select.innerHTML = state.campaigns.length
    ? state.campaigns.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")
    : `<option value="">No campaigns available</option>`

  renderList("scheduler-list", state.schedulerRules, "No scheduler rules saved yet.", (item) => {
    const campaign = state.campaigns.find((entry) => entry.id === item.campaignId)
    return renderStandardCard(item.name || "Unnamed rule", formatRuleSubtitle(item, campaign), item.status, `deleteItem('scheduler-rules','${item.id}')`)
  })
}

function renderAccounts() {
  renderList("account-list", state.accounts, "No accounts connected yet.", (item) =>
    renderStandardCard(
      item.accountName || "Unnamed account",
      [
        capitalize(item.platform),
        item.accountHandle || item.phoneNumber || "no handle added",
        item.platform === "telegram" ? `Session ${item.sessionStatus || "not_connected"}` : "",
      ].filter(Boolean).join(" | "),
      item.status,
      `deleteItem('accounts','${item.id}')`
    )
  )
}

function renderGroups() {
  renderList("group-list", state.groups, "No channels connected yet.", (item) =>
    renderStandardCard(
      item.name || "Unnamed channel",
      `${capitalize(item.platform)} | ${item.telegramPeer || item.inviteLink || "no import link"}`,
      item.status,
      `deleteItem('groups','${item.id}')`,
      item.categoryTags
    )
  )
}

function renderTelegram() {
  const telegramAccounts = state.accounts.filter((item) => item.platform === "telegram")
  renderSelectOptions("telegram-auth-account-select", telegramAccounts, "id", "accountName", "No Telegram account saved")
  renderSelectOptions("telegram-verify-account-select", telegramAccounts, "id", "accountName", "No Telegram account saved")
  renderSelectOptions("telegram-account-select", telegramAccounts, "id", "accountName", "No Telegram account saved")
  renderSelectOptions("telegram-group-select", state.groups.filter((item) => item.platform === "telegram"), "id", "name", "No Telegram group/channel saved")
  renderSelectOptions("telegram-campaign-select", state.campaigns, "id", "name", "No campaign saved")
  renderSelectOptions("telegram-template-select", state.templates, "id", "title", "No template saved")

  const selectedAccount = telegramAccounts.find((item) => item.id === document.getElementById("telegram-account-select")?.value)
  const note = selectedAccount
    ? `${selectedAccount.accountName || "Telegram account"}: ${selectedAccount.sessionStatus || "not_connected"}`
    : "Save a Telegram account with phone number, API ID, and API hash first. Then request the code and verify the session once."
  setText("telegram-connection-note", note)

  renderList("telegram-dispatch-list", state.telegramDispatches, "No Telegram shares opened yet.", (item) =>
    renderStandardCard(
      item.templateTitle || item.campaignName || "Telegram share",
      [item.targetPeer || item.groupName || "Telegram peer", item.accountName || "Real Telegram account", truncateText(item.message || "", 90)].filter(Boolean).join(" | "),
      item.status || "opened",
      `deleteTelegramDispatch('${item.id}')`
    )
  )

  syncTelegramPreview()
}

function renderTemplates() {
  renderList("template-list", state.templates, "No templates saved yet.", (item) =>
    renderStandardCard(item.title || "Untitled template", item.body || "No message body added.", item.channel, `deleteItem('templates','${item.id}')`)
  )
}

function renderMedia() {
  renderList("media-list", state.mediaItems, "No media items yet.", (item) =>
    renderStandardCard(item.name || "Unnamed asset", `${capitalize(item.type)} | ${item.url || "no url added"}`, item.type, `deleteItem('media','${item.id}')`)
  )
}

function renderWriter() {
  renderList("writer-list", state.aiDrafts, "No AI drafts yet.", (item) => `
    <div class="list-item">
      <strong>${escapeHtml(item.topic || "Untitled draft")}</strong>
      <span>${escapeHtml(item.caption || "")}</span>
      <div class="badge-line">
        <span class="badge">${escapeHtml(item.tone || "tone")}</span>
        <span class="badge">${escapeHtml(item.emojiStyle || "emoji")}</span>
        <span class="badge">${escapeHtml(item.provider || state.integrations.aiProvider || "local")}</span>
      </div>
      <span>${escapeHtml(item.hashtags || "")}</span>
      <div class="item-actions"><button class="danger-button" onclick="deleteItem('ai-drafts','${item.id}')">Delete</button></div>
    </div>
  `)
}

function renderLeads() {
  renderList("lead-list", state.leads, "No leads captured yet.", (item) =>
    renderStandardCard(item.name || "Unnamed lead", `${item.source || "unknown source"} | ${item.contact || "no contact"}`, item.stage, `deleteItem('leads','${item.id}')`)
  )
}

function renderInbox() {
  renderList("inbox-list", state.inboxMessages, "Inbox is empty.", (item) =>
    renderStandardCard(item.sender || "Unknown sender", `${capitalize(item.platform)} | ${item.message || "no message"}`, item.status, `deleteItem('inbox','${item.id}')`)
  )
}

function renderAnalytics() {
  setText("metric-ai-drafts", state.aiDrafts.length)
  setText("metric-leads", state.leads.length)
  setText("metric-logs", state.logs.length)
  document.getElementById("analytics-summary").innerHTML = [
    ["Campaigns", state.campaigns.length],
    ["Accounts", state.accounts.length],
    ["Channels", state.groups.length],
    ["Templates", state.templates.length],
    ["Media Items", state.mediaItems.length],
    ["Support Tickets", state.supportTickets.length],
  ]
    .map(([label, value]) => `<div class="stack-item"><strong>${escapeHtml(label)}</strong><small>${value} records</small></div>`)
    .join("")
}

function renderLogs() {
  renderList("full-log-list", state.logs, "No logs yet.", (item) => renderLogCard(item, true))
}

function renderSettings() {
  if (!state.settings) return
  setText("brand-title", state.settings.projectName || "UniSolveX Pilot")
  setText("brand-slogan", state.settings.slogan || "Automate. Reach. Grow.")

  const form = document.getElementById("settings-form")
  form.projectName.value = state.settings.projectName || ""
  form.workspaceEmail.value = state.settings.workspaceEmail || ""
  form.slogan.value = state.settings.slogan || ""
  form.apiKey.value = state.settings.firebase?.apiKey || ""
  form.authDomain.value = state.settings.firebase?.authDomain || ""
  form.projectId.value = state.settings.firebase?.projectId || ""
  form.storageBucket.value = state.settings.firebase?.storageBucket || ""
  form.messagingSenderId.value = state.settings.firebase?.messagingSenderId || ""
  form.appId.value = state.settings.firebase?.appId || ""
  form.cloudName.value = state.settings.cloudinary?.cloudName || ""
  form.uploadPreset.value = state.settings.cloudinary?.uploadPreset || ""
  form.cloudinaryFolder.value = state.settings.cloudinary?.folder || "unisolvex-pilot"
}

function renderBilling() {
  const billing = state.settings?.billing || {}
  const form = document.getElementById("billing-form")
  form.planName.value = billing.planName || ""
  form.status.value = billing.status || "inactive"
  form.renewalDate.value = billing.renewalDate || ""
  form.amount.value = billing.amount || ""

  document.getElementById("billing-summary").innerHTML = `
    <div class="stack-item"><strong>${escapeHtml(billing.planName || "No plan set")}</strong><small>Plan name</small></div>
    <div class="stack-item"><strong>${escapeHtml(billing.status || "inactive")}</strong><small>Billing status</small></div>
    <div class="stack-item"><strong>${escapeHtml(billing.renewalDate || "No renewal date")}</strong><small>Renewal date</small></div>
    <div class="stack-item"><strong>${escapeHtml(billing.amount || "No amount")}</strong><small>Plan amount</small></div>
  `
}

function renderTeam() {
  renderList("team-list", state.teamMembers, "No team members added yet.", (item) =>
    renderStandardCard(item.name || "Unnamed member", `${item.role || "no role"} | ${item.email || "no email"}`, item.status, `deleteItem('team','${item.id}')`)
  )
}

function renderSupport() {
  setText("support-queue-title", state.session.isAdmin ? "Admin Ticket Queue" : "My Support Tickets")
  const items = state.session.isAdmin
    ? state.supportTickets
    : state.supportTickets.filter((item) => (item.createdBy || "") === (state.session.email || ""))

  renderList("support-list", items, "No support tickets yet.", (item) => renderSupportCard(item))
}

function renderSupportCard(item) {
  const adminActions = state.session.isAdmin
    ? `
      <div class="item-actions support-actions">
        <button class="ghost-button" onclick="updateTicketStatus('${item.id}','open')">Open</button>
        <button class="ghost-button" onclick="updateTicketStatus('${item.id}','pending')">Pending</button>
        <button class="primary-button" onclick="updateTicketStatus('${item.id}','resolved')">Resolve</button>
      </div>
    `
    : ""

  return `
    <div class="list-item">
      <strong>${escapeHtml(item.subject || "Untitled ticket")}</strong>
      <span>${escapeHtml(item.description || "No description added.")}</span>
      <div class="badge-line">
        <span class="badge">${escapeHtml(capitalize(item.priority || "medium"))}</span>
        <span class="badge">${escapeHtml(capitalize(item.status || "open"))}</span>
      </div>
      <span>${escapeHtml(formatTicketMeta(item))}</span>
      ${adminActions}
    </div>
  `
}

function renderProfile() {
  setText("profile-email", state.session.email || "No active session")
  setText("profile-role", state.session.role ? `${capitalize(state.session.role)} access` : "Role not available")
}

function renderList(targetId, items, emptyMessage, renderer) {
  const root = document.getElementById(targetId)
  root.innerHTML = !items || !items.length ? `<div class="empty-state">${escapeHtml(emptyMessage)}</div>` : items.map(renderer).join("")
}

function renderSelectOptions(targetId, items, valueKey, labelKey, emptyLabel) {
  const root = document.getElementById(targetId)
  if (!root) return

  root.innerHTML = items.length
    ? [`<option value="">Select</option>`, ...items.map((item) => `<option value="${escapeHtml(item[valueKey])}">${escapeHtml(item[labelKey] || "Untitled")}</option>`)].join("")
    : `<option value="">${escapeHtml(emptyLabel)}</option>`
}

function renderPlatformCard(item) {
  const total = buildPlatformStats().reduce((sum, entry) => sum + entry.count, 0) || 1
  const width = Math.round((item.count / total) * 100)
  return `
    <div class="stack-item">
      <strong>${escapeHtml(capitalize(item.platform))}</strong>
      <small>${item.count} mapped entities</small>
      <div class="platform-bar"><span style="width:${width}%"></span></div>
    </div>
  `
}

function renderLogCard(item, includeType = false) {
  return `
    <div class="list-item">
      <strong>${escapeHtml(item.message)}</strong>
      <span>${escapeHtml(formatDate(item.createdAt))}</span>
      <span class="status-badge ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
      ${includeType ? `<span>${escapeHtml(item.type || "")}</span>` : ""}
    </div>
  `
}

function renderStandardCard(title, subtitle, status, deleteAction, tags = [], footer = "") {
  return `
    <div class="list-item">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(subtitle)}</span>
      ${Array.isArray(tags) && tags.length ? `<div class="badge-line">${tags.map((tag) => `<span class="badge">${escapeHtml(capitalize(tag))}</span>`).join("")}</div>` : ""}
      <span class="status-badge ${escapeHtml(status || "info")}">${escapeHtml(status || "info")}</span>
      ${footer ? `<span>${escapeHtml(footer)}</span>` : ""}
      <div class="item-actions"><button class="danger-button" onclick="${deleteAction}">Delete</button></div>
    </div>
  `
}

function formatRuleSubtitle(rule, campaign) {
  const parts = []
  if (campaign?.name) parts.push(`Campaign: ${campaign.name}`)
  if (rule.mode === "interval" && rule.intervalMinutes) parts.push(`Every ${rule.intervalMinutes} mins`)
  if (rule.dailyTime) parts.push(`Time ${rule.dailyTime}`)
  if (rule.allDays) {
    parts.push("Every day")
  } else if (Array.isArray(rule.days) && rule.days.length) {
    parts.push(`Days ${rule.days.map(capitalize).join(", ")}`)
  } else if (rule.mode === "weekly" && rule.weeklyDay) {
    parts.push(`Every ${capitalize(rule.weeklyDay)}`)
  }
  if (rule.randomDelaySeconds) parts.push(`Delay ${rule.randomDelaySeconds}s`)
  return parts.join(" | ") || "Scheduler rule"
}

function formatTicketMeta(ticket) {
  const parts = []
  if (ticket.createdBy) parts.push(`Raised by ${ticket.createdBy}`)
  if (ticket.updatedBy && ticket.updatedBy !== ticket.createdBy) parts.push(`Handled by ${ticket.updatedBy}`)
  if (ticket.updatedAt) parts.push(`Updated ${formatDate(ticket.updatedAt)}`)
  return parts.join(" | ")
}

function buildPlatformStats() {
  const counts = {}
  for (const item of [...state.accounts, ...state.groups]) {
    const platform = item.platform || "other"
    counts[platform] = (counts[platform] || 0) + 1
  }

  return Object.entries(counts)
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count)
}

function splitTags(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean)
}

function isCsvFile(file) {
  const name = String(file?.name || "").toLowerCase()
  return name.endsWith(".csv") || file?.type === "text/csv"
}

async function parseGroupCsvFile(file, options) {
  const text = await file.text()
  const rows = parseCsvText(text)
  if (!rows.length) return []

  const maybeHeader = rows[0].map(normalizeColumnName)
  const hasHeader = maybeHeader.some((value) => ["name", "groupname", "channelname", "link", "invitelink", "telegrampeer", "username", "platform", "tags", "categorytags"].includes(value))
  const dataRows = hasHeader ? rows.slice(1) : rows
  const headers = hasHeader ? maybeHeader : []

  return dataRows
    .map((row) => mapCsvRowToGroup(row, headers, options))
    .filter(Boolean)
}

function parseCsvText(text) {
  const rows = []
  let current = ""
  let row = []
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === "," && !inQuotes) {
      row.push(current.trim())
      current = ""
      continue
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1
      row.push(current.trim())
      current = ""
      if (row.some((cell) => cell !== "")) {
        rows.push(row)
      }
      row = []
      continue
    }

    current += char
  }

  row.push(current.trim())
  if (row.some((cell) => cell !== "")) {
    rows.push(row)
  }

  return rows
}

function mapCsvRowToGroup(row, headers, options) {
  const getValue = (...keys) => {
    for (const key of keys) {
      const index = headers.indexOf(normalizeColumnName(key))
      if (index >= 0 && row[index]) return String(row[index]).trim()
    }
    return ""
  }

  const genericFirst = String(row[0] || "").trim()
  const genericSecond = String(row[1] || "").trim()
  const genericThird = String(row[2] || "").trim()
  const platform = getValue("platform") || options.platform || "telegram"
  const inviteLink = getValue("invite_link", "link", "group_link", "channel_link", "url") || options.fallbackLink || ""
  const telegramPeer = normalizeTelegramPeerInput(getValue("telegram_peer", "peer", "username", "handle") || options.fallbackPeer || inferPeerFromRow(genericFirst, genericSecond, genericThird, inviteLink))
  const name = getValue("name", "group_name", "channel_name", "title") || inferNameFromRow(genericFirst, genericSecond, telegramPeer, inviteLink, options.fallbackName)
  const tagText = getValue("tags", "category_tags")
  const categoryTags = [...new Set([...(options.categoryTags || []), ...splitTags(tagText)])]

  if (!name && !telegramPeer && !inviteLink) return null

  return {
    name: name || telegramPeer || inviteLink || "Imported Telegram channel",
    platform,
    telegramPeer,
    inviteLink,
    categoryTags,
  }
}

function inferPeerFromRow(first, second, third, inviteLink) {
  for (const value of [first, second, third, inviteLink]) {
    const text = String(value || "").trim()
    if (!text) continue
    if (text.startsWith("@") || text.includes("t.me/")) return text
  }
  return ""
}

function inferNameFromRow(first, second, telegramPeer, inviteLink, fallbackName) {
  const firstValue = String(first || "").trim()
  const secondValue = String(second || "").trim()

  if (firstValue && !firstValue.startsWith("@") && !firstValue.includes("t.me/")) return firstValue
  if (secondValue && !secondValue.startsWith("@") && !secondValue.includes("t.me/")) return secondValue
  if (telegramPeer) return telegramPeer.replace(/^@/, "")
  if (inviteLink) return inviteLink.replace(/^https?:\/\//i, "")
  return fallbackName || ""
}

function normalizeColumnName(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function normalizeTelegramPeerInput(value) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  if (/^https?:\/\/t\.me\//i.test(raw)) {
    return `@${raw.replace(/^https?:\/\/t\.me\//i, "").replace(/\/+$/, "")}`
  }
  return raw
}

function textValue(formData, key) {
  const value = formData.get(key)
  return typeof value === "string" ? value.trim() : ""
}

function capitalize(value = "") {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : ""
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : ""
}

function setText(id, value) {
  const el = document.getElementById(id)
  if (el) el.textContent = value
}

async function refreshWorkspace() {
  await bootstrap()
  hydrateLocalCache()
  await hydratePersistentData()
  persistLocalCache()
  renderAll()
  applyPermissions()
}

function showWorkspace() {
  document.body.classList.remove("auth-locked")
  document.getElementById("auth-screen").classList.add("hidden")
}

function showAuthScreen() {
  document.body.classList.add("auth-locked")
  document.getElementById("auth-screen").classList.remove("hidden")
  document.getElementById("session-modal").classList.add("hidden")
  document.getElementById("create-account-modal").classList.add("hidden")
}

function applyPermissions() {
  state.session.isAdmin = state.session.role === "admin"
  document.querySelectorAll("[data-admin-only]").forEach((element) => {
    if (state.session.isAdmin) {
      element.removeAttribute("hidden")
    } else {
      element.setAttribute("hidden", "hidden")
    }
  })

  if (!state.session.isAdmin && ["settings", "billing", "team"].includes(getActiveSection())) {
    activateSection("dashboard")
  }

  renderSupport()
  renderProfile()
}

function getActiveSection() {
  return document.querySelector(".view-section.active")?.id || "dashboard"
}

function updateAuthStatus(text) {
  document.getElementById("auth-status").textContent = text
}

async function syncToFirestore(collection, payload) {
  if (!firebaseContext.firestore || !firebaseContext.user) return
  try {
    await firebaseContext.firestore.collection(collection).add({
      ...payload,
      owner: firebaseContext.user.email || "",
      createdAt: new Date().toISOString(),
    })
  } catch (error) {
    toast(`Cloud sync failed: ${error.message}`, true)
  }
}

async function syncManagedRecord(collection, payload) {
  if (!collection || !payload?.id) {
    persistLocalCache()
    return
  }

  if (!firebaseContext.firestore || !firebaseContext.user) {
    persistLocalCache()
    return
  }

  try {
    await firebaseContext.firestore.collection(collection).doc(payload.id).set({
      ...payload,
      owner: firebaseContext.user.email || "",
      updatedAt: new Date().toISOString(),
    }, { merge: true })
  } catch (error) {
    if (!isIgnorableFirestorePermissionError(error)) {
      toast(`Cloud sync failed: ${error.message}`, true)
    }
  }

  persistLocalCache()
}

async function removeManagedRecord(collection, id) {
  if (!collection || !id) {
    persistLocalCache()
    return
  }

  if (!firebaseContext.firestore || !firebaseContext.user) {
    persistLocalCache()
    return
  }

  try {
    await firebaseContext.firestore.collection(collection).doc(id).delete()
  } catch (error) {
    if (!isIgnorableFirestorePermissionError(error)) {
      throw error
    }
  }

  persistLocalCache()
}

async function hydratePersistentData() {
  if (!firebaseContext.firestore || !firebaseContext.user) return

  try {
    const [campaigns, accounts, groups, templates, telegramDispatches] = await Promise.all([
      loadManagedCollection(FIRESTORE_COLLECTIONS.campaigns),
      loadManagedCollection(FIRESTORE_COLLECTIONS.accounts),
      loadManagedCollection(FIRESTORE_COLLECTIONS.groups),
      loadManagedCollection(FIRESTORE_COLLECTIONS.templates),
      loadManagedCollection(FIRESTORE_COLLECTIONS.telegramDispatches),
    ])

    state.campaigns = mergeRecords(campaigns, state.campaigns)
    state.accounts = mergeRecords(accounts, state.accounts)
    state.groups = mergeRecords(groups, state.groups)
    state.templates = mergeRecords(templates, state.templates)
    state.telegramDispatches = sortByCreatedDesc(telegramDispatches)
  } catch (error) {
    if (!isIgnorableFirestorePermissionError(error)) {
      toast(`Cloud restore failed: ${error.message}`, true)
    }
  }
}

async function loadManagedCollection(collection) {
  const snapshot = await firebaseContext.firestore.collection(collection)
    .where("owner", "==", firebaseContext.user.email || "")
    .get()

  return sortByCreatedDesc(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })))
}

function hydrateLocalCache() {
  const cached = readLocalCache()
  if (!cached) return

  state.campaigns = mergeRecords(state.campaigns, cached.campaigns || [])
  state.accounts = mergeRecords(state.accounts, cached.accounts || [])
  state.groups = mergeRecords(state.groups, cached.groups || [])
  state.templates = mergeRecords(state.templates, cached.templates || [])
  state.telegramDispatches = mergeRecords(state.telegramDispatches, cached.telegramDispatches || [])
}

function persistLocalCache() {
  try {
    const key = getLocalCacheKey()
    if (!key) return

    window.localStorage.setItem(key, JSON.stringify({
      campaigns: state.campaigns,
      accounts: state.accounts,
      groups: state.groups,
      templates: state.templates,
      telegramDispatches: state.telegramDispatches,
    }))
  } catch (error) {
    console.warn("Local cache failed", error)
  }
}

function readLocalCache() {
  try {
    const key = getLocalCacheKey()
    if (!key) return null
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch (error) {
    console.warn("Local cache read failed", error)
    return null
  }
}

function getLocalCacheKey() {
  const email = firebaseContext.user?.email || state.session.email || "workspace"
  return `unisolvex-pilot-cache:${String(email).toLowerCase()}`
}

async function uploadToCloudinary(file) {
  const cfg = state.settings?.cloudinary
  if (!cfg?.cloudName || !cfg?.uploadPreset) {
    throw new Error("Cloud upload is not configured in Settings or .env")
  }

  const formData = new FormData()
  formData.append("file", file)
  formData.append("upload_preset", cfg.uploadPreset)
  formData.append("folder", cfg.folder || "unisolvex-pilot")

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/auto/upload`, {
    method: "POST",
    body: formData,
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload.error?.message || "Cloud upload failed")
  }
  return payload.secure_url
}

async function api(url, options = {}) {
  const targetUrl = resolveApiUrl(url)
  const headers = { "Content-Type": "application/json" }
  const email = firebaseContext.user?.email || state.session.email
  if (email) headers["X-User-Email"] = email

  const response = await fetch(targetUrl, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!response.ok) {
    throw new Error(await describeApiError(response, targetUrl))
  }

  return response.json()
}

function resolveApiUrl(url) {
  if (/^https?:\/\//i.test(url)) return url
  if (!apiBaseUrl) return url
  if (!url.startsWith("/")) return `${apiBaseUrl}/${url}`
  return `${apiBaseUrl}${url}`
}

async function describeApiError(response, url) {
  const contentType = response.headers.get("content-type") || ""

  if (contentType.includes("application/json")) {
    const error = await response.json().catch(() => null)
    if (error?.detail || error?.error) {
      return error.detail || error.error
    }
  } else {
    const text = await response.text().catch(() => "")
    if (response.status === 404 && url.startsWith("/api/")) {
      return "Backend API not deployed. Firebase Hosting URL is loading the site, but /api routes are missing."
    }
    if (text.trim()) {
      return `${response.status} ${response.statusText}`.trim()
    }
  }

  return `${response.status} ${response.statusText || "Request failed"}`.trim()
}

async function deleteItem(collection, id) {
  await runSave(async () => {
    let apiError = null

    try {
      await api(`/api/${collection}/${id}`, { method: "DELETE" })
    } catch (error) {
      apiError = error
    }

    removeItemFromState(collection, id)
    persistLocalCache()

    const syncedCollection = DELETE_SYNC_COLLECTIONS[collection]
    if (syncedCollection) {
      try {
        await removeManagedRecord(syncedCollection, id)
      } catch (error) {
        if (!isIgnorableFirestorePermissionError(error)) {
          throw error
        }
      }
    }

    if (apiError && (!syncedCollection || !/item not found/i.test(apiError.message))) {
      throw apiError
    }
  }, "Item deleted")
}

async function deleteTelegramDispatch(id) {
  await runSave(async () => {
    state.telegramDispatches = state.telegramDispatches.filter((item) => item.id !== id)
    await removeManagedRecord(FIRESTORE_COLLECTIONS.telegramDispatches, id)
    persistLocalCache()
  }, "Telegram share deleted")
}

async function updateTicketStatus(id, status) {
  await runSave(async () => {
    await api(`/api/support/${id}`, {
      method: "PUT",
      body: { status },
    })
  }, "Ticket updated")
}

function openCreateAccountModal() {
  if (!state.session.isAdmin) {
    toast("Only admins can create accounts", true)
    return
  }
  document.getElementById("create-account-modal").classList.remove("hidden")
}

function closeCreateAccountModal() {
  document.getElementById("create-account-modal").classList.add("hidden")
}

function toast(message, isError = false) {
  const el = document.getElementById("toast")
  el.textContent = message
  el.style.background = isError ? "#bf5a33" : "#17324d"
  el.classList.remove("hidden")
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => el.classList.add("hidden"), 2600)
}

function syncTelegramPreview() {
  const form = document.getElementById("telegram-share-form")
  const preview = document.getElementById("telegram-preview")
  const messageField = document.getElementById("telegram-message")
  const targetPeerField = document.getElementById("telegram-target-peer")
  if (!form || !preview || !messageField) return

  const data = new FormData(form)
  const campaign = state.campaigns.find((item) => item.id === data.get("campaignId"))
  const template = state.templates.find((item) => item.id === data.get("templateId"))
  const group = state.groups.find((item) => item.id === data.get("groupId"))
  const message = buildTelegramMessage({
    campaign,
    template,
    customMessage: textValue(data, "customMessage"),
  })

  if (!messageField.value.trim()) {
    messageField.value = message
  }

  if (targetPeerField && !targetPeerField.value.trim() && group?.telegramPeer) {
    targetPeerField.value = group.telegramPeer
  }

  const targetPeer = targetPeerField?.value?.trim() || group?.telegramPeer || group?.inviteLink || ""
  preview.textContent = message
    ? `${targetPeer ? `Target: ${targetPeer}\n\n` : ""}${message}`
    : "Telegram preview will appear here once you select a template or campaign."
}

function buildTelegramMessage({ campaign, template, customMessage }) {
  if (customMessage) return customMessage

  const parts = []
  if (template?.title) parts.push(template.title)
  if (template?.body) parts.push(template.body)
  if (campaign?.name) parts.push(campaign.name)
  if (campaign?.description) parts.push(campaign.description)
  if (campaign?.caption) parts.push(campaign.caption)
  if (campaign?.cta) parts.push(`CTA: ${campaign.cta}`)
  return parts.filter(Boolean).join("\n\n").trim()
}

function mergeRecords(primary = [], secondary = []) {
  const map = new Map()
  for (const item of [...secondary, ...primary]) {
    if (!item?.id) continue
    map.set(item.id, item)
  }
  return sortByCreatedDesc([...map.values()])
}

function sortByCreatedDesc(items = []) {
  return [...items].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
}

function truncateText(value, maxLength) {
  const text = String(value || "").trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text
}

function removeItemFromState(collection, id) {
  const stateKeyMap = {
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

  const key = stateKeyMap[collection]
  if (!key || !Array.isArray(state[key])) return
  state[key] = state[key].filter((item) => item.id !== id)
}

function isIgnorableFirestorePermissionError(error) {
  const message = String(error?.message || "").toLowerCase()
  return message.includes("insufficient permissions") || message.includes("missing or insufficient permissions")
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

window.deleteItem = deleteItem
window.updateTicketStatus = updateTicketStatus
window.deleteTelegramDispatch = deleteTelegramDispatch
