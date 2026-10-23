/** Presentation-only inline groups. No Runtime, Store, or media dependencies. */
export function createToolbarDisclosure(root) {
    const groups = new Map();
    let active = null;
    function closeAll() {
        for (const { group, trigger, body } of groups.values()) {
            group.dataset.open = 'false';
            trigger.setAttribute('aria-expanded', 'false');
            body.hidden = true;
        }
        active = null;
    }
    function open(id) {
        const entry = groups.get(id);
        if (!entry) return;
        closeAll();
        entry.group.dataset.open = 'true';
        entry.trigger.setAttribute('aria-expanded', 'true');
        entry.body.hidden = false;
        active = id;
    }
    function toggle(id) {
        if (active === id) closeAll();
        else open(id);
    }
    function register(group, trigger) {
        const body = group.querySelector('.tool-group-body');
        if (!group.id || !body?.id || groups.has(group.id)) throw new Error('Invalid toolbar group');
        const onClick = () => toggle(group.id);
        groups.set(group.id, { group, trigger, body, onClick });
        trigger.setAttribute('aria-controls', body.id);
        trigger.setAttribute('aria-expanded', 'false');
        group.dataset.open = 'false';
        body.hidden = true;
        trigger.addEventListener('click', onClick);
    }
    const doc = root.ownerDocument;
    const outside = (event) => {
        if (active && !groups.get(active).group.contains(event.target)) closeAll();
    };
    const escape = (event) => {
        if (event.key !== 'Escape' || !active) return;
        const trigger = groups.get(active).trigger;
        closeAll();
        trigger.focus();
    };
    doc.addEventListener('click', outside);
    doc.addEventListener('keydown', escape);
    return {
        register, open, toggle, closeAll,
        close(id) { if (active === id) closeAll(); },
        destroy() {
            closeAll();
            for (const { trigger, onClick } of groups.values()) trigger.removeEventListener('click', onClick);
            groups.clear();
            doc.removeEventListener('click', outside);
            doc.removeEventListener('keydown', escape);
        },
    };
}
