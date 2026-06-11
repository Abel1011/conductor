const config = require("./config");
const events = require("./events");
const { sendSlackMessage } = require("./slack");

const NOTIFIABLE_EVENTS = {
  approval_created: "Approval required",
  action_executed: "Action executed",
  action_failed: "Action failed",
  alert_created: "Alert raised",
  connector_paused: "Connector paused"
};

function isPlaceholder(value) {
  return !value || /replace-with|changeme|your-/i.test(value);
}

function getChannelStatus() {
  return {
    slack: {
      configured: !isPlaceholder(config.slackBotToken) && Boolean(config.slackChannelId),
      target: config.slackChannelId || null
    },
    discord: {
      configured: Boolean(config.discordWebhookUrl),
      target: config.discordWebhookUrl ? "webhook" : null
    },
    email: {
      configured: !isPlaceholder(config.resendApiKey) && Boolean(config.notifyEmailTo),
      target: config.notifyEmailTo || null
    }
  };
}

async function dispatchSlack(text) {
  await sendSlackMessage(text);
}

async function dispatchDiscord(text) {
  const response = await fetch(config.discordWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text })
  });
  if (!response.ok) {
    throw new Error(`Discord webhook error: ${response.status}`);
  }
}

async function dispatchEmail(subject, text) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: config.notifyEmailFrom || "Conductor <onboarding@resend.dev>",
      to: [config.notifyEmailTo],
      subject,
      text
    })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API error: ${response.status} ${body.slice(0, 200)}`);
  }
}

async function notifyChannels(label, message, sourceEvent) {
  const status = getChannelStatus();
  const text = `[Conductor] ${label}: ${message}`;
  const results = [];

  const channels = [
    { channel: "slack", configured: status.slack.configured, target: status.slack.target || "#data-ops", send: () => dispatchSlack(text) },
    { channel: "discord", configured: status.discord.configured, target: "Discord webhook", send: () => dispatchDiscord(text) },
    { channel: "email", configured: status.email.configured, target: status.email.target || "ops@example.com", send: () => dispatchEmail(`[Conductor] ${label}`, text) }
  ];

  for (const entry of channels) {
    if (entry.configured) {
      try {
        await entry.send();
        results.push({ channel: entry.channel, target: entry.target, delivered: true, simulated: false });
      } catch (error) {
        console.error(`Notification via ${entry.channel} failed`, error.message);
        results.push({ channel: entry.channel, target: entry.target, delivered: false, simulated: false, error: error.message });
      }
    } else {
      results.push({ channel: entry.channel, target: entry.target, delivered: false, simulated: true });
    }
  }

  events.publish("notification_sent", {
    label,
    message: text,
    sourceType: sourceEvent.type,
    connectionId: sourceEvent.connectionId || null,
    channels: results
  });

  return results;
}

function register() {
  events.onPublish((event) => {
    const label = NOTIFIABLE_EVENTS[event.type];
    if (!label || !event.message) {
      return;
    }
    notifyChannels(label, event.message, event).catch((error) => {
      console.error("Notification dispatch failed", error);
    });
  });
}

module.exports = {
  getChannelStatus,
  notifyChannels,
  register
};
