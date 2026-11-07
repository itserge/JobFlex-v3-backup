type Contact = {
  name: string; email: string | null; phone: string | null;
  address: string | null; city: string | null; state: string | null; zip: string | null;
};

/** Present the original import without rewriting customer data or edited notes. */
export function metaLeadPresentation(lead: Contact & { id: string; source: string | null; description: string | null }) {
  if (lead.source !== "FACEBOOK" || !/^meta_[a-f0-9]{40}$/.test(lead.id)) return null;
  const text = lead.description?.trim();
  if (!text) return null;
  const fields: Array<{ key: string; value: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^([\w][\w ?/'()-]{0,199}):\s*(.*)$/.exec(line);
    if (match) fields.push({ key: match[1], value: match[2] });
    else if (fields.length) fields[fields.length - 1].value += `\n${line}`;
    else return null;
  }
  // Ordinary edited prose should remain verbatim, even on an imported lead.
  if (!fields.some(f => /^(full_name|phone_number|email|inbox_url)$/.test(f.key))) return null;
  const mapped: Record<string, string | null> = {
    full_name: lead.name, name: lead.name, first_name: lead.name, last_name: lead.name,
    email: lead.email, phone_number: lead.phone, phone: lead.phone,
    street_address: lead.address, address: lead.address, city: lead.city,
    state: lead.state, province: lead.state, zip_code: lead.zip, postal_code: lead.zip, zip: lead.zip,
  };
  let inboxUrl: string | null = null;
  const answers: Array<{ label: string; value: string }> = [];
  for (const field of fields) {
    if (mapped[field.key] && !field.value.includes("\n")) continue;
    if (field.key === "inbox_url") {
      // Meta sends it empty when the person never messaged the Page: no link, and no "Inbox url: Not provided" row.
      if (!field.value.trim()) continue;
      try {
        const url = new URL(field.value);
        if (url.protocol === "https:" && (url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com")) && !url.username && !url.password) {
          inboxUrl = url.href;
          continue;
        }
      } catch { /* Keep unrecognized values as plain text. */ }
    }
    const label = field.key.replace(/_/g, " ").trim();
    // Only prettify option identifiers, never arbitrary prose, emails or URLs.
    const value = field.value.split(", ").map(v => /^[a-z][a-z0-9_/-]*$/.test(v) && v.includes("_")
      ? v.replace(/_/g, " ").replace(/\//g, " / ").replace(/^./, c => c.toUpperCase()) : v).join(", ");
    answers.push({ label: label.charAt(0).toUpperCase() + label.slice(1), value: value || "Not provided" });
  }
  return { answers, inboxUrl };
}
