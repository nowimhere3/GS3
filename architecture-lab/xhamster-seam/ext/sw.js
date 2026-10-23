// LAB ONLY. Installs the Human's existing rule (drop CSP + X-Frame-Options, id 1, identical to "Ignore X-Frame headers")
// plus lab candidate rules (ids 2..n) read from active-rules.json. Reports API acceptance in self.__dnr.
self.__dnr = { stage: 'start' };
(async () => {
    try {
        const cfg = await (await fetch(chrome.runtime.getURL('active-rules.json'))).json();
        const base = { id: 1, priority: 1, action: { type: 'modifyHeaders', responseHeaders: [
            { header: 'Content-Security-Policy', operation: 'remove' }, { header: 'X-Frame-Options', operation: 'remove' }] }, condition: {} };
        const rules = [base];
        const list = cfg.candidates || (cfg.candidate ? [cfg.candidate] : []);
        list.forEach((c, i) => rules.push({ id: 2 + i, priority: 2 + i, action: c.action, condition: c.condition }));
        const old = (await chrome.declarativeNetRequest.getDynamicRules()).map((r) => r.id);
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old, addRules: rules });
        self.__dnr = { stage: 'installed', name: cfg.name, accepted: true, ruleCount: (await chrome.declarativeNetRequest.getDynamicRules()).length };
    } catch (e) { self.__dnr = { stage: 'error', accepted: false, error: String(e.message || e) }; }
})();
