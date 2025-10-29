// server-patch.js
//  - declares the specific operations that modify Foundry's sources
//  - imports patch-runner helpers and executes them immediately

import { patchSource } from './patch-runner.js';

const sessionsFile = "resources/app/dist/sessions.mjs";
const foundryFile = "resources/app/public/scripts/foundry.mjs";

const headerLiteral = JSON.stringify(process.env.HEADER_AUTH_ID);
const flagScopeLiteral = JSON.stringify("core");
const flagKeyLiteral = JSON.stringify("user_id");

// Primary server patch code to perform header matching for authentication.
const serverHelpers = `
global.__userMatchResolveFlag = ({ user, flagScope, flagKey }) => {
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

global.__userMatchFindByHeader = async ({ headerValue, flagScope, flagKey }) => {
  if (!headerValue) return null;

  const lower = String(headerValue).toLowerCase();
  const users = await db.User.find();

  for (const user of users) {
    const resolved = global.__userMatchResolveFlag({ user, flagScope, flagKey });
    if (resolved && resolved === lower) {
      return user.id ?? user._id ?? null;
    }
  }

  return null;
};

global.__headerAuthPreprocessJoin = async ({ request, headerId, flagScope, flagKey }) => {
  const logTarget = global?.logger ?? console;
  const getLog = (level) =>
    typeof logTarget[level] === "function" ? logTarget[level].bind(logTarget) : console.log.bind(console);
  const debug = getLog("debug");

  if (!request) {
    debug("[header-auth] preprocess: missing request object");
    return;
  }

  const body = request.body ?? {};
  request.body = body;

  request.__headerAuthForceLogin = false;
  request.__headerAuthUser = null;

  const headers = request.headers ?? {};
  const headerKey = String(headerId);
  const headerValue = headers[headerKey] ?? headers[headerKey.toLowerCase()];
  if (!headerId || !headerValue) {
    debug("[header-auth] preprocess: header missing on request", {
      headerKey,
      availableKeys: Object.keys(headers)
    });
    return;
  }

  const currentId = body.userid;
  if (currentId && String(currentId).trim().length) {
    debug("[header-auth] preprocess: request already contains userid", { userid: currentId });
    return;
  }

  const matchedUserId = await global.__userMatchFindByHeader({ headerValue, flagScope, flagKey });
  if (!matchedUserId) {
    debug("[header-auth] preprocess: no user matched header", { headerValue, flagScope, flagKey });
    return;
  }

  const user = await db.User.get(matchedUserId);
  if (!user) {
    debug("[header-auth] preprocess: matched user id not found in DB", { matchedUserId });
    return;
  }

  request.body = { ...body, userid: matchedUserId };
  request.__headerAuthForceLogin = true;
  request.__headerAuthUser = user;
  debug("[header-auth] preprocess: matched user", {
    matchedUserId,
    name: user.name,
    headerValue,
    flagScope,
    flagKey
  });
};
`.trim();

// Server authentication patch set.
patchSource({
  file: sessionsFile,
  operations: [
    {
      label: "bypass user check",
      remove: 'n=await db.User.get(i);if(!n)',
      patch: 'n=s.__headerAuthUser??await db.User.get(i);const h=s.__headerAuthForceLogin===!0;if(!n)'
    },
    {
      label: "bypass password",
      remove: 'a=testPassword(r,n.password,n.passwordSalt)',
      patch: 'a=h?true:testPassword(r,n.password,n.passwordSalt)'
    },
    {
      label: "match header to user",
      remove: 'const o=this.getOrCreate(s,e),{userid:i,password:r}=s.body,',
      patch: `const o=this.getOrCreate(s,e);await global.__headerAuthPreprocessJoin({request:s,headerId:${headerLiteral},flagScope:${flagScopeLiteral},flagKey:${flagKeyLiteral}});const{userid:i,password:r}=s.body,`
    },
    {
      label: "server helpers",
      patch: serverHelpers
    }
  ]
});

// Client UI patch set.
patchSource({
  file: foundryFile,
  operations: [
    {
      label: "remove login fields",
      remove: 'if ( !formData.get("userid") ) return ui.notifications.error("JOIN.ErrorMustSelectUser", {localize: true});',
      patch: 'const __headerAuthUserId=formData.get("userid");if(!__headerAuthUserId){const __headerAuthAllow=await globalThis.__headerAuthAllowEmptySelection?.({event,form,formData})===!0;if(!__headerAuthAllow)return ui.notifications.error("JOIN.ErrorMustSelectUser",{localize:!0});}'
    },
    {
      label: "bypass user selection",
      patch: `{
  const __headerAuthHideLoginFields = () => {
    const form = document.querySelector("#join-form");
    if (!form) return;

    const selectors = ["[name=\\"userid\\"]", "[name=\\"password\\"]"];
    for (const selector of selectors) {
      const input = form.querySelector(selector);
      if (!input) continue;
      const group = input.closest(".form-group") ?? input.closest(".form-fields") ?? input.parentElement;
      if (group) group.style.display = "none";
      input.setAttribute("aria-hidden", "true");
    }

    if (!form.querySelector("#header-auth-status")) {
      const notice = document.createElement("p");
      notice.id = "header-auth-status";
      notice.className = "header-auth-status";
      notice.textContent = "Signing you in...";
      form.prepend(notice);
    }
  };

  globalThis.__headerAuthAllowEmptySelection = async () => {
    __headerAuthHideLoginFields();
    return true;
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", __headerAuthHideLoginFields, { once: true });
  } else {
    __headerAuthHideLoginFields();
  }
}`
    }
  ]
});
