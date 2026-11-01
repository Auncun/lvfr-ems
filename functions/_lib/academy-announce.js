// The Academy log channel: one embed per Academy event, in the style of a personnel record.
// This file only builds the message; d1-auth.js sends it with the bot.
const COLOR = 0xe74c3c;
const RULE = ["───────────────────────", "───────────────────────", "─────────────────────"].join("\n");
const field = (name, value) => ({ name, value: String(value || "—").slice(0, 1000), inline: false });
const code = value => "`" + String(value || "—").replace(/`/g, "'") + "`";

// event: { type, name, callsign, oldCallsign, rank, reason, actor: { name, discordId } }
// types: recruited, graduated, switched, callsign, resigned, terminated, test
export function buildAcademyEmbed(event, now = Date.now()) {
  const when = `<t:${Math.floor(now / 1000)}:f>`;
  const by = event.actor?.discordId ? `${event.actor.name} (<@${event.actor.discordId}>)` : String(event.actor?.name || "System");
  const base = { color: COLOR, author: { name: "LVFR Academy" }, footer: { text: "LVFR Academy" }, timestamp: new Date(now).toISOString() };
  const processing = status => ({
    ...base, title: "▌ PERSONNEL PROCESSING", description: RULE,
    fields: [field("MEMBER", event.name), field("CALLSIGN", code(event.callsign)), field("STATUS", status),
      ...(event.oldCallsign ? [field("PREVIOUS CALLSIGN", code(event.oldCallsign))] : []),
      field("PROCESSED", when), field("SUBMITTED BY", by)]
  });
  const removal = reason => ({
    ...base, title: "▌ PERSONNEL REMOVAL", description: `${RULE}\n\nMember removed. Callsign ${code(event.callsign)} is now available.`,
    fields: [field("MEMBER", event.name), field("CALLSIGN", code(event.callsign)), field("REASON", reason), field("EFFECTIVE", when), field("ACTIONED BY", by)]
  });
  switch (event.type) {
    case "recruited": return processing("Passed interview");
    case "graduated": return processing("Passed EE");
    case "switched": return processing(event.rank === "Probationary Volunteer" ? "Switched from full time to volunteer" : "Switched from volunteer to full time");
    case "callsign": return processing("Callsign changed");
    case "resigned": return removal("Resigned.");
    case "terminated": return removal(event.reason ? `Terminated — ${event.reason}` : "Terminated");
    case "test": return { ...base, title: "▌ TEST MESSAGE", description: `${RULE}\n\nThe Academy log is connected to this channel.`, fields: [field("SENT BY", by), field("SENT", when)] };
    default: throw new Error(`Unknown Academy log event: ${event.type}`);
  }
}
