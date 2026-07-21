// FOS Cloud sync using Supabase.
// The main app still uses localStorage as an offline cache, while each signed-in
// user also gets an isolated local copy to prevent data leaking between accounts.
(() => {
  "use strict";

  const STORAGE_KEY = "fos_state";
  const OWNER_KEY = "fos_cloud_active_owner";
  const scopedStateKey = userId => `${STORAGE_KEY}_user_${userId}`;
  const scopedTimeKey = userId => `${STORAGE_KEY}_user_${userId}_updated_at`;
  const cfg = window.FOS_CLOUD_CONFIG || {};

  let client = null;
  let user = null;
  let activeUserId = null;
  let uploadTimer = null;
  let applyingCloud = false;
  let lastUploaded = "";

  const originalSetItem = Storage.prototype.setItem;

  Storage.prototype.setItem = function (key, value) {
    originalSetItem.call(this, key, value);

    if (this !== localStorage || key !== STORAGE_KEY || applyingCloud || !user) return;

    const now = new Date().toISOString();
    originalSetItem.call(localStorage, scopedStateKey(user.id), value);
    originalSetItem.call(localStorage, scopedTimeKey(user.id), now);
    originalSetItem.call(localStorage, OWNER_KEY, user.id);
    queueUpload(value);
  };

  const el = id => document.getElementById(id);

  function status(text, tone = "neutral") {
    const node = el("cloudStatus");
    if (node) {
      node.textContent = text;
      node.dataset.tone = tone;
    }
  }

  function showAuth(message = "") {
    el("cloudAuthOverlay")?.classList.remove("hidden");
    if (el("cloudAuthMessage")) el("cloudAuthMessage").textContent = message;
  }

  function hideAuth() {
    el("cloudAuthOverlay")?.classList.add("hidden");
    if (el("cloudAuthMessage")) el("cloudAuthMessage").textContent = "";
  }

  function validJsonObject(json) {
    try {
      const parsed = JSON.parse(json || "");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed);
    } catch {
      return false;
    }
  }

  function usefulLocal(json) {
    try {
      const s = JSON.parse(json || "{}");
      return Boolean(
        s.incomes?.length ||
        s.bills?.length ||
        s.transfers?.length ||
        Object.values(s.accounts || {}).some(value => Number(value) !== 0)
      );
    } catch {
      return false;
    }
  }

  function timestampMs(value) {
    const ms = Date.parse(value || "");
    return Number.isFinite(ms) ? ms : 0;
  }

  function queueUpload(json) {
    if (!client || !user || !json || json === lastUploaded || !validJsonObject(json)) return;
    clearTimeout(uploadTimer);
    uploadTimer = setTimeout(() => upload(json), 800);
  }

  async function upload(json = localStorage.getItem(STORAGE_KEY)) {
    if (!client || !user || !json || !validJsonObject(json)) return;

    try {
      status("Saving…", "working");
      const stateData = JSON.parse(json);
      const updatedAt = new Date().toISOString();
      const { error } = await client
        .from("fos_user_state")
        .upsert(
          { user_id: user.id, state_data: stateData, updated_at: updatedAt },
          { onConflict: "user_id" }
        );

      if (error) throw error;

      lastUploaded = json;
      originalSetItem.call(localStorage, scopedStateKey(user.id), json);
      originalSetItem.call(localStorage, scopedTimeKey(user.id), updatedAt);
      originalSetItem.call(localStorage, OWNER_KEY, user.id);
      status("Cloud synced", "success");
    } catch (err) {
      console.error("Cloud save failed", err);
      status("Saved locally — cloud error", "warning");
    }
  }

  function applyState(stateData, updatedAt = new Date().toISOString()) {
    if (!stateData || typeof stateData !== "object" || Array.isArray(stateData) || !user) return;

    applyingCloud = true;
    try {
      const json = JSON.stringify(stateData);
      originalSetItem.call(localStorage, STORAGE_KEY, json);
      originalSetItem.call(localStorage, `${STORAGE_KEY}_backup`, json);
      originalSetItem.call(localStorage, scopedStateKey(user.id), json);
      originalSetItem.call(localStorage, scopedTimeKey(user.id), updatedAt);
      originalSetItem.call(localStorage, OWNER_KEY, user.id);
      lastUploaded = json;

      if (window.FOS_TEST_API?.setState) {
        window.FOS_TEST_API.setState(stateData);
        window.populateSettings?.();
        window.renderAll?.();
      } else {
        location.reload();
      }
    } finally {
      applyingCloud = false;
    }
  }

  function prepareLocalStateForUser(userId) {
    const owner = localStorage.getItem(OWNER_KEY);
    const generic = localStorage.getItem(STORAGE_KEY);
    let scoped = localStorage.getItem(scopedStateKey(userId));

    // First cloud sign-in: adopt the existing pre-cloud local data for this user.
    if (!owner && generic && validJsonObject(generic) && !scoped) {
      const now = new Date().toISOString();
      originalSetItem.call(localStorage, scopedStateKey(userId), generic);
      originalSetItem.call(localStorage, scopedTimeKey(userId), now);
      scoped = generic;
    }

    // Returning to the same user: keep the latest generic offline cache.
    if (owner === userId && generic && validJsonObject(generic)) {
      scoped = generic;
      originalSetItem.call(localStorage, scopedStateKey(userId), generic);
      if (!localStorage.getItem(scopedTimeKey(userId))) {
        originalSetItem.call(localStorage, scopedTimeKey(userId), new Date().toISOString());
      }
    }

    return scoped;
  }

  async function initialSync() {
    status("Checking cloud…", "working");

    const localJson = prepareLocalStateForUser(user.id);
    const localUpdatedAt = localStorage.getItem(scopedTimeKey(user.id));

    const { data, error } = await client
      .from("fos_user_state")
      .select("state_data,updated_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Cloud read failed", error);
      if (localJson && validJsonObject(localJson)) {
        applyState(JSON.parse(localJson), localUpdatedAt || new Date().toISOString());
      } else {
        applyState({}, new Date().toISOString());
      }
      status("Using local data — cloud error", "warning");
      return;
    }

    const cloudExists = Boolean(data?.state_data && typeof data.state_data === "object");
    const localExists = Boolean(localJson && validJsonObject(localJson));

    if (cloudExists && localExists) {
      if (timestampMs(localUpdatedAt) > timestampMs(data.updated_at)) {
        applyState(JSON.parse(localJson), localUpdatedAt);
        await upload(localJson);
      } else {
        applyState(data.state_data, data.updated_at || new Date().toISOString());
      }
    } else if (cloudExists) {
      applyState(data.state_data, data.updated_at || new Date().toISOString());
    } else if (localExists && usefulLocal(localJson)) {
      applyState(JSON.parse(localJson), localUpdatedAt || new Date().toISOString());
      await upload(localJson);
    } else {
      applyState({}, new Date().toISOString());
      await upload(localStorage.getItem(STORAGE_KEY));
    }

    status("Cloud synced", "success");
  }

  async function signedIn(nextUser) {
    if (!nextUser?.id) return;
    if (activeUserId === nextUser.id) return;

    activeUserId = nextUser.id;
    user = nextUser;
    hideAuth();
    el("cloudLogoutBtn")?.classList.remove("hidden");
    await initialSync();
  }

  function signedOut() {
    clearTimeout(uploadTimer);
    activeUserId = null;
    user = null;
    lastUploaded = "";
    el("cloudLogoutBtn")?.classList.add("hidden");
    status("Sign in required", "neutral");
    showAuth();
  }

  async function signIn(event) {
    event.preventDefault();
    const email = el("cloudEmail").value.trim();
    const password = el("cloudPassword").value;
    status("Signing in…", "working");

    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      status("Sign-in failed", "warning");
      showAuth(error.message);
    }
  }

  async function signUp() {
    const email = el("cloudEmail").value.trim();
    const password = el("cloudPassword").value;

    if (!email || password.length < 6) {
      showAuth("Enter an email and a password of at least 6 characters.");
      return;
    }

    status("Creating account…", "working");
    const { data, error } = await client.auth.signUp({ email, password });

    if (error) {
      status("Account creation failed", "warning");
      showAuth(error.message);
    } else if (!data.session) {
      status("Confirm your email", "neutral");
      showAuth("Account created. Check your email, confirm it, then sign in.");
    }
  }

  async function init() {
    if (!cfg.supabaseUrl || !cfg.supabasePublishableKey || !window.supabase?.createClient) {
      status("Cloud configuration error", "warning");
      showAuth("Cloud configuration is incomplete.");
      return;
    }

    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    el("cloudAuthForm")?.addEventListener("submit", signIn);
    el("cloudSignUpBtn")?.addEventListener("click", signUp);
    el("cloudLogoutBtn")?.addEventListener("click", () => client.auth.signOut());

    const { data } = await client.auth.getSession();
    if (data.session?.user) await signedIn(data.session.user);
    else signedOut();

    client.auth.onAuthStateChange((_event, session) => {
      if (session?.user) signedIn(session.user);
      else signedOut();
    });
  }

  window.FOS_CLOUD = { syncNow: upload };
  window.addEventListener("DOMContentLoaded", init);
})();
