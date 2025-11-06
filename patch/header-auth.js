const SESSIONS_FILE = "/home/node/resources/app/dist/sessions.mjs";
const FOUNDRY_FILE = "/home/node/resources/app/public/scripts/foundry.mjs";
const LOG_PREFIX = "[header-auth]";
const FLAG_SCOPE = "core";
const FLAG_KEY = "user_id";
const HEADER_ID = process.env.PATCH_HEADER_ID;

export default async function applyPatch({ patchSource }) {
  if (!HEADER_ID) {
    console.log("header-auth: PATCH_HEADER_ID not set; skipping patch.");
    return;
  }

  const serverHelpers = `
global.__headerAuthResolveFlag = ({ user, flagScope, flagKey }) => {
  if (!user) return null;

  let value = null;

  if (typeof user.getFlag === "function") {
    try {
      value = user.getFlag(flagScope, flagKey);
    } catch (error) {
      value = null;
    }
  }

  if (value == null) {
    const flags = user.flags ?? {};
    value = flags?.[flagScope]?.[flagKey] ?? null;
  }

  return value == null ? null : String(value).toLowerCase();
};

global.__headerAuthFindByValue = async ({ identifierValue, flagScope, flagKey }) => {
  if (!identifierValue) return null;

  const lower = String(identifierValue).toLowerCase();
  const users = await db.User.find();

  for (const user of users) {
    const resolved = global.__headerAuthResolveFlag({ user, flagScope, flagKey });
    if (resolved && resolved === lower) {
      return user.id ?? user._id ?? null;
    }
  }

  return null;
};

global.__headerAuthPreprocessJoin = async ({ request, identifierKey, flagScope, flagKey }) => {
  const logTarget = global?.logger ?? console;
  const getLog = (level) =>
    typeof logTarget[level] === "function" ? logTarget[level].bind(logTarget) : console.log.bind(console);
  const debug = getLog("debug");

  if (!request) {
    debug("${LOG_PREFIX} preprocess: missing request object");
    return;
  }

  const body = request.body ?? {};
  request.body = body;

  request.__headerAuthForceLogin = false;
  request.__headerAuthUser = null;

  const headers = request.headers ?? {};
  const identifierKeyLower = String(identifierKey);
  const identifierValue = headers[identifierKeyLower] ?? headers[identifierKeyLower.toLowerCase()];
  if (!identifierKey || !identifierValue) {
    debug("${LOG_PREFIX} preprocess: identifier missing on request", {
      identifierKey: identifierKeyLower,
      availableKeys: Object.keys(headers)
    });
    return;
  }

  const currentId = body.userid;
  if (currentId && String(currentId).trim().length) {
    debug("${LOG_PREFIX} preprocess: request already contains userid", { userid: currentId });
    return;
  }

  const matchedUserId = await global.__headerAuthFindByValue({ identifierValue, flagScope, flagKey });
  if (!matchedUserId) {
    debug("${LOG_PREFIX} preprocess: no user matched identifier", { identifierValue, flagScope, flagKey });
    return;
  }

  const user = await db.User.get(matchedUserId);
  if (!user) {
    debug("${LOG_PREFIX} preprocess: matched user id not found in DB", { matchedUserId });
    return;
  }

  request.body = { ...body, userid: matchedUserId };
  request.__headerAuthForceLogin = true;
  request.__headerAuthUser = user;
  debug("${LOG_PREFIX} preprocess: matched user", {
    matchedUserId,
    name: user.name,
    identifierValue,
    flagScope,
    flagKey
  });
};
`.trim();

  patchSource({
    file: SESSIONS_FILE,
    operations: [
      {
        label: "bypass user check",
        remove: 'n=await db.User.get(i);if(!n)',
        patch: `n=s.__headerAuthUser??await db.User.get(i);const h=s.__headerAuthForceLogin===!0;if(!n)`
      },
      {
        label: "bypass password",
        remove: 'a=testPassword(r,n.password,n.passwordSalt)',
        patch: 'a=h?true:testPassword(r,n.password,n.passwordSalt)'
      },
      {
        label: "match identifier to user",
        remove: 'const o=this.getOrCreate(s,e),{userid:i,password:r}=s.body,',
        patch: `const o=this.getOrCreate(s,e);await global.__headerAuthPreprocessJoin({request:s,identifierKey:"${HEADER_ID}",flagScope:"${FLAG_SCOPE}",flagKey:"${FLAG_KEY}"});const{userid:i,password:r}=s.body,`
      },
      {
        label: "server helpers",
        patch: serverHelpers
      }
    ]
  });

  const uiHelpers = `
const __headerAuthHideJoinCredentials = () => {
  const form = document.querySelector("#join-game-form");
  if (!form) return false;

  const hideControl = (selector, labelSelector) => {
    const input = form.querySelector(selector);
    if (!input) return;

    input.disabled = true;
    input.removeAttribute("required");
    input.style.display = "none";
    input.setAttribute("aria-hidden", "true");

    const label = labelSelector ? form.querySelector(labelSelector) : null;
    if (label) {
      label.style.display = "none";
      label.setAttribute("aria-hidden", "true");
    }

    const group =
      input.closest(".form-group") ??
      input.closest(".form-fields") ??
      input.parentElement;

    if (group) {
      group.style.display = "none";
      group.setAttribute("aria-hidden", "true");
    }
  };

  hideControl('select[name="userid"]', 'label[for="userid"]');
  hideControl('input[name="password"]', 'label[for="password"]');

  if (!form.querySelector("#header-auth-status")) {
    const notice = document.createElement("p");
    notice.id = "header-auth-status";
    notice.className = "header-auth-status";
    notice.textContent = "Signing you in...";
    form.prepend(notice);
  }

  return true;
};

globalThis.__headerAuthAllowEmptySelection = async () => {
  __headerAuthHideJoinCredentials();
  return true;
};

const __headerAuthObserveJoinForm = () => {
  if (__headerAuthHideJoinCredentials()) return;
  if (!document.body) return;
  const observer = new MutationObserver(() => {
    if (__headerAuthHideJoinCredentials()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 10000);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", __headerAuthObserveJoinForm, { once: true });
} else {
  __headerAuthObserveJoinForm();
}
`.trim();

  patchSource({
    file: FOUNDRY_FILE,
    operations: [
      {
        label: "remove login fields",
        remove: 'if ( !formData.get("userid") ) return ui.notifications.error("JOIN.ErrorMustSelectUser", {localize: true});',
        patch: `const __headerAuthUserId=formData.get("userid");if(!__headerAuthUserId){const __headerAuthAllow=await globalThis.__headerAuthAllowEmptySelection?.({event,form,formData})===!0;if(!__headerAuthAllow)return ui.notifications.error("JOIN.ErrorMustSelectUser",{localize:!0});}`
      },
      {
        label: "bypass user selection",
        patch: uiHelpers
      }
    ]
  });
}
