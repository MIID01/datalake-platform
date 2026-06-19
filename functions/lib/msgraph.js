/**
 * msgraph.js — Microsoft Graph client (app-only / client-credentials).
 *
 * Used to create a Teams interview meeting as an Outlook calendar event on a
 * licensed M365 organizer mailbox. Creating the event WITH attendees makes
 * Outlook send the meeting invitation to them natively, and isOnlineMeeting
 * auto-generates the Teams join link.
 *
 * Config (functions/.env — gitignored — or Secret Manager binding):
 *   MS_TENANT_ID            Azure AD (Entra) tenant ID
 *   MS_CLIENT_ID            App registration (client) ID
 *   MS_CLIENT_SECRET        Client secret value
 *   MS_INTERVIEW_ORGANIZER  UPN/email of the M365 mailbox that hosts interviews
 *
 * Required app (application) permission, admin-consented:
 *   Calendars.ReadWrite  (create the event + send invites + Teams link)
 * Optionally scope it to the organizer with an application access policy.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

function isGraphConfigured() {
  return !!(
    process.env.MS_TENANT_ID &&
    process.env.MS_CLIENT_ID &&
    process.env.MS_CLIENT_SECRET &&
    process.env.MS_INTERVIEW_ORGANIZER
  );
}

async function getGraphToken() {
  const tenant = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_CLIENT_ID;
  const secret = process.env.MS_CLIENT_SECRET;
  if (!tenant || !clientId || !secret) {
    throw new Error("Microsoft Graph not configured (MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET)");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: secret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    throw new Error(`Graph token request failed: ${j.error_description || j.error || r.status}`);
  }
  return j.access_token;
}

/**
 * Create a Teams online meeting as a calendar event on the organizer's mailbox.
 * Outlook sends the invite to attendees automatically. Times are passed as
 * wall-clock strings ("YYYY-MM-DDTHH:mm:ss") with an explicit timeZone.
 * Returns { id, joinUrl, webLink }.
 */
async function createTeamsCalendarEvent({ organizer, subject, bodyHtml, startLocal, endLocal, timeZone, location, attendees }) {
  const token = await getGraphToken();
  const event = {
    subject,
    body: { contentType: "HTML", content: bodyHtml || "" },
    start: { dateTime: startLocal, timeZone },
    end: { dateTime: endLocal, timeZone },
    location: { displayName: location || "Microsoft Teams Meeting" },
    attendees: (attendees || []).map((a) => ({
      emailAddress: { address: a.email, name: a.name || a.email },
      type: a.optional ? "optional" : "required",
    })),
    isOnlineMeeting: true,
    onlineMeetingProvider: "teamsForBusiness",
  };
  const r = await fetch(`${GRAPH}/users/${encodeURIComponent(organizer)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Graph event create failed (${r.status}): ${j.error?.message || JSON.stringify(j)}`);
  }
  return { id: j.id, joinUrl: j.onlineMeeting?.joinUrl || null, webLink: j.webLink || null };
}

module.exports = { isGraphConfigured, getGraphToken, createTeamsCalendarEvent };
