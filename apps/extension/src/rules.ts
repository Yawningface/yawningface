/**
 * Mirror desktop's active websites into Chrome's navigation layer.
 *
 * These rules are intentionally state-free: the desktop app is the authority.
 * Redirecting before Chrome performs DNS is what replaces ERR_NAME_NOT_RESOLVED
 * with yawningface's own blocked page.
 */
export async function applyRules(domains: string[]): Promise<void> {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((rule) => rule.id);

  const addRules: chrome.declarativeNetRequest.Rule[] = domains.map(
    (domain, index) => ({
      id: index + 1,
      priority: 1,
      action: {
        type: "redirect" as chrome.declarativeNetRequest.RuleActionType,
        redirect: {
          regexSubstitution:
            chrome.runtime.getURL("blocked.html") + `?d=${encodeURIComponent(domain)}`,
        },
      },
      condition: {
        regexFilter: `^https?://([a-z0-9-]+\\.)*${domain.replace(/\./g, "\\.")}(/|$|\\?)`,
        resourceTypes: [
          "main_frame" as chrome.declarativeNetRequest.ResourceType,
        ],
      },
    }),
  );

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules,
  });
}
